import { expect } from "chai";
import { AbiCoder, concat, keccak256, ZeroAddress } from "ethers";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const connection = await hre.network.create();
const { ethers, networkHelpers } = connection;
const upgradesApi = await upgrades(hre, connection);

const CHALLENGE_WINDOW = 7 * 24 * 60 * 60;
const LABELER_WEIGHT = 40n;
const CONTRIBUTOR_WEIGHT = 60n;
const TOTAL_WEIGHT = LABELER_WEIGHT + CONTRIBUTOR_WEIGHT;

function leaf(address: string, weight: bigint) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [address, weight]));
}

function pairHash(a: string, b: string) {
  const [left, right] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

describe("RevenueSplitter", function () {
  async function deployFixture() {
    const [
      governance,
      admin,
      contributor,
      labeler,
      buyer,
      treasury,
      newTreasury,
      gatewaySigner,
      outsider,
    ] = await ethers.getSigners();

    const token = await ethers.deployContract("MockERC20");
    const contributors = await ethers.deployContract("ContributorRegistry", [
      governance.address,
      admin.address,
    ]);
    const config = await ethers.deployContract("ProtocolConfig", [
      await token.getAddress(),
      250,
      treasury.address,
      CHALLENGE_WINDOW,
      gatewaySigner.address,
      governance.address,
      admin.address,
    ]);
    const datasets = await ethers.deployContract("DatasetRegistry", [
      await contributors.getAddress(),
      await config.getAddress(),
      governance.address,
      admin.address,
    ]);
    const marketplace = await ethers.deployContract("MockMarketplace", [
      await datasets.getAddress(),
    ]);

    await contributors
      .connect(admin)
      .grantRole(await contributors.CONTRIBUTOR_ROLE(), contributor.address);
    await datasets.connect(admin).setMarketplaceOnce(await marketplace.getAddress());

    const labelerLeaf = leaf(labeler.address, LABELER_WEIGHT);
    const contributorLeaf = leaf(contributor.address, CONTRIBUTOR_WEIGHT);
    const root = pairHash(labelerLeaf, contributorLeaf);
    await datasets.connect(contributor).registerDataset({
      contentHash: ethers.id("payload"),
      sampleURI: "ipfs://sample",
      payloadURI: "ipfs://payload",
      weightsRoot: root,
      totalWeight: TOTAL_WEIGHT,
      policy: {
        allowCopy: true,
        allowExclusive: true,
        exclusiveRequiresZeroCopies: false,
        licensesTransferable: false,
      },
      tag: "revenue-test",
    });

    const factory = await ethers.getContractFactory("RevenueSplitter");
    const splitter = await upgradesApi.deployProxy(
      factory,
      [await config.getAddress(), await datasets.getAddress(), governance.address, admin.address],
      { kind: "uups" },
    );
    await splitter.waitForDeployment();
    await splitter.connect(admin).setMarketplaceOnce(await marketplace.getAddress());

    return {
      governance,
      admin,
      contributor,
      labeler,
      buyer,
      treasury,
      newTreasury,
      gatewaySigner,
      outsider,
      token,
      config,
      datasets,
      marketplace,
      splitter,
      datasetId: 1n,
      labelerProof: [contributorLeaf],
      contributorProof: [labelerLeaf],
    };
  }

  async function moveToDeadline(datasets: Awaited<ReturnType<typeof deployFixture>>["datasets"]) {
    await networkHelpers.time.setNextBlockTimestamp(await datasets.challengeWindowEndsAt(1));
  }

  async function accruedFixture() {
    const deployment = await deployFixture();
    await moveToDeadline(deployment.datasets);
    await deployment.token.mint(await deployment.splitter.getAddress(), 1_000);
    await deployment.marketplace.accrueRevenue(
      await deployment.splitter.getAddress(),
      deployment.datasetId,
      1_000,
    );
    return deployment;
  }

  it("initializes the UUPS proxy once with documented roles", async function () {
    const { splitter, governance, admin, config, datasets } =
      await networkHelpers.loadFixture(deployFixture);

    expect(await splitter.protocolConfig()).to.equal(await config.getAddress());
    expect(await splitter.datasetRegistry()).to.equal(await datasets.getAddress());
    expect(
      await splitter.hasRole(await splitter.DEFAULT_ADMIN_ROLE(), governance.address),
    ).to.equal(true);
    expect(await splitter.hasRole(await splitter.ADMIN_ROLE(), admin.address)).to.equal(true);
    await expect(
      splitter.initialize(
        await config.getAddress(),
        await datasets.getAddress(),
        governance.address,
        admin.address,
      ),
    ).to.be.revertedWithCustomError(splitter, "InvalidInitialization");
  });

  it("rejects accrual before the deadline and without exact backing", async function () {
    const { splitter, marketplace, datasets, datasetId } =
      await networkHelpers.loadFixture(deployFixture);

    await expect(marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000))
      .to.be.revertedWithCustomError(splitter, "AccrualNotAvailable")
      .withArgs(datasetId);

    await moveToDeadline(datasets);
    await expect(
      marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000),
    ).to.be.revertedWithCustomError(splitter, "InsufficientTokenBacking");
  });

  it("restricts accrual to Marketplace and rejects zero gross", async function () {
    const { splitter, datasets, marketplace, outsider, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await moveToDeadline(datasets);

    await expect(splitter.connect(outsider).accrue(datasetId, 1))
      .to.be.revertedWithCustomError(splitter, "OnlyMarketplace")
      .withArgs(outsider.address);
    await expect(
      marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 0),
    ).to.be.revertedWithCustomError(splitter, "InvalidGrossAmount");
  });

  it("accrues fee and net revenue with full backing", async function () {
    const { splitter, datasetId, token, marketplace, datasets } =
      await networkHelpers.loadFixture(deployFixture);

    await moveToDeadline(datasets);
    await token.mint(await splitter.getAddress(), 1_000);
    await expect(marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000))
      .to.emit(splitter, "RevenueAccrued")
      .withArgs(datasetId, 1_000, 25, 975);

    expect(await splitter.treasuryBalance()).to.equal(25);
    expect(await splitter.contributorBalance()).to.equal(975);
    expect(await splitter.cumulativeRevenue(datasetId)).to.equal(975);
  });

  it("previews and pays a valid Merkle claim", async function () {
    const { splitter, token, labeler, labelerProof, datasetId } =
      await networkHelpers.loadFixture(accruedFixture);

    expect(await splitter.claimable(datasetId, labeler.address, LABELER_WEIGHT)).to.equal(390);
    await expect(splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof))
      .to.emit(splitter, "RevenueClaimed")
      .withArgs(datasetId, labeler.address, 390);

    expect(await token.balanceOf(labeler.address)).to.equal(390);
    expect(await splitter.claimed(datasetId, labeler.address)).to.equal(390);
    expect(await splitter.contributorBalance()).to.equal(585);
    expect(await splitter.claimable(datasetId, labeler.address, LABELER_WEIGHT)).to.equal(0);
    await expect(
      splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof),
    ).to.be.revertedWithCustomError(splitter, "NothingToClaim");
  });

  it("blocks claims at deadline minus one and permits them at the exact deadline", async function () {
    const { splitter, token, marketplace, datasets, labeler, labelerProof, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    const deadline = await datasets.challengeWindowEndsAt(datasetId);

    await networkHelpers.time.setNextBlockTimestamp(deadline - 1n);
    await expect(
      splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof),
    ).to.be.revertedWithCustomError(splitter, "ClaimNotAvailable");

    await token.mint(await splitter.getAddress(), 1_000);
    await networkHelpers.time.setNextBlockTimestamp(deadline);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    expect(await token.balanceOf(labeler.address)).to.equal(390);
  });

  it("rejects wrong weights and proofs", async function () {
    const { splitter, labeler, labelerProof, datasetId } =
      await networkHelpers.loadFixture(accruedFixture);

    await expect(
      splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT + 1n, labelerProof),
    ).to.be.revertedWithCustomError(splitter, "InvalidMerkleProof");
    await expect(
      splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, []),
    ).to.be.revertedWithCustomError(splitter, "InvalidMerkleProof");
  });

  it("keeps claimable advisory and rejects the wrong claimant address", async function () {
    const { splitter, outsider, labelerProof, datasetId } =
      await networkHelpers.loadFixture(accruedFixture);

    expect(await splitter.claimable(datasetId, outsider.address, LABELER_WEIGHT)).to.equal(390);
    await expect(
      splitter.connect(outsider).claim(datasetId, LABELER_WEIGHT, labelerProof),
    ).to.be.revertedWithCustomError(splitter, "InvalidMerkleProof");
  });

  it("uses mulDiv safely for values whose intermediate product would overflow", async function () {
    const { splitter, token, marketplace, datasets, labeler, labelerProof, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await moveToDeadline(datasets);
    const gross = 1n << 255n;
    const fee = (gross * 250n) / 10_000n;
    const net = gross - fee;
    await token.mint(await splitter.getAddress(), gross);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, gross);

    expect(await splitter.cumulativeRevenue(datasetId)).to.equal(net);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    expect(await token.balanceOf(labeler.address)).to.equal((LABELER_WEIGHT * net) / TOTAL_WEIGHT);
  });

  it("retains rounding dust and releases it when later cumulative revenue permits", async function () {
    const {
      splitter,
      token,
      marketplace,
      datasets,
      labeler,
      contributor,
      labelerProof,
      contributorProof,
      datasetId,
    } = await networkHelpers.loadFixture(deployFixture);
    await moveToDeadline(datasets);
    await token.mint(await splitter.getAddress(), 102);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 101);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    await splitter.connect(contributor).claim(datasetId, CONTRIBUTOR_WEIGHT, contributorProof);
    expect(await splitter.contributorBalance()).to.equal(1);

    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    await splitter.connect(contributor).claim(datasetId, CONTRIBUTOR_WEIGHT, contributorProof);
    expect(await splitter.contributorBalance()).to.equal(0);
  });

  it("pays only incremental entitlement after later revenue", async function () {
    const deployment = await networkHelpers.loadFixture(accruedFixture);
    const { splitter, token, marketplace, labeler, labelerProof, datasetId } = deployment;
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);

    await token.mint(await splitter.getAddress(), 1_000);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000);
    expect(await splitter.claimable(datasetId, labeler.address, LABELER_WEIGHT)).to.equal(390);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    expect(await token.balanceOf(labeler.address)).to.equal(780);
  });

  it("allows a late claimant to collect its full share after multiple sales", async function () {
    const { splitter, token, marketplace, datasets, labeler, labelerProof, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await moveToDeadline(datasets);
    await token.mint(await splitter.getAddress(), 2_000);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000);
    await marketplace.accrueRevenue(await splitter.getAddress(), datasetId, 1_000);

    expect(await splitter.claimable(datasetId, labeler.address, LABELER_WEIGHT)).to.equal(780);
    await splitter.connect(labeler).claim(datasetId, LABELER_WEIGHT, labelerProof);
    expect(await token.balanceOf(labeler.address)).to.equal(780);
  });

  it("blocks claims while paused and returns zero for unavailable/unknown claims", async function () {
    const beforeDeadline = await networkHelpers.loadFixture(deployFixture);
    expect(
      await beforeDeadline.splitter.claimable(
        beforeDeadline.datasetId,
        beforeDeadline.labeler.address,
        LABELER_WEIGHT,
      ),
    ).to.equal(0);
    expect(
      await beforeDeadline.splitter.claimable(999, beforeDeadline.labeler.address, 1),
    ).to.equal(0);
    expect(await beforeDeadline.splitter.claimable(1, ZeroAddress, LABELER_WEIGHT)).to.equal(0);

    const accrued = await networkHelpers.loadFixture(accruedFixture);
    await accrued.config.connect(accrued.admin).pause();
    expect(
      await accrued.splitter.claimable(accrued.datasetId, accrued.labeler.address, LABELER_WEIGHT),
    ).to.equal(390);
    await expect(
      accrued.splitter
        .connect(accrued.labeler)
        .claim(accrued.datasetId, LABELER_WEIGHT, accrued.labelerProof),
    ).to.be.revertedWithCustomError(accrued.splitter, "ProtocolPaused");
  });

  it("withdraws only recorded fees to the current treasury, even while paused", async function () {
    const { splitter, token, config, governance, admin, outsider, newTreasury } =
      await networkHelpers.loadFixture(accruedFixture);
    await config.connect(governance).setTreasury(newTreasury.address);
    await config.connect(admin).pause();

    await expect(splitter.connect(outsider).withdrawTreasury())
      .to.emit(splitter, "TreasuryWithdrawn")
      .withArgs(newTreasury.address, 25);
    expect(await token.balanceOf(newTreasury.address)).to.equal(25);
    expect(await splitter.treasuryBalance()).to.equal(0);
    expect(await splitter.contributorBalance()).to.equal(975);
    await expect(splitter.withdrawTreasury()).to.be.revertedWithCustomError(
      splitter,
      "NoTreasuryBalance",
    );
  });

  it("enforces complete one-time Marketplace wiring", async function () {
    const { config, datasets, governance, admin, outsider, marketplace } =
      await networkHelpers.loadFixture(deployFixture);
    const factory = await ethers.getContractFactory("RevenueSplitter");
    const fresh = await upgradesApi.deployProxy(
      factory,
      [await config.getAddress(), await datasets.getAddress(), governance.address, admin.address],
      { kind: "uups" },
    );

    await expect(
      marketplace.accrueRevenue(await fresh.getAddress(), 1, 1),
    ).to.be.revertedWithCustomError(fresh, "OnlyMarketplace");
    await expect(
      fresh.connect(outsider).setMarketplaceOnce(await marketplace.getAddress()),
    ).to.be.revertedWithCustomError(fresh, "AccessControlUnauthorizedAccount");
    await expect(
      fresh.connect(admin).setMarketplaceOnce(ZeroAddress),
    ).to.be.revertedWithCustomError(fresh, "InvalidMarketplace");
    await expect(
      fresh.connect(admin).setMarketplaceOnce(outsider.address),
    ).to.be.revertedWithCustomError(fresh, "InvalidMarketplace");
    await expect(fresh.connect(admin).setMarketplaceOnce(await marketplace.getAddress()))
      .to.emit(fresh, "MarketplaceWired")
      .withArgs(await marketplace.getAddress());
    await expect(
      fresh.connect(admin).setMarketplaceOnce(await marketplace.getAddress()),
    ).to.be.revertedWithCustomError(fresh, "MarketplaceAlreadyWired");
  });

  it("allows only governance to authorize a UUPS upgrade", async function () {
    const { splitter, governance, outsider } = await networkHelpers.loadFixture(deployFixture);
    const proxyAddress = await splitter.getAddress();
    const unauthorizedFactory = await ethers.getContractFactory("RevenueSplitterV2", outsider);

    await expect(upgradesApi.upgradeProxy(proxyAddress, unauthorizedFactory, { kind: "uups" }))
      .to.be.revertedWithCustomError(splitter, "OnlyGovernanceTimelock")
      .withArgs(outsider.address);

    const authorizedFactory = await ethers.getContractFactory("RevenueSplitterV2", governance);
    const upgraded = await upgradesApi.upgradeProxy(proxyAddress, authorizedFactory, {
      kind: "uups",
    });
    expect(await upgraded.version()).to.equal(2);
    expect(await upgraded.marketplace()).to.equal(await splitter.marketplace());
  });
});

import { expect } from "chai";
import { AbiCoder, keccak256 } from "ethers";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const connection = await hre.network.create();
const { ethers, networkHelpers } = connection;
const upgradesApi = await upgrades(hre, connection);
const WINDOW = 7 * 24 * 60 * 60;

describe("Marketplace acceptance coverage", function () {
  async function deployFixture(tokenContract = "MockERC20") {
    const [governance, admin, contributor, buyer, buyer2, treasury, gateway] =
      await ethers.getSigners();
    const token = await ethers.deployContract(tokenContract);
    const contributors = await ethers.deployContract("ContributorRegistry", [
      governance.address,
      admin.address,
    ]);
    const config = await ethers.deployContract("ProtocolConfig", [
      await token.getAddress(),
      250,
      treasury.address,
      WINDOW,
      gateway.address,
      governance.address,
      admin.address,
    ]);
    const datasets = await ethers.deployContract("DatasetRegistry", [
      await contributors.getAddress(),
      await config.getAddress(),
      governance.address,
      admin.address,
    ]);
    const nft = await ethers.deployContract("EntitlementNFT", [
      await datasets.getAddress(),
      governance.address,
      admin.address,
    ]);
    const splitter = await upgradesApi.deployProxy(
      await ethers.getContractFactory("RevenueSplitter"),
      [await config.getAddress(), await datasets.getAddress(), governance.address, admin.address],
      { kind: "uups" },
    );
    const market = await upgradesApi.deployProxy(
      await ethers.getContractFactory("Marketplace"),
      [
        await config.getAddress(),
        await datasets.getAddress(),
        await nft.getAddress(),
        await splitter.getAddress(),
        governance.address,
      ],
      { kind: "uups" },
    );

    await datasets.connect(admin).setMarketplaceOnce(await market.getAddress());
    await nft.connect(admin).setMarketplaceOnce(await market.getAddress());
    await splitter.connect(admin).setMarketplaceOnce(await market.getAddress());
    await contributors
      .connect(admin)
      .grantRole(await contributors.CONTRIBUTOR_ROLE(), contributor.address);

    const weight = 100n;
    const root = keccak256(
      AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [contributor.address, weight]),
    );
    async function register(
      policy = {
        allowCopy: true,
        allowExclusive: true,
        exclusiveRequiresZeroCopies: false,
        licensesTransferable: false,
      },
    ) {
      const registration = {
        contentHash: ethers.id("payload-preview"),
        sampleURI: "ipfs://sample",
        payloadURI: "ipfs://payload",
        weightsRoot: root,
        totalWeight: weight,
        policy,
        tag: "acceptance",
      };
      const datasetId = await datasets
        .connect(contributor)
        .registerDataset.staticCall(registration);
      registration.contentHash = ethers.id(`payload-${datasetId}`);
      await datasets.connect(contributor).registerDataset(registration);
      return datasetId;
    }

    for (const account of [buyer, buyer2]) {
      await token.mint(account.address, 1_000_000);
      await token.connect(account).getFunction("approve")(await market.getAddress(), 1_000_000);
    }

    return {
      governance,
      admin,
      contributor,
      buyer,
      buyer2,
      token,
      config,
      datasets,
      nft,
      splitter,
      market,
      register,
      weight,
    };
  }

  async function deployMockFixture() {
    return deployFixture("MockERC20");
  }

  it("supports Copy-only and Exclusive-only policies with inactive price semantics", async function () {
    const d = await networkHelpers.loadFixture(deployMockFixture);
    const copyOnly = await d.register({
      allowCopy: true,
      allowExclusive: false,
      exclusiveRequiresZeroCopies: false,
      licensesTransferable: false,
    });
    await d.market.connect(d.contributor).listCopy(copyOnly, 1_000);
    await expect(
      d.market.connect(d.contributor).listExclusiveFixed(copyOnly, 5_000),
    ).to.be.revertedWithCustomError(d.market, "SaleKindNotAllowed");
    await d.market.connect(d.contributor).delist(copyOnly, 0);
    expect(await d.market.priceOf(copyOnly, 0)).to.equal(0);
    expect((await d.datasets.getDataset(copyOnly)).status).to.equal(3);

    const exclusiveOnly = await d.register({
      allowCopy: false,
      allowExclusive: true,
      exclusiveRequiresZeroCopies: true,
      licensesTransferable: false,
    });
    await d.market.connect(d.contributor).listExclusiveFixed(exclusiveOnly, 5_000);
    await expect(
      d.market.connect(d.contributor).listCopy(exclusiveOnly, 1_000),
    ).to.be.revertedWithCustomError(d.market, "SaleKindNotAllowed");
    expect(await d.market.priceOf(999, 0)).to.equal(0);
  });

  it("blocks at deadline minus one and permits at the exact deadline", async function () {
    const d = await networkHelpers.loadFixture(deployMockFixture);
    const id = await d.register();
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    const deadline = await d.datasets.challengeWindowEndsAt(id);

    await networkHelpers.time.setNextBlockTimestamp(deadline - 1n);
    await expect(d.market.connect(d.buyer).buyCopy(id)).to.be.revertedWithCustomError(
      d.market,
      "DatasetNotPurchasable",
    );
    await networkHelpers.time.setNextBlockTimestamp(deadline);
    await d.market.connect(d.buyer).buyCopy(id);
  });

  it("allows forward-exclusive purchase after Copy sales", async function () {
    const d = await networkHelpers.loadFixture(deployMockFixture);
    const id = await d.register();
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    await d.market.connect(d.contributor).listExclusiveFixed(id, 5_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));

    await d.market.connect(d.buyer).buyCopy(id);
    expect((await d.datasets.getDataset(id)).copiesSold).to.equal(1);
    await d.market.connect(d.buyer2).buyExclusive(id);
    expect((await d.datasets.getDataset(id)).status).to.equal(2);
    expect(await d.nft.hasAccess(id, d.buyer.address)).to.equal(false);
    expect(await d.nft.hasAccess(id, d.buyer2.address)).to.equal(true);
  });

  it("enforces Pending, Rejected, and Upheld challenge effects end to end", async function () {
    const d = await networkHelpers.loadFixture(deployMockFixture);
    const rejectedId = await d.register();
    await d.market.connect(d.contributor).listCopy(rejectedId, 1_000);
    await d.market.connect(d.contributor).listExclusiveFixed(rejectedId, 5_000);
    await d.datasets.connect(d.admin).recordChallenge(rejectedId, ethers.id("pending"));
    await networkHelpers.time.setNextBlockTimestamp(
      await d.datasets.challengeWindowEndsAt(rejectedId),
    );
    await expect(d.market.connect(d.buyer).buyCopy(rejectedId)).to.be.revertedWithCustomError(
      d.market,
      "DatasetNotPurchasable",
    );
    await expect(d.market.connect(d.buyer).buyExclusive(rejectedId)).to.be.revertedWithCustomError(
      d.market,
      "DatasetNotPurchasable",
    );
    await d.market.connect(d.contributor).delist(rejectedId, 0);
    await d.market.connect(d.contributor).delist(rejectedId, 1);
    await expect(
      d.market.connect(d.contributor).listCopy(rejectedId, 1_000),
    ).to.be.revertedWithCustomError(d.market, "DatasetNotListable");
    await expect(
      d.splitter.connect(d.contributor).claim(rejectedId, d.weight, []),
    ).to.be.revertedWithCustomError(d.splitter, "ClaimNotAvailable");
    await d.datasets.connect(d.admin).resolveChallenge(rejectedId, false);
    await d.market.connect(d.contributor).listCopy(rejectedId, 1_000);
    await d.market.connect(d.buyer).buyCopy(rejectedId);
    await d.splitter.connect(d.contributor).claim(rejectedId, d.weight, []);

    const upheldId = await d.register();
    await d.market.connect(d.contributor).listCopy(upheldId, 1_000);
    await d.datasets.connect(d.admin).recordChallenge(upheldId, ethers.id("upheld"));
    await d.datasets.connect(d.admin).resolveChallenge(upheldId, true);
    expect(await d.market.priceOf(upheldId, 0)).to.equal(0);
    await expect(
      d.market.connect(d.contributor).listCopy(upheldId, 1_000),
    ).to.be.revertedWithCustomError(d.market, "DatasetNotListable");
    await expect(
      d.splitter.connect(d.contributor).claim(upheldId, d.weight, []),
    ).to.be.revertedWithCustomError(d.splitter, "ClaimNotAvailable");
  });

  it("rejects fee-on-transfer payment tokens atomically", async function () {
    const d = await deployFixture("FeeOnTransferERC20");
    const id = await d.register();
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));

    const balanceBefore = await d.token.balanceOf(d.buyer.address);
    await expect(d.market.connect(d.buyer).buyCopy(id))
      .to.be.revertedWithCustomError(d.market, "IncorrectTokenTransfer")
      .withArgs(1_000, 990);
    expect(await d.token.balanceOf(d.buyer.address)).to.equal(balanceBefore);
    expect((await d.datasets.getDataset(id)).copiesSold).to.equal(0);
  });

  it("blocks ERC-20 callback reentrancy while completing one purchase", async function () {
    const d = await deployFixture("ReentrantERC20");
    const id = await d.register();
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));
    await d.token.configureAttack(await d.market.getAddress(), id);

    await d.market.connect(d.buyer).buyCopy(id);
    expect(await d.token.reentryBlocked()).to.equal(true);
    expect((await d.datasets.getDataset(id)).copiesSold).to.equal(1);
  });

  it("mints Copy before incrementing copiesSold as specified", async function () {
    const d = await networkHelpers.loadFixture(deployMockFixture);
    const id = await d.register();
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    const receiver = await ethers.deployContract("CopyOrderReceiver", [
      await d.token.getAddress(),
      await d.market.getAddress(),
      await d.datasets.getAddress(),
    ]);
    await d.token.mint(await receiver.getAddress(), 1_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));

    await receiver.buyCopy(id, 1_000);
    expect(await receiver.copiesSoldObservedDuringMint()).to.equal(0);
    expect((await d.datasets.getDataset(id)).copiesSold).to.equal(1);
  });
});

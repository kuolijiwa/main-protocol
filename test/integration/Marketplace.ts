import { expect } from "chai";
import { AbiCoder, keccak256 } from "ethers";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const connection = await hre.network.create();
const { ethers, networkHelpers } = connection;
const upgradesApi = await upgrades(hre, connection);
const WINDOW = 7 * 24 * 60 * 60;

describe("Marketplace integration", function () {
  async function deployFixture() {
    const [governance, admin, contributor, buyer, buyer2, treasury, gateway] =
      await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
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
    const splitterFactory = await ethers.getContractFactory("RevenueSplitter");
    const splitter = await upgradesApi.deployProxy(
      splitterFactory,
      [await config.getAddress(), await datasets.getAddress(), governance.address, admin.address],
      { kind: "uups" },
    );
    const marketFactory = await ethers.getContractFactory("Marketplace");
    const market = await upgradesApi.deployProxy(
      marketFactory,
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
    async function register(exclusiveRequiresZeroCopies = false) {
      await datasets.connect(contributor).registerDataset({
        contentHash: ethers.id(`payload-${exclusiveRequiresZeroCopies}`),
        sampleURI: "ipfs://sample",
        payloadURI: "ipfs://payload",
        weightsRoot: root,
        totalWeight: weight,
        policy: {
          allowCopy: true,
          allowExclusive: true,
          exclusiveRequiresZeroCopies,
          licensesTransferable: false,
        },
        tag: "market",
      });
    }
    await register();
    await token.mint(buyer.address, 100_000);
    await token.mint(buyer2.address, 100_000);
    await token.connect(buyer).approve(await market.getAddress(), 100_000);
    await token.connect(buyer2).approve(await market.getAddress(), 100_000);

    return {
      governance,
      admin,
      contributor,
      buyer,
      buyer2,
      treasury,
      token,
      config,
      datasets,
      nft,
      splitter,
      market,
      register,
      datasetId: 1n,
    };
  }

  it("creates concurrent fixed listings and changes price only by delist/relist", async function () {
    const { market, datasets, contributor, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await expect(market.connect(contributor).listCopy(datasetId, 1_000))
      .to.emit(market, "CopyListed")
      .withArgs(datasetId, 1_000);
    await market.connect(contributor).listExclusiveFixed(datasetId, 5_000);
    expect(await market.priceOf(datasetId, 0)).to.equal(1_000);
    expect(await market.priceOf(datasetId, 1)).to.equal(5_000);
    expect((await datasets.getDataset(datasetId)).status).to.equal(1);
    await expect(
      market.connect(contributor).listCopy(datasetId, 2_000),
    ).to.be.revertedWithCustomError(market, "ListingAlreadyActive");
    await market.connect(contributor).delist(datasetId, 0);
    await market.connect(contributor).listCopy(datasetId, 2_000);
    expect(await market.priceOf(datasetId, 0)).to.equal(2_000);
  });

  it("enforces contributor ownership, nonzero prices, and pause behavior", async function () {
    const { market, config, admin, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await expect(market.connect(buyer).listCopy(datasetId, 1)).to.be.revertedWithCustomError(
      market,
      "DatasetNotOwned",
    );
    await expect(market.connect(contributor).listCopy(datasetId, 0)).to.be.revertedWithCustomError(
      market,
      "InvalidPrice",
    );
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await config.connect(admin).pause();
    await expect(market.connect(buyer).buyCopy(datasetId)).to.be.revertedWithCustomError(
      market,
      "ProtocolPaused",
    );
    await market.connect(contributor).delist(datasetId, 0);
    await expect(
      market.connect(contributor).listCopy(datasetId, 1_000),
    ).to.be.revertedWithCustomError(market, "ProtocolPaused");
  });

  it("lists during review but blocks purchase until the exact deadline", async function () {
    const { market, datasets, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await expect(market.connect(buyer).buyCopy(datasetId)).to.be.revertedWithCustomError(
      market,
      "DatasetNotPurchasable",
    );
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await market.connect(buyer).buyCopy(datasetId);
  });

  it("completes an atomic Copy purchase with fee, revenue, NFT, and duplicate guard", async function () {
    const { market, datasets, nft, splitter, token, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await expect(market.connect(buyer).buyCopy(datasetId))
      .to.emit(market, "CopyPurchased")
      .withArgs(datasetId, buyer.address, 1_000);
    expect(await token.balanceOf(await splitter.getAddress())).to.equal(1_000);
    expect(await splitter.treasuryBalance()).to.equal(25);
    expect(await splitter.cumulativeRevenue(datasetId)).to.equal(975);
    expect((await datasets.getDataset(datasetId)).copiesSold).to.equal(1);
    expect(await nft.balanceOf(buyer.address, await nft.tokenId(datasetId, 0))).to.equal(1);
    await expect(market.connect(buyer).buyCopy(datasetId)).to.be.revertedWithCustomError(
      market,
      "DuplicateCopyLicense",
    );
  });

  it("automatically closes true-exclusive listing on the first Copy sale", async function () {
    const d = await networkHelpers.loadFixture(deployFixture);
    await d.register(true);
    const id = 2n;
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    await d.market.connect(d.contributor).listExclusiveFixed(id, 5_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));
    await expect(d.market.connect(d.buyer).buyCopy(id))
      .to.emit(d.market, "ListingDelisted")
      .withArgs(id, 1);
    expect(await d.market.priceOf(id, 1)).to.equal(0);
    await expect(
      d.market.connect(d.contributor).listExclusiveFixed(id, 5_000),
    ).to.be.revertedWithCustomError(d.market, "ExclusiveRequiresZeroCopies");
  });

  it("completes Exclusive purchase and permanently closes both listings", async function () {
    const { market, datasets, nft, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await market.connect(contributor).listExclusiveFixed(datasetId, 5_000);
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await expect(market.connect(buyer).buyExclusive(datasetId))
      .to.emit(market, "ExclusivePurchased")
      .withArgs(datasetId, buyer.address, 5_000);
    expect((await datasets.getDataset(datasetId)).status).to.equal(2);
    expect(await market.priceOf(datasetId, 0)).to.equal(0);
    expect(await market.priceOf(datasetId, 1)).to.equal(0);
    expect(await nft.balanceOf(buyer.address, await nft.tokenId(datasetId, 1))).to.equal(1);
    await expect(
      market.connect(contributor).listCopy(datasetId, 1_000),
    ).to.be.revertedWithCustomError(market, "DatasetNotListable");
  });

  it("atomically invalidates actual listings when a challenge is upheld", async function () {
    const { market, datasets, admin, contributor, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await market.connect(contributor).listExclusiveFixed(datasetId, 5_000);
    await datasets.connect(admin).recordChallenge(datasetId, ethers.id("evidence"));
    await datasets.connect(admin).resolveChallenge(datasetId, true);
    expect(await market.priceOf(datasetId, 0)).to.equal(0);
    expect(await market.priceOf(datasetId, 1)).to.equal(0);
    expect(await datasets.weightsInvalidated(datasetId)).to.equal(true);
  });

  it("allows only governance to authorize a Marketplace UUPS upgrade", async function () {
    const { market, governance, buyer } = await networkHelpers.loadFixture(deployFixture);
    const proxy = await market.getAddress();
    const unauthorized = await ethers.getContractFactory("MarketplaceV2", buyer);
    await expect(
      upgradesApi.upgradeProxy(proxy, unauthorized, { kind: "uups" }),
    ).to.be.revertedWithCustomError(market, "AccessControlUnauthorizedAccount");

    const authorized = await ethers.getContractFactory("MarketplaceV2", governance);
    const upgraded = await upgradesApi.upgradeProxy(proxy, authorized, { kind: "uups" });
    expect(await upgraded.version()).to.equal(2);
    expect(await upgraded.datasetRegistry()).to.equal(await market.datasetRegistry());
  });
});

import { expect } from "chai";
import { AbiCoder, keccak256, MaxUint256, ZeroAddress } from "ethers";
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
      const expectedDatasetId = await datasets.nextDatasetId();
      await datasets.connect(contributor).registerDataset({
        expectedDatasetId,
        contentHash: ethers.id(`payload-${exclusiveRequiresZeroCopies}`),
        sampleURI: "ipfs://sample",
        payloadURI: "ipfs://payload",
        weightsRoot: root,
        totalWeight: weight,
        weightsURI: `ipfs://weights-manifest-${expectedDatasetId}`,
        weightsManifestHash: ethers.id(`weights-manifest-${expectedDatasetId}`),
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

  it("rejects every zero-address Marketplace initializer dependency", async function () {
    const d = await networkHelpers.loadFixture(deployFixture);
    const factory = await ethers.getContractFactory("Marketplace");
    const valid = [
      await d.config.getAddress(),
      await d.datasets.getAddress(),
      await d.nft.getAddress(),
      await d.splitter.getAddress(),
      d.governance.address,
    ];
    for (let index = 0; index < valid.length; ++index) {
      const args = [...valid] as [string, string, string, string, string];
      args[index] = ZeroAddress;
      await expect(
        upgradesApi.deployProxy(factory, args, { kind: "uups" }),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    }
  });

  it("rejects purchases when the requested listing is missing or inactive", async function () {
    const { market, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await expect(market.connect(buyer).buyCopy(datasetId, 0, MaxUint256))
      .to.be.revertedWithCustomError(market, "ListingNotActive")
      .withArgs(datasetId, 0);

    await market.connect(contributor).listExclusiveFixed(datasetId, 5_000);
    await market.connect(contributor).delist(datasetId, 1);
    await expect(market.connect(buyer).buyExclusive(datasetId, 5_000, MaxUint256))
      .to.be.revertedWithCustomError(market, "ListingNotActive")
      .withArgs(datasetId, 1);
  });

  it("retains the buyExclusive zero-copy defense for an inconsistent registry state", async function () {
    const [governance, admin, contributor, buyer, paymentToken, treasury, gateway] =
      await ethers.getSigners();
    const config = await ethers.deployContract("ProtocolConfig", [
      paymentToken.address,
      250,
      treasury.address,
      WINDOW,
      gateway.address,
      governance.address,
      admin.address,
    ]);
    const inconsistent = await ethers.deployContract("InconsistentDatasetRegistry", [
      contributor.address,
    ]);
    const factory = await ethers.getContractFactory("Marketplace");
    const market = await upgradesApi.deployProxy(
      factory,
      [
        await config.getAddress(),
        await inconsistent.getAddress(),
        buyer.address,
        treasury.address,
        governance.address,
      ],
      { kind: "uups" },
    );

    await market.connect(contributor).listExclusiveFixed(1, 5_000);
    await inconsistent.setCopiesSold(1);
    await expect(market.connect(buyer).buyExclusive(1, 5_000, MaxUint256))
      .to.be.revertedWithCustomError(market, "ExclusiveRequiresZeroCopies")
      .withArgs(1, 1);
  });

  it("creates concurrent fixed listings and changes price only by delist/relist", async function () {
    const { market, datasets, contributor, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await expect(market.connect(contributor).listCopy(datasetId, 1_000))
      .to.emit(market, "CopyListed")
      .withArgs(datasetId, 1_000, 250);
    await expect(market.connect(contributor).listExclusiveFixed(datasetId, 5_000))
      .to.emit(market, "ExclusiveListed")
      .withArgs(datasetId, 5_000, 250);
    expect(await market.priceOf(datasetId, 0)).to.equal(1_000);
    expect(await market.priceOf(datasetId, 1)).to.equal(5_000);
    expect((await datasets.getDataset(datasetId)).status).to.equal(1);
    await expect(
      market.connect(contributor).listCopy(datasetId, 2_000),
    ).to.be.revertedWithCustomError(market, "ListingAlreadyActive");
    await expect(market.connect(contributor).delist(datasetId, 0))
      .to.emit(market, "ListingDelisted")
      .withArgs(datasetId, 0);
    await expect(market.connect(contributor).delist(datasetId, 0)).to.be.revertedWithCustomError(
      market,
      "ListingNotActive",
    );
    await market.connect(contributor).listCopy(datasetId, 2_000);
    expect(await market.priceOf(datasetId, 0)).to.equal(2_000);
    const listing = await market.getListing(datasetId, 0);
    expect(listing.datasetId).to.equal(datasetId);
    expect(listing.kind).to.equal(0);
    expect(listing.price).to.equal(2_000);
    expect(listing.maxFeeBps).to.equal(250);
    expect(listing.active).to.equal(true);

    const missingListing = await market.getListing(999, 1);
    expect(missingListing.datasetId).to.equal(999);
    expect(missingListing.kind).to.equal(1);
    expect(missingListing.price).to.equal(0);
    expect(missingListing.maxFeeBps).to.equal(0);
    expect(missingListing.active).to.equal(false);
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
    await market.connect(contributor).listExclusiveFixed(datasetId, 5_000);
    await expect(market.connect(buyer).delist(datasetId, 0)).to.be.revertedWithCustomError(
      market,
      "DatasetNotOwned",
    );
    await config.connect(admin).pause();
    await expect(
      market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256),
    ).to.be.revertedWithCustomError(market, "ProtocolPaused");
    await expect(
      market.connect(buyer).buyExclusive(datasetId, 5_000, MaxUint256),
    ).to.be.revertedWithCustomError(market, "ProtocolPaused");
    await market.connect(contributor).delist(datasetId, 0);
    await expect(
      market.connect(contributor).listCopy(datasetId, 1_000),
    ).to.be.revertedWithCustomError(market, "ProtocolPaused");
  });

  it("lists during review but blocks purchase until the exact deadline", async function () {
    const { market, datasets, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await expect(
      market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256),
    ).to.be.revertedWithCustomError(market, "DatasetNotPurchasable");
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256);
  });

  it("completes an atomic Copy purchase with fee, revenue, NFT, and duplicate guard", async function () {
    const { market, datasets, nft, splitter, token, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await expect(market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256))
      .to.emit(market, "CopyPurchased")
      .withArgs(datasetId, buyer.address, 1_000);
    expect(await token.balanceOf(await splitter.getAddress())).to.equal(1_000);
    expect(await splitter.treasuryBalance()).to.equal(25);
    expect(await splitter.cumulativeRevenue(datasetId)).to.equal(975);
    expect((await datasets.getDataset(datasetId)).copiesSold).to.equal(1);
    expect(await nft.balanceOf(buyer.address, await nft.tokenId(datasetId, 0))).to.equal(1);
    await expect(
      market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256),
    ).to.be.revertedWithCustomError(market, "DuplicateCopyLicense");
  });

  it("allows distinct buyers to purchase one Copy license each", async function () {
    const { market, datasets, nft, contributor, buyer, buyer2, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );

    await market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256);
    await market.connect(buyer2).buyCopy(datasetId, 1_000, MaxUint256);

    const copyId = await nft.tokenId(datasetId, 0);
    expect(await nft.balanceOf(buyer.address, copyId)).to.equal(1);
    expect(await nft.balanceOf(buyer2.address, copyId)).to.equal(1);
    expect((await datasets.getDataset(datasetId)).copiesSold).to.equal(2);
  });

  it("requires relisting before a higher protocol fee can apply to a seller", async function () {
    const { market, datasets, splitter, config, governance, contributor, buyer } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(1, 1_000);
    await config.connect(governance).setFeeBps(500);
    await networkHelpers.time.setNextBlockTimestamp(await datasets.challengeWindowEndsAt(1));
    await expect(market.connect(buyer).buyCopy(1, 1_000, MaxUint256))
      .to.be.revertedWithCustomError(market, "ListingFeeExceeded")
      .withArgs(250, 500);

    await market.connect(contributor).delist(1, 0);
    await market.connect(contributor).listCopy(1, 1_000);
    expect((await market.getListing(1, 0)).maxFeeBps).to.equal(500);
    await market.connect(buyer).buyCopy(1, 1_000, MaxUint256);

    expect(await splitter.cumulativeRevenue(1)).to.equal(950);
    expect(await splitter.treasuryBalance()).to.equal(50);
  });

  it("rejects stale buyer prices and expired purchase deadlines", async function () {
    const { market, datasets, contributor, buyer, datasetId } =
      await networkHelpers.loadFixture(deployFixture);
    await market.connect(contributor).listCopy(datasetId, 1_000);
    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );

    await expect(market.connect(buyer).buyCopy(datasetId, 999, MaxUint256))
      .to.be.revertedWithCustomError(market, "PurchasePriceChanged")
      .withArgs(999, 1_000);

    const expired = BigInt(await networkHelpers.time.latest());
    await networkHelpers.time.setNextBlockTimestamp(expired + 1n);
    await expect(market.connect(buyer).buyCopy(datasetId, 1_000, expired))
      .to.be.revertedWithCustomError(market, "PurchaseDeadlineExpired")
      .withArgs(expired, expired + 1n);

    await market.connect(contributor).delist(datasetId, 0);
    await market.connect(contributor).listCopy(datasetId, 2_000);
    await expect(market.connect(buyer).buyCopy(datasetId, 1_000, MaxUint256))
      .to.be.revertedWithCustomError(market, "PurchasePriceChanged")
      .withArgs(1_000, 2_000);
  });

  it("automatically closes true-exclusive listing on the first Copy sale", async function () {
    const d = await networkHelpers.loadFixture(deployFixture);
    await d.register(true);
    const id = 2n;
    await d.market.connect(d.contributor).listCopy(id, 1_000);
    await d.market.connect(d.contributor).listExclusiveFixed(id, 5_000);
    await networkHelpers.time.setNextBlockTimestamp(await d.datasets.challengeWindowEndsAt(id));
    await expect(d.market.connect(d.buyer).buyCopy(id, 1_000, MaxUint256))
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
    await expect(market.connect(buyer).buyExclusive(datasetId, 5_000, MaxUint256))
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
    await datasets
      .connect(admin)
      .recordChallenge(datasetId, ethers.id("evidence"), "ipfs://evidence");
    await datasets.connect(admin).resolveChallenge(datasetId, true);
    expect(await market.priceOf(datasetId, 0)).to.equal(0);
    expect(await market.priceOf(datasetId, 1)).to.equal(0);
    expect(await datasets.weightsInvalidated(datasetId)).to.equal(true);
  });

  it("allows only DatasetRegistry to invalidate listings", async function () {
    const { market, buyer, datasetId } = await networkHelpers.loadFixture(deployFixture);
    await expect(market.connect(buyer).invalidateListings(datasetId))
      .to.be.revertedWithCustomError(market, "OnlyDatasetRegistry")
      .withArgs(buyer.address);
  });

  it("allows only governance to authorize a Marketplace UUPS upgrade", async function () {
    const { market, governance, buyer } = await networkHelpers.loadFixture(deployFixture);
    const proxy = await market.getAddress();
    const unauthorized = await ethers.getContractFactory("MarketplaceV2", buyer);
    await expect(upgradesApi.upgradeProxy(proxy, unauthorized, { kind: "uups" }))
      .to.be.revertedWithCustomError(market, "OnlyGovernanceTimelock")
      .withArgs(buyer.address);

    const authorized = await ethers.getContractFactory("MarketplaceV2", governance);
    const upgraded = await upgradesApi.upgradeProxy(proxy, authorized, { kind: "uups" });
    expect(await upgraded.version()).to.equal(2);
    expect(await upgraded.datasetRegistry()).to.equal(await market.datasetRegistry());
  });
});

import { expect } from "chai";
import { AbiCoder, ZeroAddress, keccak256 } from "ethers";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const CHALLENGE_WINDOW = 7 * 24 * 60 * 60;

describe("EntitlementNFT", function () {
  function params() {
    return {
      contentHash: ethers.id("payload"),
      sampleURI: "ipfs://sample",
      payloadURI: "ipfs://payload",
      weightsRoot: ethers.id("weights"),
      totalWeight: 100n,
      policy: {
        allowCopy: true,
        allowExclusive: true,
        exclusiveRequiresZeroCopies: false,
        licensesTransferable: false,
      },
      tag: "test",
    };
  }

  async function deployFixture() {
    const [
      governance,
      admin,
      contributor,
      buyer,
      nextOwner,
      outsider,
      paymentToken,
      treasury,
      gatewaySigner,
    ] = await ethers.getSigners();

    const contributors = await ethers.deployContract("ContributorRegistry", [
      governance.address,
      admin.address,
    ]);
    const config = await ethers.deployContract("ProtocolConfig", [
      paymentToken.address,
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
    const nft = await ethers.deployContract("EntitlementNFT", [
      await datasets.getAddress(),
      governance.address,
      admin.address,
    ]);

    await contributors
      .connect(admin)
      .grantRole(await contributors.CONTRIBUTOR_ROLE(), contributor.address);
    await datasets.connect(admin).setMarketplaceOnce(await marketplace.getAddress());
    await nft.connect(admin).setMarketplaceOnce(await marketplace.getAddress());
    await datasets.connect(contributor).registerDataset(params());

    return {
      governance,
      admin,
      contributor,
      buyer,
      nextOwner,
      outsider,
      datasets,
      marketplace,
      nft,
      datasetId: 1n,
    };
  }

  async function copyMintedFixture() {
    const deployment = await deployFixture();
    await deployment.marketplace.markListed(deployment.datasetId);
    await deployment.marketplace.mintEntitlement(
      await deployment.nft.getAddress(),
      deployment.buyer.address,
      deployment.datasetId,
      0,
    );
    return deployment;
  }

  async function exclusiveMintedFixture() {
    const deployment = await copyMintedFixture();
    await networkHelpers.time.setNextBlockTimestamp(
      await deployment.datasets.challengeWindowEndsAt(deployment.datasetId),
    );
    await deployment.marketplace.recordCopySale(deployment.datasetId);
    await deployment.marketplace.recordExclusiveSale(deployment.datasetId);
    await deployment.marketplace.mintEntitlement(
      await deployment.nft.getAddress(),
      deployment.buyer.address,
      deployment.datasetId,
      1,
    );
    return deployment;
  }

  it("wires Marketplace once and rejects unauthorized or invalid wiring", async function () {
    const { datasets, governance, admin, outsider } =
      await networkHelpers.loadFixture(deployFixture);
    const fresh = await ethers.deployContract("EntitlementNFT", [
      await datasets.getAddress(),
      governance.address,
      admin.address,
    ]);
    const mock = await ethers.deployContract("MockMarketplace", [await datasets.getAddress()]);

    await expect(
      fresh.connect(outsider).setMarketplaceOnce(await mock.getAddress()),
    ).to.be.revertedWithCustomError(fresh, "AccessControlUnauthorizedAccount");
    await expect(fresh.connect(outsider).mint(outsider.address, 1, 0))
      .to.be.revertedWithCustomError(fresh, "OnlyMarketplace")
      .withArgs(outsider.address);
    await expect(
      fresh.connect(admin).setMarketplaceOnce(ZeroAddress),
    ).to.be.revertedWithCustomError(fresh, "InvalidMarketplace");
    await expect(fresh.connect(admin).setMarketplaceOnce(await mock.getAddress()))
      .to.emit(fresh, "MarketplaceWired")
      .withArgs(await mock.getAddress());
    await expect(
      fresh.connect(admin).setMarketplaceOnce(await mock.getAddress()),
    ).to.be.revertedWithCustomError(fresh, "MarketplaceAlreadyWired");
  });

  it("derives the documented token ID", async function () {
    const { nft, datasetId } = await networkHelpers.loadFixture(deployFixture);
    const expected = BigInt(
      keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "uint8"], [datasetId, 0])),
    );
    expect(await nft.tokenId(datasetId, 0)).to.equal(expected);
  });

  it("restricts minting to Marketplace and the required Dataset state", async function () {
    const { nft, marketplace, buyer, outsider, datasetId } =
      await networkHelpers.loadFixture(deployFixture);

    await expect(nft.connect(outsider).mint(buyer.address, datasetId, 0))
      .to.be.revertedWithCustomError(nft, "OnlyMarketplace")
      .withArgs(outsider.address);
    await expect(
      marketplace.mintEntitlement(await nft.getAddress(), buyer.address, datasetId, 0),
    ).to.be.revertedWithCustomError(nft, "InvalidMintState");
  });

  it("mints one Copy license and rejects a duplicate wallet purchase", async function () {
    const { nft, marketplace, buyer, datasetId } =
      await networkHelpers.loadFixture(copyMintedFixture);
    const copyId = await nft.tokenId(datasetId, 0);
    expect(await nft.balanceOf(buyer.address, copyId)).to.equal(1);
    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(true);

    await expect(marketplace.mintEntitlement(await nft.getAddress(), buyer.address, datasetId, 0))
      .to.be.revertedWithCustomError(nft, "DuplicateCopyLicense")
      .withArgs(datasetId, buyer.address);
  });

  it("rejects single Copy transfers", async function () {
    const { nft, buyer, nextOwner, datasetId } =
      await networkHelpers.loadFixture(copyMintedFixture);
    const copyId = await nft.tokenId(datasetId, 0);

    await expect(
      nft.connect(buyer).safeTransferFrom(buyer.address, nextOwner.address, copyId, 1, "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);
  });

  it("rejects zero-value single and batch Copy transfers", async function () {
    const { nft, buyer, nextOwner, datasetId } =
      await networkHelpers.loadFixture(copyMintedFixture);
    const copyId = await nft.tokenId(datasetId, 0);

    await expect(
      nft.connect(buyer).safeTransferFrom(buyer.address, nextOwner.address, copyId, 0, "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);
    await expect(
      nft
        .connect(buyer)
        .safeBatchTransferFrom(buyer.address, nextOwner.address, [copyId], [0], "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);
  });

  it("rejects zero-value transfers before a Copy license or Exclusive title exists", async function () {
    const { nft, buyer, nextOwner, datasetId } = await networkHelpers.loadFixture(deployFixture);
    const copyId = await nft.tokenId(datasetId, 0);
    const exclusiveId = await nft.tokenId(datasetId, 1);

    await expect(
      nft.connect(buyer).safeTransferFrom(buyer.address, nextOwner.address, copyId, 0, "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);
    await expect(
      nft
        .connect(buyer)
        .safeBatchTransferFrom(buyer.address, nextOwner.address, [copyId], [0], "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);

    await expect(
      nft.connect(buyer).safeTransferFrom(buyer.address, nextOwner.address, exclusiveId, 0, "0x"),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(exclusiveId);
  });

  it("applies exclusive access and follows Exclusive title transfers", async function () {
    const { nft, buyer, nextOwner, datasetId } =
      await networkHelpers.loadFixture(exclusiveMintedFixture);
    const exclusiveId = await nft.tokenId(datasetId, 1);

    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(true);
    await nft
      .connect(buyer)
      .safeTransferFrom(buyer.address, nextOwner.address, exclusiveId, 1, "0x");
    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(false);
    expect(await nft.hasAccess(datasetId, nextOwner.address)).to.equal(true);
  });

  it("enforces ERC-1155 receiver checks for Exclusive transfers", async function () {
    const { nft, buyer, datasetId } = await networkHelpers.loadFixture(exclusiveMintedFixture);
    const receiver = await ethers.deployContract("NonERC1155Receiver");
    const exclusiveId = await nft.tokenId(datasetId, 1);

    await expect(
      nft
        .connect(buyer)
        .safeTransferFrom(buyer.address, await receiver.getAddress(), exclusiveId, 1, "0x"),
    ).to.be.revertedWithCustomError(nft, "ERC1155InvalidReceiver");
  });

  it("removes Gateway access from a prior Copy holder after an Exclusive sale", async function () {
    const { nft, datasets, marketplace, buyer, nextOwner, datasetId } =
      await networkHelpers.loadFixture(copyMintedFixture);
    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(true);

    await networkHelpers.time.setNextBlockTimestamp(
      await datasets.challengeWindowEndsAt(datasetId),
    );
    await marketplace.recordCopySale(datasetId);
    await marketplace.recordExclusiveSale(datasetId);
    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(false);

    await marketplace.mintEntitlement(await nft.getAddress(), nextOwner.address, datasetId, 1);
    expect(await nft.hasAccess(datasetId, buyer.address)).to.equal(false);
    expect(await nft.hasAccess(datasetId, nextOwner.address)).to.equal(true);
  });

  it("rejects a second Exclusive mint and a batch containing Copy", async function () {
    const { nft, marketplace, buyer, nextOwner, datasetId } =
      await networkHelpers.loadFixture(exclusiveMintedFixture);
    const copyId = await nft.tokenId(datasetId, 0);
    const exclusiveId = await nft.tokenId(datasetId, 1);

    await expect(
      marketplace.mintEntitlement(await nft.getAddress(), nextOwner.address, datasetId, 1),
    )
      .to.be.revertedWithCustomError(nft, "ExclusiveTitleAlreadyMinted")
      .withArgs(datasetId);

    await expect(
      nft
        .connect(buyer)
        .safeBatchTransferFrom(
          buyer.address,
          nextOwner.address,
          [copyId, exclusiveId],
          [1, 1],
          "0x",
        ),
    )
      .to.be.revertedWithCustomError(nft, "CopyLicenseNonTransferable")
      .withArgs(copyId);
  });

  it("returns false for unknown Datasets and the zero address", async function () {
    const { nft, outsider } = await networkHelpers.loadFixture(deployFixture);
    expect(await nft.hasAccess(999, outsider.address)).to.equal(false);
    expect(await nft.hasAccess(1, ZeroAddress)).to.equal(false);
  });
});

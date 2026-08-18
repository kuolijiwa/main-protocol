import { expect } from "chai";
import { AbiCoder, ZeroAddress, keccak256 } from "ethers";
import { network } from "hardhat";
import {
  buildWeightsManifest,
  fetchAndValidateWeightsManifest,
  hashWeightsManifest,
} from "../../scripts/lib/weights-manifest.js";

const { ethers, networkHelpers } = await network.create();

const DAY = 24 * 60 * 60;
const CHALLENGE_WINDOW = 7 * DAY;

describe("DatasetRegistry", function () {
  function validParams(expectedDatasetId = 1n) {
    return {
      expectedDatasetId,
      contentHash: ethers.id("encrypted-payload"),
      sampleURI: "ipfs://sample",
      payloadURI: "ipfs://encrypted-payload",
      weightsRoot: ethers.id("weights-root"),
      totalWeight: 1_000n,
      weightsURI: `ipfs://weights-manifest-${expectedDatasetId}`,
      weightsManifestHash: ethers.id(`weights-manifest-${expectedDatasetId}`),
      policy: {
        allowCopy: true,
        allowExclusive: true,
        exclusiveRequiresZeroCopies: false,
        licensesTransferable: false,
      },
      tag: "robotics/dexterity",
    };
  }

  async function deployUnwiredFixture() {
    const [
      governance,
      admin,
      contributor,
      operator,
      secondContributor,
      outsider,
      paymentToken,
      treasury,
      gatewaySigner,
    ] = await ethers.getSigners();

    const contributorRegistry = await ethers.deployContract("ContributorRegistry", [
      governance.address,
      admin.address,
    ]);
    const protocolConfig = await ethers.deployContract("ProtocolConfig", [
      paymentToken.address,
      250,
      treasury.address,
      CHALLENGE_WINDOW,
      gatewaySigner.address,
      governance.address,
      admin.address,
    ]);
    const datasetRegistry = await ethers.deployContract("DatasetRegistry", [
      await contributorRegistry.getAddress(),
      await protocolConfig.getAddress(),
      governance.address,
      admin.address,
    ]);

    await contributorRegistry.waitForDeployment();
    await protocolConfig.waitForDeployment();
    await datasetRegistry.waitForDeployment();

    await contributorRegistry
      .connect(admin)
      .grantRole(await contributorRegistry.CONTRIBUTOR_ROLE(), contributor.address);
    await contributorRegistry
      .connect(admin)
      .grantRole(await contributorRegistry.OPERATOR_ROLE(), operator.address);
    await contributorRegistry
      .connect(admin)
      .grantRole(await contributorRegistry.CONTRIBUTOR_ROLE(), secondContributor.address);
    await contributorRegistry
      .connect(admin)
      .setOperatorContributor(operator.address, contributor.address);

    return {
      governance,
      admin,
      contributor,
      operator,
      secondContributor,
      outsider,
      contributorRegistry,
      protocolConfig,
      datasetRegistry,
    };
  }

  async function deployFixture() {
    const deployment = await deployUnwiredFixture();
    const { datasetRegistry, admin } = deployment;
    const marketplace = await ethers.deployContract("MockMarketplace", [
      await datasetRegistry.getAddress(),
    ]);
    await marketplace.waitForDeployment();
    await datasetRegistry.connect(admin).setMarketplaceOnce(await marketplace.getAddress());
    return { ...deployment, marketplace };
  }

  async function registeredFixture() {
    const deployment = await deployFixture();
    await deployment.datasetRegistry.connect(deployment.contributor).registerDataset(validParams());
    return { ...deployment, datasetId: 1n };
  }

  describe("wiring and registration", function () {
    it("rejects every zero-address constructor dependency", async function () {
      const [contributors, config, governance, admin] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("DatasetRegistry");
      const valid = [contributors.address, config.address, governance.address, admin.address];
      for (let index = 0; index < valid.length; ++index) {
        const args = [...valid] as [string, string, string, string];
        args[index] = ZeroAddress;
        await expect(factory.deploy(...args)).to.be.revertedWithCustomError(factory, "ZeroAddress");
      }
    });

    it("requires one-time ADMIN wiring to a contract", async function () {
      const { datasetRegistry, protocolConfig, admin, outsider } =
        await networkHelpers.loadFixture(deployUnwiredFixture);
      const marketplace = await ethers.deployContract("MockMarketplace", [
        await datasetRegistry.getAddress(),
      ]);

      await expect(
        datasetRegistry.connect(outsider).setMarketplaceOnce(await marketplace.getAddress()),
      ).to.be.revertedWithCustomError(datasetRegistry, "AccessControlUnauthorizedAccount");
      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(ZeroAddress),
      ).to.be.revertedWithCustomError(datasetRegistry, "InvalidMarketplace");
      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(outsider.address),
      ).to.be.revertedWithCustomError(datasetRegistry, "InvalidMarketplace");
      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(await protocolConfig.getAddress()),
      ).to.be.revertedWithCustomError(datasetRegistry, "InvalidMarketplace");
      const mismatched = await ethers.deployContract("MockMarketplace", [outsider.address]);
      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(await mismatched.getAddress()),
      ).to.be.revertedWithCustomError(datasetRegistry, "InvalidMarketplace");

      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(await marketplace.getAddress()),
      )
        .to.emit(datasetRegistry, "MarketplaceWired")
        .withArgs(await marketplace.getAddress());
      await expect(
        datasetRegistry.connect(admin).setMarketplaceOnce(await marketplace.getAddress()),
      ).to.be.revertedWithCustomError(datasetRegistry, "MarketplaceAlreadyWired");
    });

    it("blocks registration before wiring and while paused", async function () {
      const unwired = await networkHelpers.loadFixture(deployUnwiredFixture);
      await expect(
        unwired.datasetRegistry.connect(unwired.contributor).registerDataset(validParams()),
      ).to.be.revertedWithCustomError(unwired.datasetRegistry, "MarketplaceNotWired");

      const wired = await networkHelpers.loadFixture(deployFixture);
      await wired.protocolConfig.connect(wired.admin).pause();
      await expect(
        wired.datasetRegistry.connect(wired.contributor).registerDataset(validParams()),
      ).to.be.revertedWithCustomError(wired.datasetRegistry, "ProtocolPaused");
    });

    it("registers an immutable Draft Dataset and snapshots the deadline", async function () {
      const { datasetRegistry, contributor } = await networkHelpers.loadFixture(deployFixture);
      const params = validParams();

      const tx = await datasetRegistry.connect(contributor).registerDataset(params);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(datasetRegistry, "DatasetRegistered")
        .withArgs(
          1,
          contributor.address,
          params.contentHash,
          params.weightsRoot,
          params.totalWeight,
          params.weightsURI,
          params.weightsManifestHash,
          await datasetRegistry.WEIGHTS_MANIFEST_VERSION(),
        );

      const dataset = await datasetRegistry.getDataset(1);
      expect(dataset.id).to.equal(1);
      expect(dataset.contributor).to.equal(contributor.address);
      expect(dataset.contentHash).to.equal(params.contentHash);
      expect(dataset.sampleURI).to.equal(params.sampleURI);
      expect(dataset.payloadURI).to.equal(params.payloadURI);
      expect(dataset.weightsRoot).to.equal(params.weightsRoot);
      expect(dataset.totalWeight).to.equal(params.totalWeight);
      expect(await datasetRegistry.weightsURI(1)).to.equal(params.weightsURI);
      expect(await datasetRegistry.weightsManifestHash(1)).to.equal(params.weightsManifestHash);
      expect(await datasetRegistry.nextDatasetId()).to.equal(2);
      expect(dataset.status).to.equal(0);
      expect(dataset.policy.allowCopy).to.equal(params.policy.allowCopy);
      expect(dataset.policy.allowExclusive).to.equal(params.policy.allowExclusive);
      expect(dataset.policy.exclusiveRequiresZeroCopies).to.equal(
        params.policy.exclusiveRequiresZeroCopies,
      );
      expect(dataset.policy.licensesTransferable).to.equal(params.policy.licensesTransferable);
      expect(dataset.copiesSold).to.equal(0);
      expect(dataset.tag).to.equal(params.tag);
      expect(dataset.createdAt).to.equal(block!.timestamp);
      expect(await datasetRegistry.challengeWindowEndsAt(1)).to.equal(
        BigInt(block!.timestamp + CHALLENGE_WINDOW),
      );
      expect(await datasetRegistry.challengeStatus(1)).to.equal(0);
      expect(await datasetRegistry.weightsInvalidated(1)).to.equal(false);
    });

    it("lets an independent claimant discover and verify the committed Manifest", async function () {
      const { datasetRegistry, contributor } = await networkHelpers.loadFixture(deployFixture);
      const registryAddress = await datasetRegistry.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const totalWeight = 1_000n;
      const weightsRoot = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [contributor.address, totalWeight],
        ),
      );
      const manifest = buildWeightsManifest({
        datasetId: 1n,
        chainId,
        datasetRegistry: registryAddress,
        totalWeight,
        weightsRoot,
        entries: [{ address: contributor.address, weight: totalWeight }],
        pipelineVersion: "pipeline-v1.0.0",
        generatedAt: "2026-08-18T00:00:00.000Z",
        contentDigest: ethers.id("source-content"),
      });
      const raw = `${JSON.stringify(manifest, null, 2)}\n`;
      const uri = "ipfs://committed-weights-manifest";
      await datasetRegistry.connect(contributor).registerDataset({
        ...validParams(),
        weightsRoot,
        totalWeight,
        weightsURI: uri,
        weightsManifestHash: hashWeightsManifest(raw),
      });

      const dataset = await datasetRegistry.getDataset(1);
      const verified = await fetchAndValidateWeightsManifest(
        await datasetRegistry.weightsURI(1),
        await datasetRegistry.weightsManifestHash(1),
        {
          datasetId: 1n,
          chainId,
          datasetRegistry: registryAddress,
          totalWeight: dataset.totalWeight,
          weightsRoot: dataset.weightsRoot,
        },
        async () => raw,
      );
      expect(verified.entries[0].address).to.equal(contributor.address);
      expect(verified.entries[0].weight).to.equal(totalWeight);
      expect(verified.entries[0].proof).to.deep.equal([]);
    });

    it("uses direct CONTRIBUTOR identity before OPERATOR assignment", async function () {
      const { datasetRegistry, contributorRegistry, admin, operator, secondContributor } =
        await networkHelpers.loadFixture(deployFixture);

      await datasetRegistry.connect(operator).registerDataset(validParams());
      expect((await datasetRegistry.getDataset(1)).contributor).to.equal(
        (await ethers.getSigners())[2].address,
      );

      await contributorRegistry
        .connect(admin)
        .grantRole(await contributorRegistry.CONTRIBUTOR_ROLE(), operator.address);
      await contributorRegistry
        .connect(admin)
        .setOperatorContributor(operator.address, secondContributor.address);
      await datasetRegistry.connect(operator).registerDataset(validParams(2n));
      expect((await datasetRegistry.getDataset(2)).contributor).to.equal(operator.address);
    });

    it("rejects unauthorized and no-longer-valid operator attribution", async function () {
      const { datasetRegistry, contributorRegistry, admin, operator, contributor, outsider } =
        await networkHelpers.loadFixture(deployFixture);

      await expect(datasetRegistry.connect(outsider).registerDataset(validParams()))
        .to.be.revertedWithCustomError(datasetRegistry, "UnauthorizedRegistrar")
        .withArgs(outsider.address);

      await contributorRegistry
        .connect(admin)
        .revokeRole(await contributorRegistry.CONTRIBUTOR_ROLE(), contributor.address);
      await expect(datasetRegistry.connect(operator).registerDataset(validParams()))
        .to.be.revertedWithCustomError(datasetRegistry, "UnauthorizedRegistrar")
        .withArgs(operator.address);
    });

    it("rejects an allowlisted but unassigned OPERATOR", async function () {
      const { datasetRegistry, contributorRegistry, admin, operator } =
        await networkHelpers.loadFixture(deployFixture);
      await contributorRegistry
        .connect(admin)
        .setOperatorContributor(operator.address, ZeroAddress);

      await expect(datasetRegistry.connect(operator).registerDataset(validParams()))
        .to.be.revertedWithCustomError(datasetRegistry, "UnauthorizedRegistrar")
        .withArgs(operator.address);
    });

    it("rejects each invalid registration field", async function () {
      const { datasetRegistry, contributor } = await networkHelpers.loadFixture(deployFixture);
      const cases: Array<[string, ReturnType<typeof validParams>]> = [];

      const contentHash = validParams();
      contentHash.contentHash = ethers.ZeroHash;
      cases.push(["InvalidContentHash", contentHash]);
      const sample = validParams();
      sample.sampleURI = "";
      cases.push(["EmptySampleURI", sample]);
      const payload = validParams();
      payload.payloadURI = "";
      cases.push(["EmptyPayloadURI", payload]);
      const root = validParams();
      root.weightsRoot = ethers.ZeroHash;
      cases.push(["InvalidWeightsRoot", root]);
      const weight = validParams();
      weight.totalWeight = 0n;
      cases.push(["InvalidTotalWeight", weight]);
      const uri = validParams();
      uri.weightsURI = "";
      cases.push(["EmptyWeightsURI", uri]);
      const manifestHash = validParams();
      manifestHash.weightsManifestHash = ethers.ZeroHash;
      cases.push(["InvalidWeightsManifestHash", manifestHash]);
      const noSale = validParams();
      noSale.policy.allowCopy = false;
      noSale.policy.allowExclusive = false;
      cases.push(["NoSaleKindEnabled", noSale]);
      const transferable = validParams();
      transferable.policy.licensesTransferable = true;
      cases.push(["TransferableCopyLicenseNotSupported", transferable]);

      for (const [errorName, params] of cases) {
        await expect(
          datasetRegistry.connect(contributor).registerDataset(params),
        ).to.be.revertedWithCustomError(datasetRegistry, errorName);
      }

      const wrongId = validParams(2n);
      await expect(datasetRegistry.connect(contributor).registerDataset(wrongId))
        .to.be.revertedWithCustomError(datasetRegistry, "UnexpectedDatasetId")
        .withArgs(2, 1);
    });

    it("uses IDs from 1 and rejects unknown records", async function () {
      const { datasetRegistry } = await networkHelpers.loadFixture(deployFixture);
      await expect(datasetRegistry.getDataset(0))
        .to.be.revertedWithCustomError(datasetRegistry, "DatasetNotFound")
        .withArgs(0);
      expect(await datasetRegistry.challengeWindowEndsAt(999)).to.equal(0);
    });

    it("applies challenge-window changes only to new Datasets", async function () {
      const { datasetRegistry, protocolConfig, governance, contributor } =
        await networkHelpers.loadFixture(deployFixture);
      await datasetRegistry.connect(contributor).registerDataset(validParams());
      const first = await datasetRegistry.getDataset(1);
      expect(await datasetRegistry.challengeWindowEndsAt(1)).to.equal(
        first.createdAt + BigInt(CHALLENGE_WINDOW),
      );

      const replacementWindow = 2 * DAY;
      await protocolConfig.connect(governance).setChallengeWindow(replacementWindow);
      await datasetRegistry.connect(contributor).registerDataset(validParams(2n));
      const second = await datasetRegistry.getDataset(2);

      expect(await datasetRegistry.challengeWindowEndsAt(1)).to.equal(
        first.createdAt + BigInt(CHALLENGE_WINDOW),
      );
      expect(await datasetRegistry.challengeWindowEndsAt(2)).to.equal(
        second.createdAt + BigInt(replacementWindow),
      );
    });
  });

  describe("Marketplace lifecycle", function () {
    it("allows only Marketplace to transition Draft, Listed, and Delisted", async function () {
      const { datasetRegistry, marketplace, outsider, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);

      await expect(datasetRegistry.connect(outsider).markListed(datasetId))
        .to.be.revertedWithCustomError(datasetRegistry, "OnlyMarketplace")
        .withArgs(outsider.address);

      await marketplace.markListed(datasetId);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(1);
      await expect(marketplace.markListed(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "InvalidDatasetStatus",
      );

      await marketplace.markDelisted(datasetId);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(3);
      await marketplace.markListed(datasetId);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(1);
    });

    it("allows delisting while paused but blocks listing and sales", async function () {
      const { datasetRegistry, marketplace, protocolConfig, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await marketplace.markListed(datasetId);
      await protocolConfig.connect(admin).pause();

      await marketplace.markDelisted(datasetId);
      await expect(marketplace.markListed(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "ProtocolPaused",
      );
      await expect(marketplace.recordCopySale(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "ProtocolPaused",
      );
    });

    it("blocks sales before the deadline and permits them at the deadline", async function () {
      const { datasetRegistry, marketplace, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await marketplace.markListed(datasetId);
      const deadline = await datasetRegistry.challengeWindowEndsAt(datasetId);

      await expect(marketplace.recordCopySale(datasetId))
        .to.be.revertedWithCustomError(datasetRegistry, "ChallengeWindowOpen")
        .withArgs(datasetId, deadline);

      await networkHelpers.time.setNextBlockTimestamp(deadline);
      await marketplace.recordCopySale(datasetId);
      expect((await datasetRegistry.getDataset(datasetId)).copiesSold).to.equal(1);
    });

    it("enforces Copy and Exclusive policy including zero-copy exclusivity", async function () {
      const deployment = await networkHelpers.loadFixture(deployFixture);
      const params = validParams();
      params.policy.exclusiveRequiresZeroCopies = true;
      await deployment.datasetRegistry.connect(deployment.contributor).registerDataset(params);
      await deployment.marketplace.markListed(1);
      await networkHelpers.time.setNextBlockTimestamp(
        await deployment.datasetRegistry.challengeWindowEndsAt(1),
      );
      await deployment.marketplace.recordCopySale(1);

      await expect(deployment.marketplace.recordExclusiveSale(1))
        .to.be.revertedWithCustomError(deployment.datasetRegistry, "CopiesAlreadySold")
        .withArgs(1, 1);
    });

    it("rejects direct sales disabled by the registered license policy", async function () {
      const deployment = await networkHelpers.loadFixture(deployFixture);
      const copyDisabled = validParams();
      copyDisabled.contentHash = ethers.id("copy-disabled");
      copyDisabled.policy.allowCopy = false;
      await deployment.datasetRegistry
        .connect(deployment.contributor)
        .registerDataset(copyDisabled);

      const exclusiveDisabled = validParams();
      exclusiveDisabled.expectedDatasetId = 2n;
      exclusiveDisabled.contentHash = ethers.id("exclusive-disabled");
      exclusiveDisabled.policy.allowExclusive = false;
      await deployment.datasetRegistry
        .connect(deployment.contributor)
        .registerDataset(exclusiveDisabled);

      await deployment.marketplace.markListed(1);
      await deployment.marketplace.markListed(2);
      await networkHelpers.time.setNextBlockTimestamp(
        await deployment.datasetRegistry.challengeWindowEndsAt(2),
      );

      await expect(deployment.marketplace.recordCopySale(1))
        .to.be.revertedWithCustomError(deployment.datasetRegistry, "CopySaleNotAllowed")
        .withArgs(1);
      await expect(deployment.marketplace.recordExclusiveSale(2))
        .to.be.revertedWithCustomError(deployment.datasetRegistry, "ExclusiveSaleNotAllowed")
        .withArgs(2);
    });

    it("makes an Exclusive sale terminal", async function () {
      const { datasetRegistry, marketplace, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await marketplace.markListed(datasetId);
      await networkHelpers.time.setNextBlockTimestamp(
        await datasetRegistry.challengeWindowEndsAt(datasetId),
      );
      await marketplace.recordExclusiveSale(datasetId);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(2);
      await expect(marketplace.markDelisted(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "InvalidDatasetStatus",
      );
      await expect(marketplace.recordCopySale(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "InvalidDatasetStatus",
      );
    });
  });

  describe("weight challenge state machine", function () {
    it("rejects duplicate recording and resolution outside Pending", async function () {
      const { datasetRegistry, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);

      await expect(datasetRegistry.connect(admin).resolveChallenge(datasetId, false))
        .to.be.revertedWithCustomError(datasetRegistry, "InvalidChallengeTransition")
        .withArgs(datasetId, 0);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("first"), "ipfs://challenge-first");
      await expect(
        datasetRegistry
          .connect(admin)
          .recordChallenge(datasetId, ethers.id("again"), "ipfs://challenge-again"),
      )
        .to.be.revertedWithCustomError(datasetRegistry, "InvalidChallengeTransition")
        .withArgs(datasetId, 1);
      await datasetRegistry.connect(admin).resolveChallenge(datasetId, false);
      await expect(datasetRegistry.connect(admin).resolveChallenge(datasetId, false))
        .to.be.revertedWithCustomError(datasetRegistry, "InvalidChallengeTransition")
        .withArgs(datasetId, 2);
    });

    it("records nonzero evidence only from ADMIN before the deadline", async function () {
      const { datasetRegistry, admin, outsider, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      const evidence = ethers.id("evidence-v1");

      await expect(
        datasetRegistry.connect(outsider).recordChallenge(datasetId, evidence, "ipfs://evidence"),
      ).to.be.revertedWithCustomError(datasetRegistry, "AccessControlUnauthorizedAccount");
      await expect(
        datasetRegistry
          .connect(admin)
          .recordChallenge(datasetId, ethers.ZeroHash, "ipfs://evidence"),
      ).to.be.revertedWithCustomError(datasetRegistry, "InvalidEvidenceHash");
      await expect(
        datasetRegistry.connect(admin).recordChallenge(datasetId, evidence, ""),
      ).to.be.revertedWithCustomError(datasetRegistry, "EmptyEvidenceURI");

      const evidenceURI = "ipfs://challenge-evidence-v1";
      const tx = await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, evidence, evidenceURI);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const dueAt = BigInt(block!.timestamp + 72 * 60 * 60);
      await expect(tx)
        .to.emit(datasetRegistry, "WeightChallengePending")
        .withArgs(
          datasetId,
          evidence,
          evidenceURI,
          await datasetRegistry.CHALLENGE_EVIDENCE_VERSION(),
          dueAt,
        );
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(1);
      expect(await datasetRegistry.challengeEvidenceHash(datasetId)).to.equal(evidence);
      expect(await datasetRegistry.challengeEvidenceURI(datasetId)).to.equal(evidenceURI);
      expect(await datasetRegistry.challengeRecordedAt(datasetId)).to.equal(block!.timestamp);
      expect(await datasetRegistry.challengeResolutionDueAt(datasetId)).to.equal(dueAt);
    });

    it("blocks relisting and sales while Pending, including after the deadline", async function () {
      const { datasetRegistry, marketplace, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await marketplace.markListed(datasetId);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("evidence"), "ipfs://evidence");

      await marketplace.markDelisted(datasetId);
      await expect(marketplace.markListed(datasetId)).to.be.revertedWithCustomError(
        datasetRegistry,
        "InvalidChallengeTransition",
      );
      await datasetRegistry.connect(admin).resolveChallenge(datasetId, false);
      await marketplace.markListed(datasetId);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("second-evidence"), "ipfs://second-evidence");
      await networkHelpers.time.setNextBlockTimestamp(
        await datasetRegistry.challengeWindowEndsAt(datasetId),
      );
      await expect(marketplace.recordCopySale(datasetId))
        .to.be.revertedWithCustomError(datasetRegistry, "InvalidChallengeTransition")
        .withArgs(datasetId, 1);
    });

    it("keeps an overdue challenge Pending and permits ADMIN resolution after the SLA", async function () {
      const { datasetRegistry, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("overdue"), "ipfs://overdue");
      const dueAt = await datasetRegistry.challengeResolutionDueAt(datasetId);
      await networkHelpers.time.setNextBlockTimestamp(dueAt + 1n);

      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(1);
      await datasetRegistry.connect(admin).resolveChallenge(datasetId, false);
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(2);
    });

    it("rejects a challenge submitted at the exact deadline", async function () {
      const { datasetRegistry, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      const deadline = await datasetRegistry.challengeWindowEndsAt(datasetId);
      await networkHelpers.time.setNextBlockTimestamp(deadline);

      await expect(
        datasetRegistry.connect(admin).recordChallenge(datasetId, ethers.id("late"), "ipfs://late"),
      )
        .to.be.revertedWithCustomError(datasetRegistry, "ChallengeWindowClosed")
        .withArgs(datasetId, deadline);
    });

    it("allows rejection and another timely challenge", async function () {
      const { datasetRegistry, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("first"), "ipfs://first");
      await expect(datasetRegistry.connect(admin).resolveChallenge(datasetId, false))
        .to.emit(datasetRegistry, "WeightChallengeResolved")
        .withArgs(datasetId, false);
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(2);

      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("second"), "ipfs://second");
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(1);
      expect(await datasetRegistry.challengeEvidenceHash(datasetId)).to.equal(ethers.id("second"));
    });

    it("upholds atomically, invalidates weights, and closes listings", async function () {
      const { datasetRegistry, marketplace, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await marketplace.markListed(datasetId);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("valid-evidence"), "ipfs://valid-evidence");

      await expect(datasetRegistry.connect(admin).resolveChallenge(datasetId, true))
        .to.emit(datasetRegistry, "WeightChallengeResolved")
        .withArgs(datasetId, true);

      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(3);
      expect(await datasetRegistry.weightsInvalidated(datasetId)).to.equal(true);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(3);
      expect(await marketplace.invalidationCalls(datasetId)).to.equal(1);
      await expect(marketplace.markListed(datasetId))
        .to.be.revertedWithCustomError(datasetRegistry, "WeightsPermanentlyInvalidated")
        .withArgs(datasetId);
    });

    it("rolls back an upheld decision if Marketplace invalidation fails", async function () {
      const { datasetRegistry, marketplace, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("evidence"), "ipfs://evidence");
      await marketplace.setRejectInvalidation(true);

      await expect(
        datasetRegistry.connect(admin).resolveChallenge(datasetId, true),
      ).to.be.revertedWithCustomError(marketplace, "InvalidationRejected");
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(1);
      expect(await datasetRegistry.weightsInvalidated(datasetId)).to.equal(false);
      expect((await datasetRegistry.getDataset(datasetId)).status).to.equal(0);
    });

    it("allows challenge recording and resolution while paused", async function () {
      const { datasetRegistry, protocolConfig, admin, datasetId } =
        await networkHelpers.loadFixture(registeredFixture);
      await protocolConfig.connect(admin).pause();
      await datasetRegistry
        .connect(admin)
        .recordChallenge(datasetId, ethers.id("paused-evidence"), "ipfs://paused-evidence");
      await datasetRegistry.connect(admin).resolveChallenge(datasetId, false);
      expect(await datasetRegistry.challengeStatus(datasetId)).to.equal(2);
    });
  });
});

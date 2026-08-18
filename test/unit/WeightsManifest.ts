import { expect } from "chai";
import { id } from "ethers";
import vector from "../../test-vectors/merkle.json" with { type: "json" };
import {
  buildWeightsManifest,
  fetchAndValidateWeightsManifest,
  hashWeightsManifest,
  validateWeightsManifest,
  type WeightsManifestContext,
} from "../../scripts/lib/weights-manifest.js";

describe("Weights manifest v1", function () {
  const registry = "0x1000000000000000000000000000000000000001";
  const context: WeightsManifestContext = {
    datasetId: 7n,
    chainId: 84532n,
    datasetRegistry: registry,
    totalWeight: BigInt(vector.totalWeight),
    weightsRoot: vector.root,
  };

  function validManifest() {
    return buildWeightsManifest({
      ...context,
      entries: vector.entries,
      pipelineVersion: "pipeline-v1.0.0",
      generatedAt: "2026-08-18T00:00:00.000Z",
      contentDigest: id("normalized-source-dataset"),
    });
  }

  async function expectRejected(promise: Promise<unknown>, message: string) {
    try {
      await promise;
      expect.fail("expected promise to reject");
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.contain(message);
    }
  }

  it("builds a uniquely bound manifest with independently reproducible proofs", function () {
    const verified = validateWeightsManifest(validManifest(), context);
    expect(verified.entries).to.have.length(vector.entries.length);
    expect(verified.entries.every((entry) => Array.isArray(entry.proof))).to.equal(true);
  });

  it("rejects a manifest root that differs from its entries or the on-chain root", function () {
    const manifest = validManifest();
    manifest.weightsRoot = id("wrong-root");
    expect(() => validateWeightsManifest(manifest, context)).to.throw(
      "manifest weightsRoot mismatch",
    );

    const wrongContext = { ...context, weightsRoot: id("different-onchain-root") };
    expect(() => validateWeightsManifest(validManifest(), wrongContext)).to.throw(
      "on-chain weightsRoot mismatch",
    );
  });

  it("rejects the wrong Dataset, chain, or DatasetRegistry binding", function () {
    expect(() =>
      validateWeightsManifest(validManifest(), { ...context, datasetId: context.datasetId + 1n }),
    ).to.throw("datasetId mismatch");
    expect(() =>
      validateWeightsManifest(validManifest(), { ...context, chainId: context.chainId + 1n }),
    ).to.throw("chainId mismatch");
    expect(() =>
      validateWeightsManifest(validManifest(), {
        ...context,
        datasetRegistry: "0x2000000000000000000000000000000000000002",
      }),
    ).to.throw("DatasetRegistry address mismatch");
  });

  it("rejects duplicate addresses", function () {
    const manifest = validManifest();
    manifest.entries[1].address = manifest.entries[0].address;
    expect(() => validateWeightsManifest(manifest, context)).to.throw("duplicate weight address");
  });

  it("rejects a weight sum different from totalWeight", function () {
    const manifest = validManifest();
    manifest.entries[0].weight = (BigInt(manifest.entries[0].weight) - 1n).toString();
    expect(() => validateWeightsManifest(manifest, context)).to.throw("weight sum mismatch");
  });

  it("rejects a different leaf/hash schema version", function () {
    const manifest = validManifest();
    manifest.schema = "main-protocol.weights-manifest.v2";
    expect(() => validateWeightsManifest(manifest, context)).to.throw("leaf hash version mismatch");
  });

  it("rejects unavailable or content-digest-mismatched manifests", async function () {
    const raw = `${JSON.stringify(validManifest(), null, 2)}\n`;
    await expectRejected(
      fetchAndValidateWeightsManifest(
        "ipfs://missing",
        hashWeightsManifest(raw),
        context,
        async () => {
          throw new Error("not found");
        },
      ),
      "manifest unavailable",
    );

    await expectRejected(
      fetchAndValidateWeightsManifest(
        "ipfs://changed",
        id("different-content"),
        context,
        async () => raw,
      ),
      "weights manifest content digest mismatch",
    );
  });
});

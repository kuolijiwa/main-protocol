import { expect } from "chai";
import { id, ZeroAddress, ZeroHash } from "ethers";

import {
  hashWeightChallengeEvidence,
  parseAndValidateWeightChallengeEvidence,
  validateWeightChallengeEvidence,
  verifyWeightChallengeEvidenceCommitment,
  type WeightChallengeContext,
  type WeightChallengeEvidenceV1,
} from "../../scripts/lib/challenge-evidence.js";

describe("Weight challenge evidence v1", function () {
  const context: WeightChallengeContext = {
    datasetId: 7n,
    chainId: 84_532n,
    datasetRegistry: "0x1000000000000000000000000000000000000001",
    weightsRoot: id("weights-root"),
  };

  function validEvidence(): WeightChallengeEvidenceV1 {
    return {
      schema: "main-protocol.weight-challenge-evidence.v1",
      datasetId: context.datasetId.toString(),
      chainId: context.chainId.toString(),
      datasetRegistry: context.datasetRegistry,
      weightsRoot: context.weightsRoot,
      challenger: "0x2000000000000000000000000000000000000002",
      submittedAt: "2026-08-18T00:00:00.000Z",
      reason: "wrong-total-weight",
      summary: "Published leaves do not sum to the committed total weight.",
      artifacts: [{ uri: "ipfs://evidence", digest: id("evidence-artifact") }],
    };
  }

  it("validates exact evidence bytes and returns their on-chain commitment", function () {
    const raw = `${JSON.stringify(validEvidence(), null, 2)}\n`;
    const result = parseAndValidateWeightChallengeEvidence(raw, context);
    expect(result.evidence).to.deep.equal(validEvidence());
    expect(result.evidenceHash).to.equal(hashWeightChallengeEvidence(raw));
  });

  it("rejects wrong schema, Dataset, chain, Registry, and root bindings", function () {
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), schema: "v2" }, context),
    ).to.throw("schema mismatch");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), datasetId: "8" }, context),
    ).to.throw("datasetId mismatch");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), chainId: "1" }, context),
    ).to.throw("chainId mismatch");
    expect(() =>
      validateWeightChallengeEvidence(
        { ...validEvidence(), datasetRegistry: "0x3000000000000000000000000000000000000003" },
        context,
      ),
    ).to.throw("DatasetRegistry address mismatch");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), weightsRoot: id("wrong") }, context),
    ).to.throw("weightsRoot mismatch");
  });

  it("rejects malformed challenger, timestamp, reason, and summary", function () {
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), challenger: ZeroAddress }, context),
    ).to.throw("challenger must be a nonzero address");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), submittedAt: "2026-08-18" }, context),
    ).to.throw("canonical UTC timestamp");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), reason: "spam" }, context),
    ).to.throw("unsupported challenge reason");
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), summary: "  " }, context),
    ).to.throw("summary is required");
  });

  it("rejects missing, duplicate, or uncommitted artifacts", function () {
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), artifacts: [] }, context),
    ).to.throw("artifacts must not be empty");
    const duplicate = validEvidence();
    duplicate.artifacts.push({ ...duplicate.artifacts[0] });
    expect(() => validateWeightChallengeEvidence(duplicate, context)).to.throw(
      "duplicate challenge artifact URI",
    );
    const zeroDigest = validEvidence();
    zeroDigest.artifacts[0].digest = ZeroHash;
    expect(() => validateWeightChallengeEvidence(zeroDigest, context)).to.throw(
      "digest must be a nonzero bytes32",
    );
  });

  it("rejects unknown fields and invalid JSON", function () {
    expect(() =>
      validateWeightChallengeEvidence({ ...validEvidence(), unexpected: true }, context),
    ).to.throw("unsupported field");
    expect(() => parseAndValidateWeightChallengeEvidence("{", context)).to.throw("not valid JSON");
  });

  it("rejects exact evidence bytes that differ from the committed hash", function () {
    const raw = `${JSON.stringify(validEvidence())}\n`;
    expect(() =>
      verifyWeightChallengeEvidenceCommitment(raw, id("different-bytes"), context),
    ).to.throw("challenge evidence content digest mismatch");
  });
});

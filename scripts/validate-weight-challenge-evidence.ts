import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseAndValidateWeightChallengeEvidence,
  verifyWeightChallengeEvidenceCommitment,
} from "./lib/challenge-evidence.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const evidenceFile = resolve(required("EVIDENCE_FILE"));
const raw = await readFile(evidenceFile);
const context = {
  datasetId: BigInt(required("DATASET_ID")),
  chainId: BigInt(required("EXPECTED_CHAIN_ID")),
  datasetRegistry: required("DATASET_REGISTRY"),
  weightsRoot: required("WEIGHTS_ROOT"),
};
const result = process.env.EXPECTED_EVIDENCE_HASH
  ? verifyWeightChallengeEvidenceCommitment(raw, process.env.EXPECTED_EVIDENCE_HASH, context)
  : parseAndValidateWeightChallengeEvidence(raw, context);

console.log(
  JSON.stringify({
    valid: true,
    evidenceFile,
    evidenceHash: result.evidenceHash,
    evidenceURI: process.env.EVIDENCE_URI,
  }),
);

import { getAddress, isHexString, keccak256, toUtf8Bytes, ZeroAddress, ZeroHash } from "ethers";

import {
  requireCanonicalUtcTimestamp,
  requireExactKeys,
  requireObject,
  requirePositiveDecimal,
} from "./json-validation.js";

export const WEIGHT_CHALLENGE_EVIDENCE_SCHEMA = "main-protocol.weight-challenge-evidence.v1";

export const WEIGHT_CHALLENGE_REASONS = [
  "duplicate-address",
  "invalid-weight",
  "wrong-total-weight",
  "wrong-attribution",
  "root-mismatch",
  "manifest-unavailable",
  "other",
] as const;

export type WeightChallengeReason = (typeof WEIGHT_CHALLENGE_REASONS)[number];

export interface WeightChallengeEvidenceV1 {
  schema: string;
  datasetId: string;
  chainId: string;
  datasetRegistry: string;
  weightsRoot: string;
  challenger: string;
  submittedAt: string;
  reason: WeightChallengeReason;
  summary: string;
  artifacts: Array<{ uri: string; digest: string }>;
}

export interface WeightChallengeContext {
  datasetId: bigint;
  chainId: bigint;
  datasetRegistry: string;
  weightsRoot: string;
}

export function hashWeightChallengeEvidence(raw: string | Uint8Array): string {
  return keccak256(typeof raw === "string" ? toUtf8Bytes(raw) : raw);
}

function requireNonzeroBytes32(value: unknown, name: string): string {
  if (typeof value !== "string" || !isHexString(value, 32) || value === ZeroHash) {
    throw new Error(`${name} must be a nonzero bytes32`);
  }
  return value;
}

export function validateWeightChallengeEvidence(
  value: unknown,
  context: WeightChallengeContext,
): WeightChallengeEvidenceV1 {
  requireObject(value, "challenge evidence");
  requireExactKeys(
    value,
    [
      "schema",
      "datasetId",
      "chainId",
      "datasetRegistry",
      "weightsRoot",
      "challenger",
      "submittedAt",
      "reason",
      "summary",
      "artifacts",
    ],
    "challenge evidence",
  );
  const evidence = value as unknown as WeightChallengeEvidenceV1;

  if (evidence.schema !== WEIGHT_CHALLENGE_EVIDENCE_SCHEMA) {
    throw new Error("challenge evidence schema mismatch");
  }
  if (requirePositiveDecimal(evidence.datasetId, "datasetId") !== context.datasetId) {
    throw new Error("datasetId mismatch");
  }
  if (requirePositiveDecimal(evidence.chainId, "chainId") !== context.chainId) {
    throw new Error("chainId mismatch");
  }
  if (getAddress(evidence.datasetRegistry) !== getAddress(context.datasetRegistry)) {
    throw new Error("DatasetRegistry address mismatch");
  }
  if (
    requireNonzeroBytes32(evidence.weightsRoot, "weightsRoot").toLowerCase() !==
    requireNonzeroBytes32(context.weightsRoot, "expected weightsRoot").toLowerCase()
  ) {
    throw new Error("weightsRoot mismatch");
  }
  if (getAddress(evidence.challenger) === ZeroAddress) {
    throw new Error("challenger must be a nonzero address");
  }
  requireCanonicalUtcTimestamp(evidence.submittedAt, "submittedAt");
  if (!WEIGHT_CHALLENGE_REASONS.includes(evidence.reason)) {
    throw new Error("unsupported challenge reason");
  }
  if (typeof evidence.summary !== "string" || !evidence.summary.trim()) {
    throw new Error("challenge summary is required");
  }
  if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
    throw new Error("challenge artifacts must not be empty");
  }

  const seenUris = new Set<string>();
  for (const [index, artifact] of evidence.artifacts.entries()) {
    requireObject(artifact, `challenge artifact ${index}`);
    requireExactKeys(artifact, ["uri", "digest"], `challenge artifact ${index}`);
    if (typeof artifact.uri !== "string" || !artifact.uri.trim()) {
      throw new Error(`challenge artifact ${index} URI is required`);
    }
    if (seenUris.has(artifact.uri)) {
      throw new Error(`duplicate challenge artifact URI: ${artifact.uri}`);
    }
    seenUris.add(artifact.uri);
    requireNonzeroBytes32(artifact.digest, `challenge artifact ${index} digest`);
  }

  return evidence;
}

export function parseAndValidateWeightChallengeEvidence(
  raw: string | Uint8Array,
  context: WeightChallengeContext,
): { evidence: WeightChallengeEvidenceV1; evidenceHash: string } {
  let parsed: unknown;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    parsed = JSON.parse(text);
  } catch {
    throw new Error("challenge evidence is not valid JSON");
  }
  return {
    evidence: validateWeightChallengeEvidence(parsed, context),
    evidenceHash: hashWeightChallengeEvidence(raw),
  };
}

export function verifyWeightChallengeEvidenceCommitment(
  raw: string | Uint8Array,
  expectedEvidenceHash: string,
  context: WeightChallengeContext,
): { evidence: WeightChallengeEvidenceV1; evidenceHash: string } {
  if (!isHexString(expectedEvidenceHash, 32) || expectedEvidenceHash === ZeroHash) {
    throw new Error("expected evidenceHash must be a nonzero bytes32");
  }
  const result = parseAndValidateWeightChallengeEvidence(raw, context);
  if (result.evidenceHash.toLowerCase() !== expectedEvidenceHash.toLowerCase()) {
    throw new Error("challenge evidence content digest mismatch");
  }
  return result;
}

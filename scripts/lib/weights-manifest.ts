import { getAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";

import { validateWeightAllocation } from "./merkle-allocation.js";

export const WEIGHTS_MANIFEST_SCHEMA = "main-protocol.weights-manifest.v1";
export const WEIGHTS_LEAF_ENCODING = "keccak256(abi.encode(address,uint256))";
export const WEIGHTS_PAIR_HASHING = "sorted-keccak256;promote-unpaired";

export interface WeightsManifestV1 {
  schema: string;
  datasetId: string;
  chainId: string;
  datasetRegistry: string;
  leafEncoding: string;
  pairHashing: string;
  totalWeight: string;
  weightsRoot: string;
  entries: Array<{ address: string; weight: string; proof?: string[] }>;
  pipeline: {
    version: string;
    generatedAt: string;
    contentDigest: string;
  };
}

export interface WeightsManifestContext {
  datasetId: bigint;
  chainId: bigint;
  datasetRegistry: string;
  totalWeight: bigint;
  weightsRoot: string;
}

export interface VerifiedWeightsManifest {
  manifest: WeightsManifestV1;
  manifestHash: string;
  entries: Array<{ address: string; weight: bigint; leaf: string; proof: string[] }>;
}

export interface BuildWeightsManifestInput extends WeightsManifestContext {
  entries: Array<{ address: string; weight: string | bigint }>;
  pipelineVersion: string;
  generatedAt: string;
  contentDigest: string;
}

function requireObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("weights manifest must be a JSON object");
  }
}

export function hashWeightsManifest(raw: string | Uint8Array): string {
  return keccak256(typeof raw === "string" ? toUtf8Bytes(raw) : raw);
}

export function buildWeightsManifest(input: BuildWeightsManifestInput): WeightsManifestV1 {
  const allocation = validateWeightAllocation(input.entries, input.totalWeight);
  if (allocation.root.toLowerCase() !== input.weightsRoot.toLowerCase()) {
    throw new Error("generated allocation does not match weightsRoot");
  }
  return {
    schema: WEIGHTS_MANIFEST_SCHEMA,
    datasetId: input.datasetId.toString(),
    chainId: input.chainId.toString(),
    datasetRegistry: getAddress(input.datasetRegistry),
    leafEncoding: WEIGHTS_LEAF_ENCODING,
    pairHashing: WEIGHTS_PAIR_HASHING,
    totalWeight: input.totalWeight.toString(),
    weightsRoot: allocation.root,
    entries: allocation.entries.map(({ address, weight, proof }) => ({
      address,
      weight: weight.toString(),
      proof,
    })),
    pipeline: {
      version: input.pipelineVersion,
      generatedAt: input.generatedAt,
      contentDigest: input.contentDigest,
    },
  };
}

export function validateWeightsManifest(
  value: unknown,
  context: WeightsManifestContext,
): VerifiedWeightsManifest {
  requireObject(value);
  const manifest = value as unknown as WeightsManifestV1;
  if (manifest.schema !== WEIGHTS_MANIFEST_SCHEMA) throw new Error("leaf hash version mismatch");
  if (BigInt(manifest.datasetId) !== context.datasetId) throw new Error("datasetId mismatch");
  if (BigInt(manifest.chainId) !== context.chainId) throw new Error("chainId mismatch");
  if (getAddress(manifest.datasetRegistry) !== getAddress(context.datasetRegistry)) {
    throw new Error("DatasetRegistry address mismatch");
  }
  if (manifest.leafEncoding !== WEIGHTS_LEAF_ENCODING) throw new Error("leaf encoding mismatch");
  if (manifest.pairHashing !== WEIGHTS_PAIR_HASHING) throw new Error("pair hashing mismatch");
  if (!Array.isArray(manifest.entries)) throw new Error("entries must be an array");
  if (BigInt(manifest.totalWeight) !== context.totalWeight) throw new Error("totalWeight mismatch");
  if (!manifest.pipeline || typeof manifest.pipeline !== "object") {
    throw new Error("pipeline metadata is required");
  }
  if (!manifest.pipeline.version) throw new Error("pipeline version is required");
  if (!Number.isFinite(Date.parse(manifest.pipeline.generatedAt))) {
    throw new Error("pipeline generatedAt must be an ISO timestamp");
  }
  if (!isHexString(manifest.pipeline.contentDigest, 32)) {
    throw new Error("pipeline contentDigest must be bytes32");
  }

  const allocation = validateWeightAllocation(manifest.entries, manifest.totalWeight);
  if (allocation.root.toLowerCase() !== manifest.weightsRoot.toLowerCase()) {
    throw new Error("manifest weightsRoot mismatch");
  }
  if (allocation.root.toLowerCase() !== context.weightsRoot.toLowerCase()) {
    throw new Error("on-chain weightsRoot mismatch");
  }

  const providedByAddress = new Map(
    manifest.entries.map((entry) => [getAddress(entry.address), entry.proof]),
  );
  for (const entry of allocation.entries) {
    const provided = providedByAddress.get(entry.address);
    if (
      provided !== undefined &&
      (provided.length !== entry.proof.length ||
        provided.some((node, index) => node.toLowerCase() !== entry.proof[index].toLowerCase()))
    ) {
      throw new Error(`proof mismatch for ${entry.address}`);
    }
  }

  return { manifest, manifestHash: "", entries: allocation.entries };
}

export type ManifestFetcher = (uri: string) => Promise<string | Uint8Array>;

export async function defaultManifestFetcher(uri: string): Promise<Uint8Array> {
  let fetchURI = uri;
  if (uri.startsWith("ipfs://")) {
    const gateway = process.env.IPFS_GATEWAY_URL;
    if (!gateway) throw new Error("IPFS_GATEWAY_URL is required for ipfs:// manifests");
    fetchURI = `${gateway.replace(/\/$/, "")}/ipfs/${uri.slice("ipfs://".length)}`;
  } else if (uri.startsWith("ar://")) {
    fetchURI = `https://arweave.net/${uri.slice("ar://".length)}`;
  }
  if (!fetchURI.startsWith("https://") && !fetchURI.startsWith("http://")) {
    throw new Error(`unsupported manifest URI: ${uri}`);
  }
  const response = await fetch(fetchURI);
  if (!response.ok) throw new Error(`manifest unavailable: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchAndValidateWeightsManifest(
  uri: string,
  expectedManifestHash: string,
  context: WeightsManifestContext,
  fetcher: ManifestFetcher = defaultManifestFetcher,
): Promise<VerifiedWeightsManifest> {
  let raw: string | Uint8Array;
  try {
    raw = await fetcher(uri);
  } catch (error) {
    throw new Error(
      `manifest unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifestHash = hashWeightsManifest(raw);
  if (manifestHash.toLowerCase() !== expectedManifestHash.toLowerCase()) {
    throw new Error("weights manifest content digest mismatch");
  }
  let parsed: unknown;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    parsed = JSON.parse(text);
  } catch {
    throw new Error("weights manifest is not valid JSON");
  }
  const verified = validateWeightsManifest(parsed, context);
  return { ...verified, manifestHash };
}

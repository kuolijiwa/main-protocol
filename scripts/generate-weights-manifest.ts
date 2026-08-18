import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildWeightsManifest, hashWeightsManifest } from "./lib/weights-manifest.js";
import type { WeightEntry } from "./lib/merkle-allocation.js";

interface AllocationInput {
  totalWeight: string;
  root: string;
  entries: WeightEntry[];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const allocation = JSON.parse(
  await readFile(resolve(required("ALLOCATION_FILE")), "utf8"),
) as AllocationInput;
const manifest = buildWeightsManifest({
  datasetId: BigInt(required("DATASET_ID")),
  chainId: BigInt(required("EXPECTED_CHAIN_ID")),
  datasetRegistry: required("DATASET_REGISTRY"),
  totalWeight: BigInt(allocation.totalWeight),
  weightsRoot: allocation.root,
  entries: allocation.entries,
  pipelineVersion: required("PIPELINE_VERSION"),
  generatedAt: required("GENERATED_AT"),
  contentDigest: required("CONTENT_DIGEST"),
});
const raw = `${JSON.stringify(manifest, null, 2)}\n`;
const outputFile = resolve(required("MANIFEST_OUTPUT_FILE"));
await writeFile(outputFile, raw, { encoding: "utf8", flag: "wx" });
console.log(
  JSON.stringify({
    outputFile,
    weightsRoot: manifest.weightsRoot,
    weightsManifestHash: hashWeightsManifest(raw),
  }),
);

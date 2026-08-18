import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { id } from "ethers";
import hre from "hardhat";
import { buildWeightsManifest, hashWeightsManifest } from "./lib/weights-manifest.js";
import { validateWeightAllocationDocument } from "./lib/merkle-allocation.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const allocation = validateWeightAllocationDocument(
  JSON.parse(await readFile(resolve(required("ALLOCATION_FILE")), "utf8")) as unknown,
);
const connection = await hre.network.create();
const { ethers } = connection;
const datasetRegistryAddress = required("DATASET_REGISTRY");
if ((await ethers.provider.getCode(datasetRegistryAddress)) === "0x") {
  throw new Error("DATASET_REGISTRY has no deployed code");
}
const datasetRegistry = await ethers.getContractAt("IDatasetRegistry", datasetRegistryAddress);
const [network, datasetId, manifestVersion] = await Promise.all([
  ethers.provider.getNetwork(),
  datasetRegistry.nextDatasetId(),
  datasetRegistry.WEIGHTS_MANIFEST_VERSION(),
]);
const expectedChainId = BigInt(required("EXPECTED_CHAIN_ID"));
if (network.chainId !== expectedChainId) {
  throw new Error(`chain ID mismatch: expected ${expectedChainId}, got ${network.chainId}`);
}
if (manifestVersion !== id("main-protocol.weights-manifest.v1")) {
  throw new Error("DatasetRegistry weights Manifest version mismatch");
}
const manifest = buildWeightsManifest({
  datasetId,
  chainId: network.chainId,
  datasetRegistry: datasetRegistryAddress,
  totalWeight: allocation.totalWeight,
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

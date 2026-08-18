import { id } from "ethers";
import hre from "hardhat";
import {
  fetchAndValidateWeightsManifest,
  WEIGHTS_MANIFEST_SCHEMA,
} from "./lib/weights-manifest.js";

const registryAddress = process.env.DATASET_REGISTRY;
const datasetIdValue = process.env.DATASET_ID;
if (!registryAddress) throw new Error("DATASET_REGISTRY is required");
if (!datasetIdValue) throw new Error("DATASET_ID is required");

const datasetId = BigInt(datasetIdValue);
const { ethers } = await hre.network.create();
const registry = await ethers.getContractAt("IDatasetRegistry", registryAddress);
const [dataset, uri, manifestHash, onchainVersion, networkInfo] = await Promise.all([
  registry.getDataset(datasetId),
  registry.weightsURI(datasetId),
  registry.weightsManifestHash(datasetId),
  registry.WEIGHTS_MANIFEST_VERSION(),
  ethers.provider.getNetwork(),
]);
if (onchainVersion !== id(WEIGHTS_MANIFEST_SCHEMA)) {
  throw new Error("unsupported on-chain weights manifest version");
}

const verified = await fetchAndValidateWeightsManifest(uri, manifestHash, {
  datasetId,
  chainId: networkInfo.chainId,
  datasetRegistry: registryAddress,
  totalWeight: dataset.totalWeight,
  weightsRoot: dataset.weightsRoot,
});
const claimant = process.env.CLAIMANT_ADDRESS
  ? verified.entries.find(
      (entry) => entry.address.toLowerCase() === process.env.CLAIMANT_ADDRESS!.toLowerCase(),
    )
  : undefined;
if (process.env.CLAIMANT_ADDRESS && !claimant) throw new Error("claimant is absent from manifest");

console.log(
  JSON.stringify(
    {
      valid: true,
      datasetId: datasetId.toString(),
      uri,
      manifestHash: verified.manifestHash,
      entries: verified.entries.length,
      claimant: claimant && {
        address: claimant.address,
        weight: claimant.weight.toString(),
        proof: claimant.proof,
      },
    },
    null,
    2,
  ),
);

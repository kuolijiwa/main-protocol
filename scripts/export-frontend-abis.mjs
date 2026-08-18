import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, "ABI");
mkdirSync(outputDirectory, { recursive: true });

const contracts = [
  ["ContributorRegistry", "artifacts/contracts/ContributorRegistry.sol/ContributorRegistry.json"],
  ["ProtocolConfig", "artifacts/contracts/ProtocolConfig.sol/ProtocolConfig.json"],
  ["DatasetRegistry", "artifacts/contracts/DatasetRegistry.sol/DatasetRegistry.json"],
  ["EntitlementNFT", "artifacts/contracts/EntitlementNFT.sol/EntitlementNFT.json"],
  ["Marketplace", "artifacts/contracts/Marketplace.sol/Marketplace.json"],
  ["RevenueSplitter", "artifacts/contracts/RevenueSplitter.sol/RevenueSplitter.json"],
  ["ProtocolTimelock", "artifacts/contracts/ProtocolTimelock.sol/ProtocolTimelock.json"],
];

const paymentTokenAbi = [
  {
    type: "event",
    name: "Approval",
    anonymous: false,
    inputs: [
      { name: "owner", type: "address", indexed: true, internalType: "address" },
      { name: "spender", type: "address", indexed: true, internalType: "address" },
      { name: "value", type: "uint256", indexed: false, internalType: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true, internalType: "address" },
      { name: "to", type: "address", indexed: true, internalType: "address" },
      { name: "value", type: "uint256", indexed: false, internalType: "uint256" },
    ],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8", internalType: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address", internalType: "address" },
      { name: "to", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
];

function loadArtifact(relativePath) {
  const artifact = JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
  if (!Array.isArray(artifact.abi)) throw new Error(`${relativePath} does not contain an ABI`);
  return artifact.abi;
}

function writeJson(fileName, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path.join(outputDirectory, fileName), contents, "utf8");
  return {
    file: fileName,
    entries: Array.isArray(value) ? value.length : undefined,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

const generated = [];
const exportedNames = [];
for (const [contractName, artifactPath] of contracts) {
  const abi = loadArtifact(artifactPath);
  const fileName = `${contractName}.abi.json`;
  generated.push({ contractName, artifactPath, ...writeJson(fileName, abi) });
  const propertyName = contractName[0].toLowerCase() + contractName.slice(1);
  exportedNames.push([propertyName, `${propertyName}Abi`, fileName]);
}

generated.push({
  contractName: "PaymentTokenERC20",
  artifactPath: null,
  ...writeJson("PaymentTokenERC20.abi.json", paymentTokenAbi),
});
exportedNames.push(["paymentToken", "paymentTokenAbi", "PaymentTokenERC20.abi.json"]);

const datasetAbi = loadArtifact(contracts.find(([name]) => name === "DatasetRegistry")[1]);
const registered = datasetAbi.find(
  (entry) => entry.type === "event" && entry.name === "DatasetRegistered",
);
const registeredTypes = registered?.inputs?.map((input) => input.type).join(",");
if (registeredTypes !== "uint256,address,bytes32,bytes32,uint256") {
  throw new Error(`unexpected DatasetRegistered ABI: ${registeredTypes ?? "missing"}`);
}
if (
  datasetAbi.some((entry) => entry.type === "event" && entry.name === "WeightsManifestCommitted")
) {
  throw new Error("unexpected WeightsManifestCommitted event in current frontend ABI");
}

const marketplaceAbi = loadArtifact(contracts.find(([name]) => name === "Marketplace")[1]);
for (const deferred of ["bid", "settle", "createAuction"]) {
  if (marketplaceAbi.some((entry) => entry.type === "function" && entry.name === deferred)) {
    throw new Error(`deferred auction function leaked into frontend ABI: ${deferred}`);
  }
}

const indexContents = `${exportedNames
  .map(([, exportName, file]) => `import ${exportName} from "./${file}" with { type: "json" };`)
  .join("\n")}\n\n${exportedNames
  .map(([, exportName]) => `export { ${exportName} };`)
  .join("\n")}\n\nexport const mainProtocolAbis = {\n${exportedNames
  .map(([propertyName, exportName]) => `  ${propertyName}: ${exportName},`)
  .join("\n")}\n} as const;\n`;
writeFileSync(path.join(outputDirectory, "index.ts"), indexContents, "utf8");

const manifest = {
  schemaVersion: "main-protocol-frontend-abi-v1",
  format: "ABI-only JSON arrays",
  solidity: "0.8.28",
  evmTarget: "cancun",
  datasetRegistered: "DatasetRegistered(uint256,address,bytes32,bytes32,uint256)",
  manifestCommitmentDiscovery: [
    "DatasetRegistry.weightsURI(uint256)",
    "DatasetRegistry.weightsManifestHash(uint256)",
    "DatasetRegistry.WEIGHTS_MANIFEST_VERSION()",
  ],
  files: generated,
};
writeJson("manifest.json", manifest);

console.log(`Exported ${generated.length} frontend ABI files to ${outputDirectory}`);

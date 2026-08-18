import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  AbiCoder,
  Contract,
  FetchRequest,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  ZeroHash,
  concat,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
} from "ethers";

const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const BASE_SEPOLIA_CHAIN_ID = 84532n;
const abiCoder = AbiCoder.defaultAbiCoder();

function loadSimpleEnv(file) {
  return fs
    .readFile(file, "utf8")
    .then((contents) => {
      for (const rawLine of contents.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (!match || process.env[match[1]] !== undefined) continue;
        let value = match[2].trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        process.env[match[1]] = value;
      }
    })
    .catch(() => undefined);
}

await loadSimpleEnv(path.join(ROOT, ".env"));

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) values[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) values[key] = argv[++index];
    else flags.add(key);
  }
  return { flags, values, has: (name) => flags.has(name) || values[name] !== undefined };
}

export function env(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

export function address(value, label) {
  if (!value || !isAddress(value)) throw new Error(`${label} must be an EVM address`);
  return getAddress(value);
}

export function optionalAddress(value, label) {
  return value ? address(value, label) : undefined;
}

export function bytes32(value, label) {
  if (!value || !/^0x[0-9a-fA-F]{64}$/u.test(value) || value === ZeroHash) {
    throw new Error(`${label} must be a non-zero bytes32`);
  }
  return value;
}

export function uint(value, label, { positive = false } = {}) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer`);
  }
  if (parsed < 0n || (positive && parsed === 0n)) throw new Error(`${label} is out of range`);
  return parsed;
}

export function jsonValue(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      return item;
    }),
  );
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function rootPath(...parts) {
  return path.join(ROOT, ...parts);
}

export async function artifactAbi(solidityFile, contractName) {
  const artifact = await readJson(
    rootPath("artifacts", "contracts", solidityFile, `${contractName}.json`),
  );
  return artifact.abi;
}

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];

const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address,uint256) view returns (address[],address)",
  "function getGuard() view returns (address)",
  "function getFallbackHandler() view returns (address)",
  "function VERSION() view returns (string)",
];

const SAFE_SENTINEL = "0x0000000000000000000000000000000000000001";

export async function createContext(args = parseArgs()) {
  const rpc = requiredEnv("BASE_SEPOLIA_RPC_URL");
  const request = new FetchRequest(rpc);
  request.timeout = 15_000;
  const provider = new JsonRpcProvider(request);
  const network = await provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID && !args.has("skip-chain-check")) {
    throw new Error(
      `wrong network: RPC returned chain ${network.chainId}; expected Base Sepolia ${BASE_SEPOLIA_CHAIN_ID}`,
    );
  }
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID && args.has("skip-chain-check")) {
    console.warn(`WARNING: chain check skipped; connected to ${network.chainId}`);
  }

  const names = {
    protocolTimelock: "PROTOCOL_TIMELOCK",
    contributorRegistry: "CONTRIBUTOR_REGISTRY",
    protocolConfig: "PROTOCOL_CONFIG",
    datasetRegistry: "DATASET_REGISTRY",
    entitlementNFT: "ENTITLEMENT_NFT",
    revenueSplitter: "REVENUE_SPLITTER",
    marketplace: "MARKETPLACE",
    paymentToken: "PAYMENT_TOKEN",
    adminMultisig: "ADMIN_MULTISIG",
    treasury: "TREASURY",
    gatewaySigner: "GATEWAY_SIGNER",
    nurtureContributor: "NURTURE_CONTRIBUTOR",
    pipelineOperator: "PIPELINE_OPERATOR",
  };
  const missing = Object.values(names).filter((name) => !env(name));
  if (missing.length) {
    throw new Error(`deployment addresses are missing from .env: ${missing.join(", ")}`);
  }
  const addresses = Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, address(requiredEnv(name), name)]),
  );

  const [timelockAbi, contributorAbi, configAbi, datasetAbi, nftAbi, splitterAbi, marketAbi] =
    await Promise.all([
      artifactAbi("ProtocolTimelock.sol", "ProtocolTimelock"),
      artifactAbi("ContributorRegistry.sol", "ContributorRegistry"),
      artifactAbi("ProtocolConfig.sol", "ProtocolConfig"),
      artifactAbi("DatasetRegistry.sol", "DatasetRegistry"),
      artifactAbi("EntitlementNFT.sol", "EntitlementNFT"),
      artifactAbi("RevenueSplitter.sol", "RevenueSplitter"),
      artifactAbi("Marketplace.sol", "Marketplace"),
    ]);
  const contracts = {
    timelock: new Contract(addresses.protocolTimelock, timelockAbi, provider),
    contributor: new Contract(addresses.contributorRegistry, contributorAbi, provider),
    config: new Contract(addresses.protocolConfig, configAbi, provider),
    dataset: new Contract(addresses.datasetRegistry, datasetAbi, provider),
    nft: new Contract(addresses.entitlementNFT, nftAbi, provider),
    splitter: new Contract(addresses.revenueSplitter, splitterAbi, provider),
    market: new Contract(addresses.marketplace, marketAbi, provider),
    token: new Contract(addresses.paymentToken, ERC20_ABI, provider),
    safe: new Contract(addresses.adminMultisig, SAFE_ABI, provider),
  };
  return { args, provider, network, addresses, contracts };
}

export function signerFor(ctx, envName, expectedAddress = undefined) {
  const key = requiredEnv(envName);
  const signer = new Wallet(key, ctx.provider);
  if (expectedAddress && signer.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`${envName} address ${signer.address} does not match ${expectedAddress}`);
  }
  return signer;
}

export function connect(contract, signer) {
  return contract.connect(signer);
}

export async function codeInfo(ctx, name, target) {
  const code = await ctx.provider.getCode(target);
  return { name, address: target, hasCode: code !== "0x", runtimeCodeHash: keccak256(code) };
}

export async function roleMembers(contract, role) {
  const count = BigInt(await contract.getFunction("getRoleMemberCount")(role));
  const members = [];
  for (let index = 0n; index < count; index += 1n) {
    members.push(await contract.getFunction("getRoleMember")(role, index));
  }
  return { count, members };
}

export async function roleSnapshot(contract, roleNames) {
  const result = {};
  for (const roleName of roleNames) {
    const role = await contract.getFunction(roleName)();
    const members = await roleMembers(contract, role);
    result[roleName] = { role, ...members };
  }
  return result;
}

export async function safeSnapshot(ctx) {
  const safe = ctx.contracts.safe;
  const result = { address: ctx.addresses.adminMultisig };
  for (const [key, fn] of [
    ["owners", "getOwners"],
    ["threshold", "getThreshold"],
    ["guard", "getGuard"],
    ["fallbackHandler", "getFallbackHandler"],
    ["version", "VERSION"],
  ]) {
    try {
      result[key] = await safe.getFunction(fn)();
    } catch (error) {
      result[key] = {
        unavailable: error instanceof Error ? error.shortMessage || error.message : String(error),
      };
    }
  }
  try {
    const [modules, next] = await safe.getModulesPaginated(SAFE_SENTINEL, 10);
    result.modules = { modules, next };
  } catch (error) {
    result.modules = {
      unavailable: error instanceof Error ? error.shortMessage || error.message : String(error),
    };
  }
  return result;
}

export async function protocolSnapshot(ctx, datasetId = env("TEST_DATASET_ID")) {
  const { addresses, contracts: c } = ctx;
  const snapshot = {
    network: { chainId: ctx.network.chainId, blockNumber: await ctx.provider.getBlockNumber() },
    addresses,
    code: await Promise.all(
      Object.entries(addresses).map(([name, target]) => codeInfo(ctx, name, target)),
    ),
    configuration: {
      paymentToken: await c.config.paymentToken(),
      feeBps: await c.config.feeBps(),
      treasury: await c.config.treasury(),
      challengeWindow: await c.config.challengeWindow(),
      gatewaySigner: await c.config.gatewaySigner(),
      paused: await c.config.paused(),
    },
    wiring: {
      datasetMarketplace: await c.dataset.marketplace(),
      nftMarketplace: await c.nft.marketplace(),
      splitterMarketplace: await c.splitter.marketplace(),
      marketplaceDatasetRegistry: await c.market.datasetRegistry(),
      marketplaceRevenueSplitter: await c.market.revenueSplitter(),
    },
    roles: {
      timelock: await roleSnapshot(c.timelock, [
        "DEFAULT_ADMIN_ROLE",
        "PROPOSER_ROLE",
        "EXECUTOR_ROLE",
        "CANCELLER_ROLE",
      ]),
      contributor: await roleSnapshot(c.contributor, [
        "DEFAULT_ADMIN_ROLE",
        "ADMIN_ROLE",
        "OPERATOR_ROLE",
        "CONTRIBUTOR_ROLE",
      ]),
      config: await roleSnapshot(c.config, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]),
      dataset: await roleSnapshot(c.dataset, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]),
      nft: await roleSnapshot(c.nft, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]),
      splitter: await roleSnapshot(c.splitter, ["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE"]),
    },
    safe: await safeSnapshot(ctx),
    token: {
      name: await c.token.name(),
      symbol: await c.token.symbol(),
      decimals: await c.token.decimals(),
      totalSupply: await c.token.totalSupply(),
    },
  };
  snapshot.roles.contributor.operatorAssignment = await c.contributor.operatorContributor(
    addresses.pipelineOperator,
  );
  if (datasetId !== undefined)
    snapshot.dataset = await datasetSnapshot(
      ctx,
      uint(datasetId, "TEST_DATASET_ID", { positive: true }),
    );
  return snapshot;
}

export async function strictDeploymentChecks(ctx) {
  const { addresses, contracts: c } = ctx;
  const core = [
    ["PROTOCOL_TIMELOCK", addresses.protocolTimelock],
    ["CONTRIBUTOR_REGISTRY", addresses.contributorRegistry],
    ["PROTOCOL_CONFIG", addresses.protocolConfig],
    ["DATASET_REGISTRY", addresses.datasetRegistry],
    ["ENTITLEMENT_NFT", addresses.entitlementNFT],
    ["REVENUE_SPLITTER", addresses.revenueSplitter],
    ["MARKETPLACE", addresses.marketplace],
  ];
  for (const [name, target] of core) {
    if ((await ctx.provider.getCode(target)) === "0x")
      throw new Error(`${name} has no runtime code`);
  }
  const adminCode = await ctx.provider.getCode(addresses.adminMultisig);
  if (adminCode === "0x") {
    if (env("ALLOW_BASE_SEPOLIA_EOA_ADMIN_TEST") !== "true") {
      throw new Error(
        "ADMIN_MULTISIG has no contract code; production Base Sepolia验收必须使用 Safe",
      );
    }
  } else {
    const expectedAdminHash = env("ADMIN_MULTISIG_CODE_HASH");
    if (
      expectedAdminHash &&
      keccak256(adminCode).toLowerCase() !== expectedAdminHash.toLowerCase()
    ) {
      throw new Error("ADMIN_MULTISIG_CODE_HASH mismatch");
    }
    const safe = await safeSnapshot(ctx);
    if (!Array.isArray(safe.owners) || safe.owners.some((item) => typeof item !== "string")) {
      throw new Error("ADMIN_MULTISIG does not expose Safe owners");
    }
    const expectedOwners = env("ADMIN_MULTISIG_OWNERS")
      ?.split(",")
      .filter(Boolean)
      .map((item) => address(item.trim(), "ADMIN_MULTISIG_OWNERS"));
    if (expectedOwners) {
      const actual = [...safe.owners].map((item) => item.toLowerCase()).sort();
      const expected = expectedOwners.map((item) => item.toLowerCase()).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error("Safe owner set mismatch");
    }
    const expectedThreshold = env("ADMIN_MULTISIG_THRESHOLD");
    if (expectedThreshold && BigInt(safe.threshold) !== BigInt(expectedThreshold))
      throw new Error("Safe threshold mismatch");
    if (!safe.modules || safe.modules.unavailable || safe.modules.modules.length !== 0)
      throw new Error("Safe modules are not empty");
    const expectedGuard = env("ADMIN_MULTISIG_GUARD");
    if (expectedGuard && safe.guard.toLowerCase() !== expectedGuard.toLowerCase())
      throw new Error("Safe guard mismatch");
    const expectedFallback = env("ADMIN_MULTISIG_FALLBACK_HANDLER");
    if (expectedFallback && safe.fallbackHandler.toLowerCase() !== expectedFallback.toLowerCase())
      throw new Error("Safe fallback handler mismatch");
  }
  if ((await ctx.provider.getCode(addresses.paymentToken)) === "0x")
    throw new Error("PAYMENT_TOKEN has no runtime code");
  const expectedDecimals = env("PAYMENT_TOKEN_DECIMALS");
  if (expectedDecimals && BigInt(await c.token.decimals()) !== BigInt(expectedDecimals))
    throw new Error("PAYMENT_TOKEN decimals mismatch");
  const expectedFee = env("FEE_BPS");
  if (expectedFee && BigInt(await c.config.feeBps()) !== BigInt(expectedFee))
    throw new Error("feeBps mismatch");
  const expectedChallengeWindow = env("CHALLENGE_WINDOW_SECONDS");
  if (
    expectedChallengeWindow &&
    BigInt(await c.config.challengeWindow()) !== BigInt(expectedChallengeWindow)
  )
    throw new Error("challengeWindow mismatch");
  if ((await c.config.paymentToken()).toLowerCase() !== addresses.paymentToken.toLowerCase())
    throw new Error("paymentToken wiring mismatch");
  if ((await c.config.treasury()).toLowerCase() !== addresses.treasury.toLowerCase())
    throw new Error("treasury mismatch");
  if ((await c.config.gatewaySigner()).toLowerCase() !== addresses.gatewaySigner.toLowerCase())
    throw new Error("gatewaySigner mismatch");
  if ((await c.dataset.marketplace()).toLowerCase() !== addresses.marketplace.toLowerCase())
    throw new Error("DatasetRegistry marketplace wiring mismatch");
  if ((await c.nft.marketplace()).toLowerCase() !== addresses.marketplace.toLowerCase())
    throw new Error("EntitlementNFT marketplace wiring mismatch");
  if ((await c.splitter.marketplace()).toLowerCase() !== addresses.marketplace.toLowerCase())
    throw new Error("RevenueSplitter marketplace wiring mismatch");
  if ((await c.market.datasetRegistry()).toLowerCase() !== addresses.datasetRegistry.toLowerCase())
    throw new Error("Marketplace DatasetRegistry wiring mismatch");
  if ((await c.market.revenueSplitter()).toLowerCase() !== addresses.revenueSplitter.toLowerCase())
    throw new Error("Marketplace RevenueSplitter wiring mismatch");
  const expectedTimelockDelay = BigInt(env("TIMELOCK_DELAY_SECONDS", "172800"));
  if ((await c.timelock.getMinDelay()) < expectedTimelockDelay)
    throw new Error(`ProtocolTimelock delay is below ${expectedTimelockDelay} seconds`);

  const timelockAdmin = await c.timelock.DEFAULT_ADMIN_ROLE();
  const timelockAdmins = await roleMembers(c.timelock, timelockAdmin);
  if (
    timelockAdmins.count !== 1n ||
    timelockAdmins.members[0].toLowerCase() !== addresses.protocolTimelock.toLowerCase()
  ) {
    throw new Error("Timelock DEFAULT_ADMIN_ROLE is not a sole self-admin role");
  }
  for (const roleName of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
    const role = await c.timelock[roleName]();
    const members = await roleMembers(c.timelock, role);
    if (
      members.count !== 1n ||
      members.members[0].toLowerCase() !== addresses.adminMultisig.toLowerCase()
    ) {
      throw new Error(`Timelock ${roleName} member set mismatch`);
    }
  }
  for (const [name, contract] of [
    ["ContributorRegistry", c.contributor],
    ["ProtocolConfig", c.config],
    ["DatasetRegistry", c.dataset],
    ["EntitlementNFT", c.nft],
    ["RevenueSplitter", c.splitter],
    ["Marketplace", c.market],
  ]) {
    const role = await contract.DEFAULT_ADMIN_ROLE();
    const members = await roleMembers(contract, role);
    if (
      members.count !== 1n ||
      members.members[0].toLowerCase() !== addresses.protocolTimelock.toLowerCase()
    ) {
      throw new Error(`${name} DEFAULT_ADMIN_ROLE member set mismatch`);
    }
  }
  const contributorRole = await c.contributor.CONTRIBUTOR_ROLE();
  const operatorRole = await c.contributor.OPERATOR_ROLE();
  const initial = await roleMembers(c.contributor, contributorRole);
  if (env("EXPECT_INITIAL_CONTRIBUTOR_ONLY", "true") === "true") {
    if (
      initial.count !== 1n ||
      initial.members[0].toLowerCase() !== addresses.nurtureContributor.toLowerCase()
    ) {
      throw new Error("NURTURE_CONTRIBUTOR is not the sole initial CONTRIBUTOR_ROLE member");
    }
  } else if (!(await c.contributor.hasRole(contributorRole, addresses.nurtureContributor))) {
    throw new Error("NURTURE_CONTRIBUTOR no longer has CONTRIBUTOR_ROLE");
  }
  if (!(await c.contributor.hasRole(operatorRole, addresses.pipelineOperator)))
    throw new Error("PIPELINE_OPERATOR lacks OPERATOR_ROLE");
  if (await c.contributor.hasRole(contributorRole, addresses.pipelineOperator))
    throw new Error("PIPELINE_OPERATOR must not hold CONTRIBUTOR_ROLE");
  if (
    (await c.contributor.operatorContributor(addresses.pipelineOperator)).toLowerCase() !==
    addresses.nurtureContributor.toLowerCase()
  )
    throw new Error("operatorContributor mapping mismatch");
  const expectedCodeHashes = {
    protocolTimelock: "PROTOCOL_TIMELOCK_CODE_HASH",
    contributorRegistry: "CONTRIBUTOR_REGISTRY_CODE_HASH",
    protocolConfig: "PROTOCOL_CONFIG_CODE_HASH",
    datasetRegistry: "DATASET_REGISTRY_CODE_HASH",
    entitlementNFT: "ENTITLEMENT_NFT_CODE_HASH",
    revenueSplitter: "REVENUE_SPLITTER_PROXY_CODE_HASH",
    marketplace: "MARKETPLACE_PROXY_CODE_HASH",
  };
  for (const [key, variable] of Object.entries(expectedCodeHashes)) {
    const expected = env(variable);
    if (!expected) continue;
    const actual = keccak256(await ctx.provider.getCode(addresses[key]));
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${variable} mismatch`);
  }
  return { status: "strict deployment checks passed", initialContributorCount: initial.count };
}

export async function datasetSnapshot(ctx, datasetId) {
  const { dataset: d } = ctx.contracts;
  const dataset = await d.getDataset(datasetId);
  return {
    id: dataset.id,
    contributor: dataset.contributor,
    contentHash: dataset.contentHash,
    sampleURI: dataset.sampleURI,
    payloadURI: dataset.payloadURI,
    weightsRoot: dataset.weightsRoot,
    totalWeight: dataset.totalWeight,
    status: dataset.status,
    policy: dataset.policy,
    copiesSold: dataset.copiesSold,
    tag: dataset.tag,
    createdAt: dataset.createdAt,
    weightsURI: await d.weightsURI(datasetId),
    weightsManifestHash: await d.weightsManifestHash(datasetId),
    challengeWindowEndsAt: await d.challengeWindowEndsAt(datasetId),
    challengeStatus: await d.challengeStatus(datasetId),
    challengeEvidenceHash: await d.challengeEvidenceHash(datasetId),
    challengeEvidenceURI: await d.challengeEvidenceURI(datasetId),
    challengeRecordedAt: await d.challengeRecordedAt(datasetId),
    challengeResolutionDueAt: await d.challengeResolutionDueAt(datasetId),
    weightsInvalidated: await d.weightsInvalidated(datasetId),
    copyListing: await ctx.contracts.market.getListing(datasetId, 0),
    exclusiveListing: await ctx.contracts.market.getListing(datasetId, 1),
    cumulativeRevenue: await ctx.contracts.splitter.cumulativeRevenue(datasetId),
    unclaimedRevenue: await ctx.contracts.splitter.unclaimedRevenue(datasetId),
  };
}

export async function writeGuard(ctx, args, description) {
  if (!args.has("write")) throw new Error(`${description} is read-only by default; add --write`);
  if (!args.has("confirm"))
    throw new Error(`${description} requires --confirm as a second explicit acknowledgement`);
  if (env("ALLOW_BASE_SEPOLIA_WRITES") !== "true") {
    throw new Error("set ALLOW_BASE_SEPOLIA_WRITES=true in the untracked .env before broadcasting");
  }
  return true;
}

export async function sendTx(ctx, contract, functionName, values, description) {
  const tx = await contract.getFunction(functionName)(...values);
  const receipt = await tx.wait();
  return { description, hash: tx.hash, blockNumber: receipt.blockNumber, status: receipt.status };
}

export async function expectRevert(action, label) {
  try {
    await action();
  } catch (error) {
    return { label, reverted: true, reason: error.shortMessage || error.message || String(error) };
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

export function safeCalldata(contract, functionName, values) {
  return {
    to: contract.target,
    data: contract.interface.encodeFunctionData(functionName, values),
    value: "0",
  };
}

export async function writeReport(role, report) {
  const directory = env("LIVE_TEST_REPORT_DIR", rootPath("reports", "base-sepolia-live"));
  await fs.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const file = env("LIVE_TEST_REPORT", path.join(directory, `${role}-${timestamp}.json`));
  await fs.writeFile(file, JSON.stringify(jsonValue(report), null, 2) + "\n");
  return file;
}

export class Reporter {
  constructor(role, ctx) {
    this.role = role;
    this.ctx = ctx;
    this.startedAt = new Date().toISOString();
    this.steps = [];
  }

  async step(name, action) {
    const startedAt = Date.now();
    try {
      const result = await action();
      this.steps.push({ name, status: "PASS", durationMs: Date.now() - startedAt, result });
      console.log(`PASS ${name}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.shortMessage || error.message : String(error);
      this.steps.push({ name, status: "FAIL", durationMs: Date.now() - startedAt, error: message });
      console.error(`FAIL ${name}: ${message}`);
      return undefined;
    }
  }

  skip(name, reason) {
    this.steps.push({ name, status: "SKIP", reason });
    console.log(`SKIP ${name}: ${reason}`);
  }

  async finish(extra = {}) {
    const failed = this.steps.filter((step) => step.status === "FAIL");
    const report = {
      role: this.role,
      network: {
        chainId: this.ctx.network.chainId,
        blockNumber: await this.ctx.provider.getBlockNumber(),
      },
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      steps: this.steps,
      ...extra,
    };
    const file = await writeReport(this.role, report);
    console.log(`REPORT ${file}`);
    if (failed.length) process.exitCode = 1;
    return report;
  }
}

export function paymentAmount(value, decimals) {
  return formatUnits(value, decimals);
}

export function leafHash(account, weight) {
  return keccak256(abiCoder.encode(["address", "uint256"], [account, weight]));
}

export function pairHash(left, right) {
  return BigInt(left) < BigInt(right)
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

export function verifyProof(leaf, proof, root) {
  let computed = leaf;
  for (const node of proof) computed = pairHash(computed, node);
  return computed.toLowerCase() === root.toLowerCase();
}

export async function fetchManifest(uri) {
  let target = uri;
  if (uri.startsWith("ipfs://")) {
    const gateway = requiredEnv("IPFS_GATEWAY_URL").replace(/\/$/u, "");
    target = `${gateway}/ipfs/${uri.slice(7)}`;
  } else if (uri.startsWith("ar://")) target = `https://arweave.net/${uri.slice(5)}`;
  if (target.startsWith("file://")) return fs.readFile(new URL(target));
  if (!/^https?:\/\//u.test(target)) throw new Error(`unsupported manifest URI ${uri}`);
  const response = await fetch(target);
  if (!response.ok) throw new Error(`manifest unavailable: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function readBytes(file) {
  return fs.readFile(file);
}

export function validateManifestDocument(ctx, raw, expected) {
  const manifest = JSON.parse(Buffer.from(raw).toString("utf8"));
  if (manifest.schema !== "main-protocol.weights-manifest.v1")
    throw new Error("manifest schema mismatch");
  if (manifest.datasetId !== BigInt(expected.datasetId).toString())
    throw new Error("manifest datasetId mismatch");
  if (manifest.chainId !== ctx.network.chainId.toString())
    throw new Error("manifest chainId mismatch");
  if (getAddress(manifest.datasetRegistry) !== ctx.addresses.datasetRegistry)
    throw new Error("manifest registry mismatch");
  if (manifest.leafEncoding !== "keccak256(abi.encode(address,uint256))")
    throw new Error("manifest leaf encoding mismatch");
  if (manifest.pairHashing !== "sorted-keccak256;promote-unpaired")
    throw new Error("manifest pair hashing mismatch");
  if (manifest.totalWeight !== BigInt(expected.totalWeight).toString())
    throw new Error("manifest totalWeight mismatch");
  if (manifest.weightsRoot.toLowerCase() !== expected.weightsRoot.toLowerCase())
    throw new Error("manifest weightsRoot mismatch");
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0)
    throw new Error("manifest entries are empty");
  const seen = new Set();
  let sum = 0n;
  for (const entry of manifest.entries) {
    const who = address(entry.address, "manifest entry address");
    if (seen.has(who.toLowerCase())) throw new Error(`duplicate manifest address ${who}`);
    seen.add(who.toLowerCase());
    const weight = uint(entry.weight, `weight for ${who}`, { positive: true });
    if (weight > BigInt(expected.totalWeight))
      throw new Error(`weight exceeds totalWeight for ${who}`);
    sum += weight;
    if (!verifyProof(leafHash(who, weight), entry.proof, manifest.weightsRoot)) {
      throw new Error(`invalid Merkle proof for ${who}`);
    }
  }
  if (sum !== BigInt(expected.totalWeight))
    throw new Error("manifest weights do not sum to totalWeight");
  const manifestHash = keccak256(raw);
  if (expected.manifestHash && manifestHash.toLowerCase() !== expected.manifestHash.toLowerCase())
    throw new Error("manifest bytes hash does not match expected weightsManifestHash");
  return { manifest, manifestHash, entries: manifest.entries };
}

export async function validateManifest(ctx, raw, datasetId) {
  const d = await datasetSnapshot(ctx, datasetId);
  return validateManifestDocument(ctx, raw, {
    datasetId,
    totalWeight: d.totalWeight,
    weightsRoot: d.weightsRoot,
    manifestHash: d.weightsManifestHash,
  });
}

export function findManifestEntry(verified, who) {
  const normalized = getAddress(who).toLowerCase();
  const entry = verified.entries.find(
    (item) => getAddress(item.address).toLowerCase() === normalized,
  );
  if (!entry) throw new Error(`manifest has no weight entry for ${who}`);
  return entry;
}

export { BASE_SEPOLIA_CHAIN_ID, ERC20_ABI, ROOT, ZeroAddress };

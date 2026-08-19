import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { FetchRequest, JsonRpcProvider, Wallet, Contract, getAddress } from "ethers";

const root = process.cwd();
const config = JSON.parse(
  await fs.readFile(path.join(root, "web/config/base-sepolia.json"), "utf8"),
);
const abiFiles = {
  contributorRegistry: "ContributorRegistry.abi.json",
  protocolConfig: "ProtocolConfig.abi.json",
  datasetRegistry: "DatasetRegistry.abi.json",
  entitlementNFT: "EntitlementNFT.abi.json",
  marketplaceProxy: "Marketplace.abi.json",
  revenueSplitterProxy: "RevenueSplitter.abi.json",
  protocolTimelock: "ProtocolTimelock.abi.json",
  paymentToken: "PaymentTokenERC20.abi.json",
};
const abis = {};
for (const [key, file] of Object.entries(abiFiles))
  abis[key] = JSON.parse(await fs.readFile(path.join(root, "ABI", file), "utf8"));

const request = new FetchRequest(config.network.rpcUrl);
request.timeout = 15_000;
const provider = new JsonRpcProvider(request, config.network.chainId, { staticNetwork: true });
const network = await provider.getNetwork();
const addresses = config.addresses;
const contract = (key) => new Contract(addresses[key], abis[key], provider);
const checks = [];
const skips = [];
const failures = [];
const pass = (name, detail = {}) => checks.push({ name, status: "PASS", detail });
const fail = (name, error) => {
  failures.push({ name, error: String(error?.message ?? error) });
};
const skip = (name, reason) => skips.push({ name, status: "SKIP", reason });

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} missing`);
  return process.env[name];
}

const accounts = {};
for (const [role, keyName, addressName] of [
  ["buyer", "BUYER_PRIVATE_KEY", "BUYER_ADDRESS"],
  ["claimant", "CLAIMANT_PRIVATE_KEY", "CLAIMANT_ADDRESS"],
  ["contributor", "CONTRIBUTOR_PRIVATE_KEY", "CONTRIBUTOR_ADDRESS"],
  ["operator", "OPERATOR_PRIVATE_KEY", "OPERATOR_ADDRESS"],
  ["treasury", "TREASURY_PRIVATE_KEY", "TREASURY_ADDRESS"],
]) {
  try {
    const wallet = new Wallet(requireEnv(keyName));
    const configured = getAddress(requireEnv(addressName));
    accounts[role] = {
      address: wallet.address,
      configuredAddress: configured,
      addressMatch: wallet.address.toLowerCase() === configured.toLowerCase(),
    };
    if (!accounts[role].addressMatch)
      fail(`${role} address consistency`, `${keyName} does not match ${addressName}`);
    else pass(`${role} address consistency`, { address: wallet.address });
  } catch (error) {
    fail(`${role} account configuration`, error);
  }
}

if (Number(network.chainId) === config.network.chainId)
  pass("chainId", { chainId: Number(network.chainId) });
else fail("chainId", `RPC returned ${network.chainId}, expected ${config.network.chainId}`);

for (const key of [
  "protocolTimelock",
  "contributorRegistry",
  "protocolConfig",
  "datasetRegistry",
  "entitlementNFT",
  "revenueSplitterProxy",
  "marketplaceProxy",
  "paymentToken",
]) {
  try {
    const code = await provider.getCode(addresses[key]);
    if (code === "0x") fail(`${key} runtime code`, "no code");
    else pass(`${key} runtime code`);
  } catch (error) {
    fail(`${key} runtime code`, error);
  }
}

try {
  const cr = contract("contributorRegistry");
  const pc = contract("protocolConfig");
  const dr = contract("datasetRegistry");
  const nft = contract("entitlementNFT");
  const mp = contract("marketplaceProxy");
  const rs = contract("revenueSplitterProxy");
  const tl = contract("protocolTimelock");
  const [adminRole, operatorRole, contributorRole, proposerRole, executorRole] = await Promise.all([
    cr.ADMIN_ROLE(),
    cr.OPERATOR_ROLE(),
    cr.CONTRIBUTOR_ROLE(),
    tl.PROPOSER_ROLE(),
    tl.EXECUTOR_ROLE(),
  ]);
  const [feeBps, challengeWindow, paused, nextDatasetId, delay, minimum, paymentToken] =
    await Promise.all([
      pc.feeBps(),
      pc.challengeWindow(),
      pc.paused(),
      dr.nextDatasetId(),
      tl.getMinDelay(),
      tl.enforcedMinimumDelay(),
      pc.paymentToken(),
    ]);
  if (paymentToken.toLowerCase() !== addresses.paymentToken.toLowerCase())
    fail("payment token binding", `${paymentToken} != ${addresses.paymentToken}`);
  else pass("payment token binding", { paymentToken });
  if (delay < minimum) fail("timelock minimum", `${delay} < ${minimum}`);
  else pass("timelock minimum", { delay: delay.toString(), minimum: minimum.toString() });
  const bindings = {
    marketplaceDatasetRegistry: [await mp.datasetRegistry(), addresses.datasetRegistry],
    marketplaceNFT: [await mp.entitlementNFT(), addresses.entitlementNFT],
    marketplaceRevenueSplitter: [await mp.revenueSplitter(), addresses.revenueSplitterProxy],
    splitterDatasetRegistry: [await rs.datasetRegistry(), addresses.datasetRegistry],
    splitterMarketplace: [await rs.marketplace(), addresses.marketplaceProxy],
    datasetMarketplace: [await dr.marketplace(), addresses.marketplaceProxy],
    nftMarketplace: [await nft.marketplace(), addresses.marketplaceProxy],
  };
  for (const [name, [actual, expected]] of Object.entries(bindings))
    if (actual.toLowerCase() !== expected.toLowerCase()) fail(name, `${actual} != ${expected}`);
    else pass(name);
  pass("protocol runtime configuration", {
    feeBps: Number(feeBps),
    challengeWindow: Number(challengeWindow),
    paused,
    nextDatasetId: Number(nextDatasetId),
  });
  for (const [role, account] of Object.entries(accounts)) {
    const [admin, operator, contributor, proposer, executor, balance] = await Promise.all([
      cr.hasRole(adminRole, account.address),
      cr.hasRole(operatorRole, account.address),
      cr.hasRole(contributorRole, account.address),
      tl.hasRole(proposerRole, account.address),
      tl.hasRole(executorRole, account.address),
      provider.getBalance(account.address),
    ]);
    account.roles = { admin, operator, contributor, proposer, executor };
    account.balanceWei = balance.toString();
    pass(`${role} role read`, {
      address: account.address,
      roles: account.roles,
      balanceWei: account.balanceWei,
    });
  }
  const operator = accounts.operator;
  if (operator) {
    operator.operatorContributor = await cr.operatorContributor(operator.address);
    pass("operator attribution read", {
      operator: operator.address,
      contributor: operator.operatorContributor,
    });
  }
  const token = contract("paymentToken");
  if (accounts.buyer) {
    const [decimals, balance, allowance] = await Promise.all([
      token.decimals(),
      token.balanceOf(accounts.buyer.address),
      token.allowance(accounts.buyer.address, addresses.marketplaceProxy),
    ]);
    accounts.buyer.paymentToken = {
      decimals: Number(decimals),
      balance: balance.toString(),
      marketplaceAllowance: allowance.toString(),
    };
    pass("buyer payment-token read", accounts.buyer.paymentToken);
  }
  const datasetCount = Number(nextDatasetId) - 1;
  if (datasetCount <= 0) {
    for (const name of [
      "buyer purchase",
      "contributor registration",
      "operator registration",
      "claimant claim",
      "admin challenge",
      "treasury withdrawal",
      "gateway entitlement",
    ])
      skip(name, "当前链上 nextDatasetId=1，尚无专用 Dataset；不会伪造 PASS");
  } else pass("dataset inventory available", { datasetCount });
} catch (error) {
  fail("protocol read/wiring suite", error);
}

const report = {
  schemaVersion: "main-protocol-web-role-preflight-v1",
  generatedAt: new Date().toISOString(),
  network: {
    chainId: Number(network.chainId),
    rpcUrl: config.network.rpcUrl,
    deploymentId: config.release.deploymentId,
  },
  release: config.release,
  accounts,
  checks,
  skips,
  failures,
  summary: {
    pass: checks.length,
    skip: skips.length,
    fail: failures.length,
    writeBroadcast: false,
  },
};
const reportDir = path.join(root, "reports", "web-role-preflight");
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;

import { isAddress, ZeroAddress } from "ethers";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (value === undefined || !isAddress(value) || value === ZeroAddress) {
    throw new Error(`${name} must be a nonzero EVM address`);
  }
  return value;
}

function requiredInteger(name: string, min: number, max?: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new Error(`${name} must be an integer >= ${min}${max ? ` and <= ${max}` : ""}`);
  }
  return value;
}

function assertDeployment(condition: boolean, message: string): void {
  if (!condition) throw new Error(`deployment verification failed: ${message}`);
}

const paymentToken = requiredAddress("PAYMENT_TOKEN");
const adminMultisig = requiredAddress("ADMIN_MULTISIG");
const treasury = requiredAddress("TREASURY");
const gatewaySigner = requiredAddress("GATEWAY_SIGNER");
const feeBps = requiredInteger("FEE_BPS", 0, 10_000);
const challengeWindow = requiredInteger("CHALLENGE_WINDOW_SECONDS", 1);

const connection = await hre.network.create();
const { ethers } = connection;
const upgradesApi = await upgrades(hre, connection);
const [deployer] = await ethers.getSigners();

const allowEoaAdmin = process.env.ALLOW_EOA_ADMIN === "true";
if ((await ethers.provider.getCode(paymentToken)) === "0x") {
  throw new Error("PAYMENT_TOKEN must be a deployed ERC-20 contract");
}
if (!allowEoaAdmin && (await ethers.provider.getCode(adminMultisig)) === "0x") {
  throw new Error(
    "ADMIN_MULTISIG must be a deployed multisig contract; set ALLOW_EOA_ADMIN=true only for local tests",
  );
}

const protocolTimelock = await ethers.deployContract("ProtocolTimelock", [adminMultisig]);
await protocolTimelock.waitForDeployment();
const governanceTimelock = await protocolTimelock.getAddress();

const contributorRegistry = await ethers.deployContract("ContributorRegistry", [
  governanceTimelock,
  adminMultisig,
]);
await contributorRegistry.waitForDeployment();

const protocolConfig = await ethers.deployContract("ProtocolConfig", [
  paymentToken,
  feeBps,
  treasury,
  challengeWindow,
  gatewaySigner,
  governanceTimelock,
  adminMultisig,
]);
await protocolConfig.waitForDeployment();

const datasetRegistry = await ethers.deployContract("DatasetRegistry", [
  await contributorRegistry.getAddress(),
  await protocolConfig.getAddress(),
  governanceTimelock,
  adminMultisig,
]);
await datasetRegistry.waitForDeployment();

const entitlementNFT = await ethers.deployContract("EntitlementNFT", [
  await datasetRegistry.getAddress(),
  governanceTimelock,
  adminMultisig,
]);
await entitlementNFT.waitForDeployment();

const splitterFactory = await ethers.getContractFactory("RevenueSplitter");
const revenueSplitter = await upgradesApi.deployProxy(
  splitterFactory,
  [
    await protocolConfig.getAddress(),
    await datasetRegistry.getAddress(),
    governanceTimelock,
    adminMultisig,
  ],
  { kind: "uups" },
);
await revenueSplitter.waitForDeployment();

const marketplaceFactory = await ethers.getContractFactory("Marketplace");
const marketplace = await upgradesApi.deployProxy(
  marketplaceFactory,
  [
    await protocolConfig.getAddress(),
    await datasetRegistry.getAddress(),
    await entitlementNFT.getAddress(),
    await revenueSplitter.getAddress(),
    governanceTimelock,
  ],
  { kind: "uups" },
);
await marketplace.waitForDeployment();

const marketplaceAddress = await marketplace.getAddress();
const deployerIsAdmin = deployer.address.toLowerCase() === adminMultisig.toLowerCase();
if (deployerIsAdmin) {
  await (await datasetRegistry.setMarketplaceOnce(marketplaceAddress)).wait();
  await (await entitlementNFT.setMarketplaceOnce(marketplaceAddress)).wait();
  await (await revenueSplitter.setMarketplaceOnce(marketplaceAddress)).wait();
}

const wiringTransactions = deployerIsAdmin
  ? []
  : [datasetRegistry, entitlementNFT, revenueSplitter].map((contract) => ({
      to: contract.target,
      data: contract.interface.encodeFunctionData("setMarketplaceOnce", [marketplaceAddress]),
    }));

const timelockDelay = await protocolTimelock.getMinDelay();
const proposerRole = await protocolTimelock.PROPOSER_ROLE();
const executorRole = await protocolTimelock.EXECUTOR_ROLE();
const cancellerRole = await protocolTimelock.CANCELLER_ROLE();
const defaultAdminRole = await protocolTimelock.DEFAULT_ADMIN_ROLE();
assertDeployment(timelockDelay === 48n * 60n * 60n, "timelock delay is not 48 hours");
assertDeployment(
  await protocolTimelock.hasRole(proposerRole, adminMultisig),
  "ADMIN_MULTISIG lacks Timelock proposer role",
);
assertDeployment(
  await protocolTimelock.hasRole(executorRole, adminMultisig),
  "ADMIN_MULTISIG lacks Timelock executor role",
);
assertDeployment(
  await protocolTimelock.hasRole(cancellerRole, adminMultisig),
  "ADMIN_MULTISIG lacks Timelock canceller role",
);
assertDeployment(
  await protocolTimelock.hasRole(defaultAdminRole, governanceTimelock),
  "Timelock is not self-administered",
);

const governedContracts = [
  contributorRegistry,
  protocolConfig,
  datasetRegistry,
  entitlementNFT,
  revenueSplitter,
  marketplace,
];
for (const contract of governedContracts) {
  assertDeployment(
    await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), governanceTimelock),
    `${contract.target} is not governed by ProtocolTimelock`,
  );
}
assertDeployment((await protocolConfig.paymentToken()) === paymentToken, "payment token mismatch");
assertDeployment((await protocolConfig.feeBps()) === BigInt(feeBps), "fee mismatch");
assertDeployment((await protocolConfig.treasury()) === treasury, "treasury mismatch");
assertDeployment(
  (await protocolConfig.challengeWindow()) === BigInt(challengeWindow),
  "challenge window mismatch",
);
assertDeployment(
  (await protocolConfig.gatewaySigner()) === gatewaySigner,
  "gateway signer mismatch",
);
assertDeployment(!(await protocolConfig.paused()), "protocol unexpectedly paused");

if (deployerIsAdmin) {
  assertDeployment(
    (await datasetRegistry.marketplace()) === marketplaceAddress,
    "DatasetRegistry wiring mismatch",
  );
  assertDeployment(
    (await entitlementNFT.marketplace()) === marketplaceAddress,
    "EntitlementNFT wiring mismatch",
  );
  assertDeployment(
    (await revenueSplitter.marketplace()) === marketplaceAddress,
    "RevenueSplitter wiring mismatch",
  );
}

const deployments = {
  protocolTimelock: governanceTimelock,
  contributorRegistry: await contributorRegistry.getAddress(),
  protocolConfig: await protocolConfig.getAddress(),
  datasetRegistry: await datasetRegistry.getAddress(),
  entitlementNFT: await entitlementNFT.getAddress(),
  revenueSplitter: await revenueSplitter.getAddress(),
  marketplace: marketplaceAddress,
  paymentToken,
  governanceTimelock,
  adminMultisig,
  treasury,
  gatewaySigner,
  feeBps,
  challengeWindow,
  wiringComplete: deployerIsAdmin,
  wiringTransactions,
  timelockMinDelay: timelockDelay.toString(),
  marketplaceImplementation: await upgradesApi.erc1967.getImplementationAddress(marketplaceAddress),
  revenueSplitterImplementation: await upgradesApi.erc1967.getImplementationAddress(
    await revenueSplitter.getAddress(),
  ),
};

console.log(JSON.stringify(deployments, null, 2));

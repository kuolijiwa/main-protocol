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

function requiredInteger(name: string, min: number, max?: number): bigint {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = BigInt(raw);
  if (value < BigInt(min) || (max !== undefined && value > BigInt(max))) {
    throw new Error(`${name} is outside the permitted range`);
  }
  return value;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`deployment verification failed: ${message}`);
}

const addresses = {
  protocolTimelock: requiredAddress("PROTOCOL_TIMELOCK"),
  contributorRegistry: requiredAddress("CONTRIBUTOR_REGISTRY"),
  protocolConfig: requiredAddress("PROTOCOL_CONFIG"),
  datasetRegistry: requiredAddress("DATASET_REGISTRY"),
  entitlementNFT: requiredAddress("ENTITLEMENT_NFT"),
  revenueSplitter: requiredAddress("REVENUE_SPLITTER"),
  marketplace: requiredAddress("MARKETPLACE"),
  paymentToken: requiredAddress("PAYMENT_TOKEN"),
  adminMultisig: requiredAddress("ADMIN_MULTISIG"),
  treasury: requiredAddress("TREASURY"),
  gatewaySigner: requiredAddress("GATEWAY_SIGNER"),
};
const feeBps = requiredInteger("FEE_BPS", 0, 10_000);
const challengeWindow = requiredInteger("CHALLENGE_WINDOW_SECONDS", 1);

const connection = await hre.network.create();
const { ethers } = connection;
const upgradesApi = await upgrades(hre, connection);

for (const [name, address] of Object.entries(addresses)) {
  check(
    (await ethers.provider.getCode(address)) !== "0x" ||
      name === "treasury" ||
      name === "gatewaySigner",
    `${name} has no deployed code`,
  );
}

const timelock = await ethers.getContractAt("ProtocolTimelock", addresses.protocolTimelock);
const contributors = await ethers.getContractAt(
  "ContributorRegistry",
  addresses.contributorRegistry,
);
const config = await ethers.getContractAt("ProtocolConfig", addresses.protocolConfig);
const datasets = await ethers.getContractAt("DatasetRegistry", addresses.datasetRegistry);
const nft = await ethers.getContractAt("EntitlementNFT", addresses.entitlementNFT);
const splitter = await ethers.getContractAt("RevenueSplitter", addresses.revenueSplitter);
const market = await ethers.getContractAt("Marketplace", addresses.marketplace);

check((await timelock.getMinDelay()) === 48n * 60n * 60n, "Timelock delay is not 48 hours");
check(
  await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), addresses.protocolTimelock),
  "Timelock is not self-administered",
);
for (const role of [
  await timelock.PROPOSER_ROLE(),
  await timelock.EXECUTOR_ROLE(),
  await timelock.CANCELLER_ROLE(),
]) {
  check(
    await timelock.hasRole(role, addresses.adminMultisig),
    "ADMIN_MULTISIG lacks a Timelock role",
  );
}

for (const contract of [contributors, config, datasets, nft, splitter, market]) {
  check(
    await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), addresses.protocolTimelock),
    `${contract.target} is not governed by ProtocolTimelock`,
  );
}

for (const contract of [contributors, config, datasets, nft, splitter]) {
  check(
    await contract.hasRole(await contract.ADMIN_ROLE(), addresses.adminMultisig),
    `${contract.target} lacks the operational ADMIN multisig role`,
  );
}

check((await config.paymentToken()) === addresses.paymentToken, "payment token mismatch");
check((await config.feeBps()) === feeBps, "fee mismatch");
check((await config.treasury()) === addresses.treasury, "treasury mismatch");
check((await config.challengeWindow()) === challengeWindow, "challenge window mismatch");
check((await config.gatewaySigner()) === addresses.gatewaySigner, "gateway signer mismatch");
check(!(await config.paused()), "protocol is paused");

check(
  (await datasets.contributorRegistry()) === addresses.contributorRegistry,
  "ContributorRegistry dependency mismatch",
);
check(
  (await datasets.protocolConfig()) === addresses.protocolConfig,
  "DatasetRegistry config mismatch",
);
check((await nft.datasetRegistry()) === addresses.datasetRegistry, "NFT DatasetRegistry mismatch");
check(
  (await splitter.protocolConfig()) === addresses.protocolConfig,
  "RevenueSplitter config mismatch",
);
check(
  (await splitter.datasetRegistry()) === addresses.datasetRegistry,
  "RevenueSplitter registry mismatch",
);
check((await market.protocolConfig()) === addresses.protocolConfig, "Marketplace config mismatch");
check(
  (await market.datasetRegistry()) === addresses.datasetRegistry,
  "Marketplace registry mismatch",
);
check((await market.entitlementNFT()) === addresses.entitlementNFT, "Marketplace NFT mismatch");
check(
  (await market.revenueSplitter()) === addresses.revenueSplitter,
  "Marketplace splitter mismatch",
);

check(
  (await datasets.marketplace()) === addresses.marketplace,
  "DatasetRegistry wiring incomplete",
);
check((await nft.marketplace()) === addresses.marketplace, "EntitlementNFT wiring incomplete");
check(
  (await splitter.marketplace()) === addresses.marketplace,
  "RevenueSplitter wiring incomplete",
);

const marketplaceImplementation = await upgradesApi.erc1967.getImplementationAddress(
  addresses.marketplace,
);
const splitterImplementation = await upgradesApi.erc1967.getImplementationAddress(
  addresses.revenueSplitter,
);
check(
  (await ethers.provider.getCode(marketplaceImplementation)) !== "0x",
  "Marketplace implementation missing",
);
check(
  (await ethers.provider.getCode(splitterImplementation)) !== "0x",
  "RevenueSplitter implementation missing",
);

console.log(
  JSON.stringify(
    {
      verified: true,
      marketplaceImplementation,
      revenueSplitterImplementation: splitterImplementation,
      timelockMinDelay: (await timelock.getMinDelay()).toString(),
    },
    null,
    2,
  ),
);

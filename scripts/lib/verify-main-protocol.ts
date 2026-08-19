import hre from "hardhat";
import { type BaseContract, id, keccak256 } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import {
  check,
  type Environment,
  isSimulatedNetwork,
  requiredAddress,
  requiredBytes32,
  requiredInteger,
  sameAddressSet,
  validateExternalDeploymentInputs,
} from "./deployment-validation.js";

async function checkExactRoleMembers(
  contract: BaseContract,
  role: string,
  expectedMembers: string[],
  label: string,
): Promise<void> {
  const count = BigInt(await contract.getFunction("getRoleMemberCount")(role));
  const actualMembers: string[] = [];
  for (let index = 0n; index < count; index += 1n) {
    actualMembers.push(String(await contract.getFunction("getRoleMember")(role, index)));
  }
  check(sameAddressSet(actualMembers, expectedMembers), `${label} member set mismatch`);
}

export async function verifyMainProtocol(
  connection: NetworkConnection,
  env: Environment,
): Promise<Record<string, unknown>> {
  const addresses = {
    protocolTimelock: requiredAddress(env, "PROTOCOL_TIMELOCK"),
    contributorRegistry: requiredAddress(env, "CONTRIBUTOR_REGISTRY"),
    protocolConfig: requiredAddress(env, "PROTOCOL_CONFIG"),
    datasetRegistry: requiredAddress(env, "DATASET_REGISTRY"),
    entitlementNFT: requiredAddress(env, "ENTITLEMENT_NFT"),
    revenueSplitter: requiredAddress(env, "REVENUE_SPLITTER"),
    marketplace: requiredAddress(env, "MARKETPLACE"),
    paymentToken: requiredAddress(env, "PAYMENT_TOKEN"),
    adminMultisig: requiredAddress(env, "ADMIN_MULTISIG"),
    treasury: requiredAddress(env, "TREASURY"),
    gatewaySigner: requiredAddress(env, "GATEWAY_SIGNER"),
  };
  const expectedRuntimeCodeHashes: Record<string, string> = {
    protocolTimelock: requiredBytes32(env, "PROTOCOL_TIMELOCK_CODE_HASH"),
    contributorRegistry: requiredBytes32(env, "CONTRIBUTOR_REGISTRY_CODE_HASH"),
    protocolConfig: requiredBytes32(env, "PROTOCOL_CONFIG_CODE_HASH"),
    datasetRegistry: requiredBytes32(env, "DATASET_REGISTRY_CODE_HASH"),
    entitlementNFT: requiredBytes32(env, "ENTITLEMENT_NFT_CODE_HASH"),
    revenueSplitter: requiredBytes32(env, "REVENUE_SPLITTER_PROXY_CODE_HASH"),
    marketplace: requiredBytes32(env, "MARKETPLACE_PROXY_CODE_HASH"),
  };
  const expectedMarketplaceImplementation = requiredAddress(env, "MARKETPLACE_IMPLEMENTATION");
  const expectedRevenueSplitterImplementation = requiredAddress(
    env,
    "REVENUE_SPLITTER_IMPLEMENTATION",
  );
  const feeBps = requiredInteger(env, "FEE_BPS", 0n, 10_000n);
  const challengeWindow = requiredInteger(env, "CHALLENGE_WINDOW_SECONDS", 1n, 2n ** 64n - 1n);
  const deployerAddress = requiredAddress(env, "DEPLOYER_ADDRESS");
  const nurtureContributor = requiredAddress(env, "NURTURE_CONTRIBUTOR");
  const pipelineOperator = requiredAddress(env, "PIPELINE_OPERATOR");
  if (nurtureContributor === pipelineOperator) {
    throw new Error("NURTURE_CONTRIBUTOR and PIPELINE_OPERATOR must be distinct addresses");
  }

  const allowEoaAdmin =
    env.ALLOW_EOA_ADMIN === "true" &&
    (isSimulatedNetwork(connection) || env.ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST === "true");
  const liveTestState =
    connection.networkName === "baseSepolia" &&
    env.ALLOW_BASE_SEPOLIA_WRITES === "true" &&
    env.VERIFY_LIVE_TEST_STATE === "true";
  const testOperator =
    liveTestState && env.TEST_OPERATOR_ADDRESS
      ? requiredAddress(env, "TEST_OPERATOR_ADDRESS")
      : undefined;
  const testContributor =
    liveTestState && env.TEST_CONTRIBUTOR_ADDRESS
      ? requiredAddress(env, "TEST_CONTRIBUTOR_ADDRESS")
      : undefined;
  if (liveTestState && (testOperator === undefined || testContributor === undefined)) {
    throw new Error(
      "VERIFY_LIVE_TEST_STATE=true requires TEST_OPERATOR_ADDRESS and TEST_CONTRIBUTOR_ADDRESS",
    );
  }
  const expectedTimelockDelay =
    env.TIMELOCK_DELAY_SECONDS === undefined
      ? 48n * 60n * 60n
      : requiredInteger(env, "TIMELOCK_DELAY_SECONDS", 1n);
  const shortDelayTestMode =
    connection.networkName === "baseSepolia" &&
    env.ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST === "true" &&
    expectedTimelockDelay < 48n * 60n * 60n;
  check(
    shortDelayTestMode ? expectedTimelockDelay >= 60n : expectedTimelockDelay >= 48n * 60n * 60n,
    shortDelayTestMode
      ? "short-delay test Timelock must be at least 60 seconds"
      : "production Timelock delay must be at least 48 hours",
  );
  const externalValidation = await validateExternalDeploymentInputs(
    connection,
    env,
    addresses.paymentToken,
    addresses.adminMultisig,
    deployerAddress,
  );
  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);

  for (const [name, address] of Object.entries(addresses)) {
    const mayBeEoa =
      name === "treasury" ||
      name === "gatewaySigner" ||
      (name === "adminMultisig" && allowEoaAdmin);
    check(
      (await ethers.provider.getCode(address)) !== "0x" || mayBeEoa,
      `${name} has no deployed code`,
    );
    if (name in expectedRuntimeCodeHashes) {
      check(
        keccak256(await ethers.provider.getCode(address)).toLowerCase() ===
          expectedRuntimeCodeHashes[name],
        `${name} runtime code hash mismatch`,
      );
    }
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

  check(
    (await timelock.getMinDelay()) >= expectedTimelockDelay,
    `Timelock delay is below the configured minimum of ${expectedTimelockDelay} seconds`,
  );
  check(
    await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), addresses.protocolTimelock),
    "Timelock is not self-administered",
  );
  await checkExactRoleMembers(
    timelock,
    await timelock.DEFAULT_ADMIN_ROLE(),
    [addresses.protocolTimelock],
    "Timelock DEFAULT_ADMIN_ROLE",
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
    if (!allowEoaAdmin) {
      check(
        !(await timelock.hasRole(role, deployerAddress)),
        "deployer retains a ProtocolTimelock role",
      );
    }
    await checkExactRoleMembers(
      timelock,
      role,
      [addresses.adminMultisig],
      "Timelock authority role",
    );
  }
  if (!allowEoaAdmin) {
    check(
      !(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployerAddress)),
      "deployer retains Timelock DEFAULT_ADMIN_ROLE",
    );
  }
  check(
    !(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), addresses.adminMultisig)),
    "ADMIN_MULTISIG holds Timelock DEFAULT_ADMIN_ROLE",
  );

  for (const contract of [contributors, config, datasets, nft, splitter, market]) {
    check(
      (await contract.governanceTimelock()) === addresses.protocolTimelock,
      `${contract.target} fixed governance timelock mismatch`,
    );
    check(
      await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), addresses.protocolTimelock),
      `${contract.target} is not governed by ProtocolTimelock`,
    );
    check(
      !(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), addresses.adminMultisig)),
      `${contract.target} leaves DEFAULT_ADMIN_ROLE on ADMIN_MULTISIG`,
    );
    if (!allowEoaAdmin) {
      check(
        !(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), deployerAddress)),
        `${contract.target} leaves DEFAULT_ADMIN_ROLE on deployer`,
      );
    }
    await checkExactRoleMembers(
      contract,
      await contract.DEFAULT_ADMIN_ROLE(),
      [addresses.protocolTimelock],
      `${contract.target} DEFAULT_ADMIN_ROLE`,
    );
  }

  for (const contract of [contributors, config, datasets, nft, splitter]) {
    check(
      await contract.hasRole(await contract.ADMIN_ROLE(), addresses.adminMultisig),
      `${contract.target} lacks the operational ADMIN multisig role`,
    );
    if (!allowEoaAdmin) {
      check(
        !(await contract.hasRole(await contract.ADMIN_ROLE(), deployerAddress)),
        `${contract.target} leaves ADMIN_ROLE on deployer`,
      );
    }
    await checkExactRoleMembers(
      contract,
      await contract.ADMIN_ROLE(),
      [addresses.adminMultisig],
      `${contract.target} ADMIN_ROLE`,
    );
  }
  if (!allowEoaAdmin) {
    check(
      !(await contributors.hasRole(await contributors.OPERATOR_ROLE(), deployerAddress)),
      "ContributorRegistry leaves OPERATOR_ROLE on deployer",
    );
    check(
      !(await contributors.hasRole(await contributors.CONTRIBUTOR_ROLE(), deployerAddress)),
      "ContributorRegistry leaves CONTRIBUTOR_ROLE on deployer",
    );
  }
  const contributorRole = await contributors.CONTRIBUTOR_ROLE();
  check(
    await contributors.hasRole(contributorRole, nurtureContributor),
    "NURTURE_CONTRIBUTOR lacks CONTRIBUTOR_ROLE",
  );
  const expectedOperatorMembers = [pipelineOperator, ...(testOperator ? [testOperator] : [])];
  const expectedContributorMembers = [
    nurtureContributor,
    ...(testContributor ? [testContributor] : []),
  ];
  await checkExactRoleMembers(
    contributors,
    await contributors.OPERATOR_ROLE(),
    expectedOperatorMembers,
    liveTestState ? "OPERATOR_ROLE in live test state" : "OPERATOR_ROLE",
  );
  if (liveTestState) {
    await checkExactRoleMembers(
      contributors,
      contributorRole,
      expectedContributorMembers,
      "CONTRIBUTOR_ROLE in live test state",
    );
  } else {
    check(
      (await contributors.getRoleMemberCount(contributorRole)) === 1n,
      "CONTRIBUTOR_ROLE must have exactly one initial member",
    );
    check(
      (await contributors.getRoleMember(contributorRole, 0n)) === nurtureContributor,
      "NURTURE_CONTRIBUTOR must be the sole initial CONTRIBUTOR_ROLE member",
    );
  }
  check(
    await contributors.hasRole(await contributors.OPERATOR_ROLE(), pipelineOperator),
    "PIPELINE_OPERATOR lacks OPERATOR_ROLE",
  );
  check(
    !(await contributors.hasRole(contributorRole, pipelineOperator)),
    "PIPELINE_OPERATOR must not hold CONTRIBUTOR_ROLE",
  );
  check(
    (await contributors.operatorContributor(pipelineOperator)) === nurtureContributor,
    "PIPELINE_OPERATOR is not assigned to NURTURE_CONTRIBUTOR",
  );
  if (testOperator && testContributor) {
    check(
      (await contributors.operatorContributor(testOperator)) === testContributor,
      "TEST_OPERATOR_ADDRESS is not assigned to TEST_CONTRIBUTOR_ADDRESS",
    );
    check(
      !(await contributors.hasRole(contributorRole, testOperator)),
      "TEST_OPERATOR_ADDRESS must not hold CONTRIBUTOR_ROLE",
    );
  }

  check((await config.paymentToken()) === addresses.paymentToken, "payment token mismatch");
  check((await config.feeBps()) === feeBps, "fee mismatch");
  check((await config.treasury()) === addresses.treasury, "treasury mismatch");
  check((await config.challengeWindow()) === challengeWindow, "challenge window mismatch");
  check((await config.gatewaySigner()) === addresses.gatewaySigner, "gateway signer mismatch");
  check(!(await config.paused()), "protocol is paused");

  check(
    (await datasets.WEIGHTS_MANIFEST_VERSION()) === id("main-protocol.weights-manifest.v1"),
    "weights Manifest version mismatch",
  );
  check(
    (await datasets.CHALLENGE_EVIDENCE_VERSION()) ===
      id("main-protocol.weight-challenge-evidence.v1"),
    "challenge evidence version mismatch",
  );
  check(
    (await datasets.CHALLENGE_RESOLUTION_SLA()) === 72n * 60n * 60n,
    "challenge resolution SLA mismatch",
  );

  check(
    (await datasets.contributorRegistry()) === addresses.contributorRegistry,
    "ContributorRegistry dependency mismatch",
  );
  check(
    (await datasets.protocolConfig()) === addresses.protocolConfig,
    "DatasetRegistry config mismatch",
  );
  check(
    (await nft.datasetRegistry()) === addresses.datasetRegistry,
    "NFT DatasetRegistry mismatch",
  );
  check(
    (await splitter.protocolConfig()) === addresses.protocolConfig,
    "RevenueSplitter config mismatch",
  );
  check(
    (await splitter.datasetRegistry()) === addresses.datasetRegistry,
    "RevenueSplitter registry mismatch",
  );
  check(
    (await market.protocolConfig()) === addresses.protocolConfig,
    "Marketplace config mismatch",
  );
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
  const revenueSplitterImplementation = await upgradesApi.erc1967.getImplementationAddress(
    addresses.revenueSplitter,
  );
  check(
    marketplaceImplementation === expectedMarketplaceImplementation,
    "Marketplace implementation address mismatch",
  );
  check(
    revenueSplitterImplementation === expectedRevenueSplitterImplementation,
    "RevenueSplitter implementation address mismatch",
  );
  check(
    (await ethers.provider.getCode(marketplaceImplementation)) !== "0x",
    "Marketplace implementation missing",
  );
  check(
    (await ethers.provider.getCode(revenueSplitterImplementation)) !== "0x",
    "RevenueSplitter implementation missing",
  );
  check(
    keccak256(await ethers.provider.getCode(marketplaceImplementation)).toLowerCase() ===
      requiredBytes32(env, "MARKETPLACE_IMPLEMENTATION_CODE_HASH"),
    "Marketplace implementation runtime code hash mismatch",
  );
  check(
    keccak256(await ethers.provider.getCode(revenueSplitterImplementation)).toLowerCase() ===
      requiredBytes32(env, "REVENUE_SPLITTER_IMPLEMENTATION_CODE_HASH"),
    "RevenueSplitter implementation runtime code hash mismatch",
  );

  return {
    verified: true,
    verificationMode: liveTestState ? "base-sepolia-live-test-state" : "deployment-initial-state",
    marketplaceImplementation,
    revenueSplitterImplementation,
    timelockMinDelay: (await timelock.getMinDelay()).toString(),
    externalValidation: {
      ...externalValidation,
      chainId: externalValidation.chainId.toString(),
      paymentTokenDecimals: externalValidation.paymentTokenDecimals.toString(),
      adminMultisigThreshold: externalValidation.adminMultisigThreshold?.toString(),
    },
  };
}

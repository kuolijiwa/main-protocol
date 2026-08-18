import hre from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import {
  check,
  type Environment,
  requiredAddress,
  requiredInteger,
  validateExternalDeploymentInputs,
} from "./deployment-validation.js";

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

  const allowEoaAdmin = env.ALLOW_EOA_ADMIN === "true";
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

  check((await timelock.getMinDelay()) >= 48n * 60n * 60n, "Timelock delay is below 48 hours");
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
    if (!allowEoaAdmin) {
      check(
        !(await timelock.hasRole(role, deployerAddress)),
        "deployer retains a ProtocolTimelock role",
      );
    }
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
  check(
    (await contributors.getRoleMemberCount(contributorRole)) === 1n,
    "CONTRIBUTOR_ROLE must have exactly one initial member",
  );
  check(
    (await contributors.getRoleMember(contributorRole, 0n)) === nurtureContributor,
    "NURTURE_CONTRIBUTOR must be the sole initial CONTRIBUTOR_ROLE member",
  );
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

  return {
    verified: true,
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

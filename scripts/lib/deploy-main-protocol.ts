import hre from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import {
  check,
  type Environment,
  isSimulatedNetwork,
  requiredAddress,
  requiredInteger,
  validateExternalDeploymentInputs,
} from "./deployment-validation.js";

export interface AdminTransaction {
  to: string;
  data: string;
}

export async function deployMainProtocol(
  connection: NetworkConnection,
  env: Environment,
): Promise<Record<string, unknown>> {
  const paymentToken = requiredAddress(env, "PAYMENT_TOKEN");
  const adminMultisig = requiredAddress(env, "ADMIN_MULTISIG");
  const treasury = requiredAddress(env, "TREASURY");
  const gatewaySigner = requiredAddress(env, "GATEWAY_SIGNER");
  const nurtureContributor = requiredAddress(env, "NURTURE_CONTRIBUTOR");
  const pipelineOperator = requiredAddress(env, "PIPELINE_OPERATOR");
  const feeBps = requiredInteger(env, "FEE_BPS", 0n, 10_000n);
  const challengeWindow = requiredInteger(env, "CHALLENGE_WINDOW_SECONDS", 1n, 2n ** 64n - 1n);
  if (nurtureContributor === pipelineOperator) {
    throw new Error("NURTURE_CONTRIBUTOR and PIPELINE_OPERATOR must be distinct addresses");
  }

  const { ethers } = connection;
  const upgradesApi = await upgrades(hre, connection);
  const [deployer] = await ethers.getSigners();
  const deployerIsAdmin = deployer.address.toLowerCase() === adminMultisig.toLowerCase();
  const allowEoaAdmin =
    env.ALLOW_EOA_ADMIN === "true" &&
    (isSimulatedNetwork(connection) || env.ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST === "true");
  const externalValidation = await validateExternalDeploymentInputs(
    connection,
    env,
    paymentToken,
    adminMultisig,
    deployer.address,
  );

  const protocolTimelock = await ethers.deployContract("ProtocolTimelock", [adminMultisig]);
  await protocolTimelock.waitForDeployment();
  const governanceTimelock = await protocolTimelock.getAddress();

  const contributorRegistry = await ethers.deployContract("ContributorRegistry", [
    governanceTimelock,
    adminMultisig,
  ]);
  await contributorRegistry.waitForDeployment();

  const contributorRole = await contributorRegistry.CONTRIBUTOR_ROLE();
  const operatorRole = await contributorRegistry.OPERATOR_ROLE();
  const onboardingTransactions: AdminTransaction[] = deployerIsAdmin
    ? []
    : [
        {
          to: await contributorRegistry.getAddress(),
          data: contributorRegistry.interface.encodeFunctionData("grantRole", [
            contributorRole,
            nurtureContributor,
          ]),
        },
        {
          to: await contributorRegistry.getAddress(),
          data: contributorRegistry.interface.encodeFunctionData("grantRole", [
            operatorRole,
            pipelineOperator,
          ]),
        },
        {
          to: await contributorRegistry.getAddress(),
          data: contributorRegistry.interface.encodeFunctionData("setOperatorContributor", [
            pipelineOperator,
            nurtureContributor,
          ]),
        },
      ];

  if (deployerIsAdmin) {
    await (await contributorRegistry.grantRole(contributorRole, nurtureContributor)).wait();
    await (await contributorRegistry.grantRole(operatorRole, pipelineOperator)).wait();
    await (
      await contributorRegistry.setOperatorContributor(pipelineOperator, nurtureContributor)
    ).wait();
  }

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

  const revenueSplitter = await upgradesApi.deployProxy(
    await ethers.getContractFactory("RevenueSplitter"),
    [
      await protocolConfig.getAddress(),
      await datasetRegistry.getAddress(),
      governanceTimelock,
      adminMultisig,
    ],
    { kind: "uups" },
  );
  await revenueSplitter.waitForDeployment();

  const marketplace = await upgradesApi.deployProxy(
    await ethers.getContractFactory("Marketplace"),
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
  if (deployerIsAdmin) {
    await (await datasetRegistry.setMarketplaceOnce(marketplaceAddress)).wait();
    await (await entitlementNFT.setMarketplaceOnce(marketplaceAddress)).wait();
    await (await revenueSplitter.setMarketplaceOnce(marketplaceAddress)).wait();
  }

  const wiringTransactions: AdminTransaction[] = deployerIsAdmin
    ? []
    : [datasetRegistry, entitlementNFT, revenueSplitter].map((contract) => ({
        to: String(contract.target),
        data: contract.interface.encodeFunctionData("setMarketplaceOnce", [marketplaceAddress]),
      }));

  const timelockDelay = await protocolTimelock.getMinDelay();
  const proposerRole = await protocolTimelock.PROPOSER_ROLE();
  const executorRole = await protocolTimelock.EXECUTOR_ROLE();
  const cancellerRole = await protocolTimelock.CANCELLER_ROLE();
  const defaultAdminRole = await protocolTimelock.DEFAULT_ADMIN_ROLE();
  check(timelockDelay === 48n * 60n * 60n, "timelock delay is not 48 hours");
  check(
    await protocolTimelock.hasRole(proposerRole, adminMultisig),
    "ADMIN_MULTISIG lacks Timelock proposer role",
  );
  check(
    await protocolTimelock.hasRole(executorRole, adminMultisig),
    "ADMIN_MULTISIG lacks Timelock executor role",
  );
  check(
    await protocolTimelock.hasRole(cancellerRole, adminMultisig),
    "ADMIN_MULTISIG lacks Timelock canceller role",
  );
  check(
    await protocolTimelock.hasRole(defaultAdminRole, governanceTimelock),
    "Timelock is not self-administered",
  );
  check(
    !(await protocolTimelock.hasRole(defaultAdminRole, adminMultisig)),
    "ADMIN_MULTISIG holds Timelock DEFAULT_ADMIN_ROLE",
  );

  if (!allowEoaAdmin) {
    for (const role of [defaultAdminRole, proposerRole, executorRole, cancellerRole]) {
      check(
        !(await protocolTimelock.hasRole(role, deployer.address)),
        "deployer retains a ProtocolTimelock role",
      );
    }
  }

  const governedContracts = [
    contributorRegistry,
    protocolConfig,
    datasetRegistry,
    entitlementNFT,
    revenueSplitter,
    marketplace,
  ];
  for (const contract of governedContracts) {
    check(
      (await contract.governanceTimelock()) === governanceTimelock,
      `${contract.target} fixed governance timelock mismatch`,
    );
    check(
      await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), governanceTimelock),
      `${contract.target} is not governed by ProtocolTimelock`,
    );
    check(
      !(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), adminMultisig)),
      `${contract.target} leaves DEFAULT_ADMIN_ROLE on ADMIN_MULTISIG`,
    );
    if (!allowEoaAdmin) {
      check(
        !(await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), deployer.address)),
        `${contract.target} leaves DEFAULT_ADMIN_ROLE on deployer`,
      );
    }
  }

  for (const contract of [
    contributorRegistry,
    protocolConfig,
    datasetRegistry,
    entitlementNFT,
    revenueSplitter,
  ]) {
    check(
      await contract.hasRole(await contract.ADMIN_ROLE(), adminMultisig),
      `${contract.target} lacks the operational ADMIN multisig role`,
    );
    if (!allowEoaAdmin) {
      check(
        !(await contract.hasRole(await contract.ADMIN_ROLE(), deployer.address)),
        `${contract.target} leaves ADMIN_ROLE on deployer`,
      );
    }
  }
  if (!allowEoaAdmin) {
    check(
      !(await contributorRegistry.hasRole(operatorRole, deployer.address)),
      "ContributorRegistry leaves OPERATOR_ROLE on deployer",
    );
    check(
      !(await contributorRegistry.hasRole(contributorRole, deployer.address)),
      "ContributorRegistry leaves CONTRIBUTOR_ROLE on deployer",
    );
  }

  check((await protocolConfig.paymentToken()) === paymentToken, "payment token mismatch");
  check((await protocolConfig.feeBps()) === feeBps, "fee mismatch");
  check((await protocolConfig.treasury()) === treasury, "treasury mismatch");
  check((await protocolConfig.challengeWindow()) === challengeWindow, "challenge window mismatch");
  check((await protocolConfig.gatewaySigner()) === gatewaySigner, "gateway signer mismatch");
  check(!(await protocolConfig.paused()), "protocol unexpectedly paused");

  if (deployerIsAdmin) {
    check(
      await contributorRegistry.hasRole(contributorRole, nurtureContributor),
      "NURTURE_CONTRIBUTOR lacks CONTRIBUTOR_ROLE",
    );
    check(
      (await contributorRegistry.getRoleMemberCount(contributorRole)) === 1n,
      "CONTRIBUTOR_ROLE must have exactly one initial member",
    );
    check(
      (await contributorRegistry.getRoleMember(contributorRole, 0n)) === nurtureContributor,
      "NURTURE_CONTRIBUTOR must be the sole initial CONTRIBUTOR_ROLE member",
    );
    check(
      await contributorRegistry.hasRole(operatorRole, pipelineOperator),
      "PIPELINE_OPERATOR lacks OPERATOR_ROLE",
    );
    check(
      !(await contributorRegistry.hasRole(contributorRole, pipelineOperator)),
      "PIPELINE_OPERATOR must not hold CONTRIBUTOR_ROLE",
    );
    check(
      (await contributorRegistry.operatorContributor(pipelineOperator)) === nurtureContributor,
      "PIPELINE_OPERATOR is not assigned to NURTURE_CONTRIBUTOR",
    );
    check(
      (await datasetRegistry.marketplace()) === marketplaceAddress,
      "DatasetRegistry wiring mismatch",
    );
    check(
      (await entitlementNFT.marketplace()) === marketplaceAddress,
      "EntitlementNFT wiring mismatch",
    );
    check(
      (await revenueSplitter.marketplace()) === marketplaceAddress,
      "RevenueSplitter wiring mismatch",
    );
  }

  const revenueSplitterAddress = await revenueSplitter.getAddress();
  const marketplaceImplementation =
    await upgradesApi.erc1967.getImplementationAddress(marketplaceAddress);
  const revenueSplitterImplementation =
    await upgradesApi.erc1967.getImplementationAddress(revenueSplitterAddress);
  const verificationCodeHashes: Environment = {
    PROTOCOL_TIMELOCK_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(governanceTimelock),
    ),
    CONTRIBUTOR_REGISTRY_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(await contributorRegistry.getAddress()),
    ),
    PROTOCOL_CONFIG_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(await protocolConfig.getAddress()),
    ),
    DATASET_REGISTRY_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(await datasetRegistry.getAddress()),
    ),
    ENTITLEMENT_NFT_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(await entitlementNFT.getAddress()),
    ),
    REVENUE_SPLITTER_PROXY_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(revenueSplitterAddress),
    ),
    MARKETPLACE_PROXY_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(marketplaceAddress),
    ),
    MARKETPLACE_IMPLEMENTATION_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(marketplaceImplementation),
    ),
    REVENUE_SPLITTER_IMPLEMENTATION_CODE_HASH: ethers.keccak256(
      await ethers.provider.getCode(revenueSplitterImplementation),
    ),
  };

  return {
    protocolTimelock: governanceTimelock,
    contributorRegistry: await contributorRegistry.getAddress(),
    protocolConfig: await protocolConfig.getAddress(),
    datasetRegistry: await datasetRegistry.getAddress(),
    entitlementNFT: await entitlementNFT.getAddress(),
    revenueSplitter: revenueSplitterAddress,
    marketplace: marketplaceAddress,
    paymentToken,
    governanceTimelock,
    adminMultisig,
    treasury,
    gatewaySigner,
    nurtureContributor,
    pipelineOperator,
    deployer: deployer.address,
    feeBps: feeBps.toString(),
    challengeWindow: challengeWindow.toString(),
    wiringComplete: deployerIsAdmin,
    onboardingComplete: deployerIsAdmin,
    onboardingTransactions,
    wiringTransactions,
    adminTransactions: [...onboardingTransactions, ...wiringTransactions],
    timelockMinDelay: timelockDelay.toString(),
    marketplaceImplementation,
    revenueSplitterImplementation,
    verificationCodeHashes,
    externalValidation: {
      ...externalValidation,
      chainId: externalValidation.chainId.toString(),
      paymentTokenDecimals: externalValidation.paymentTokenDecimals.toString(),
      adminMultisigThreshold: externalValidation.adminMultisigThreshold?.toString(),
    },
  };
}

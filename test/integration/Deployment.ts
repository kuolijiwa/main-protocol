import { expect } from "chai";
import { type BaseContract, getAddress, id, keccak256, ZeroAddress, ZeroHash } from "ethers";
import { network } from "hardhat";
import {
  type AdminTransaction,
  deployMainProtocol,
} from "../../scripts/lib/deploy-main-protocol.js";
import type { Environment } from "../../scripts/lib/deployment-validation.js";
import { verifyMainProtocol } from "../../scripts/lib/verify-main-protocol.js";

const connection = await network.create();
const { ethers, networkHelpers } = connection;

function outputAddress(output: Record<string, unknown>, name: string): string {
  const value = output[name];
  expect(value, name).to.be.a("string");
  return value as string;
}

async function executeAdminTransactions(
  safe: BaseContract,
  transactions: AdminTransaction[],
): Promise<void> {
  for (const transaction of transactions) {
    await (await safe.getFunction("execute")(transaction.to, transaction.data)).wait();
  }
}

async function safeSecurityEnvironment(safeAddress: string): Promise<Environment> {
  const singletonWord = await ethers.provider.getStorage(safeAddress, 0n);
  const singleton = getAddress(`0x${singletonWord.slice(-40)}`);
  return {
    ADMIN_MULTISIG_SINGLETON: singleton,
    ADMIN_MULTISIG_SINGLETON_CODE_HASH: keccak256(await ethers.provider.getCode(singleton)),
    ADMIN_MULTISIG_GUARD: ZeroAddress,
    ADMIN_MULTISIG_FALLBACK_HANDLER: ZeroAddress,
  };
}

describe("Production deployment topology", function () {
  it("executes the shared deploy/verify logic for multisig and local-EOA modes", async function () {
    const [deployer, secondOwner, treasury, gateway, nurture, pipeline] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const safe = await ethers.deployContract("MockSafe", [
      [deployer.address, secondOwner.address],
      2,
    ]);
    const chainId = (await ethers.provider.getNetwork()).chainId.toString();
    const paymentToken = await token.getAddress();
    const adminMultisig = await safe.getAddress();
    const baseEnvironment: Environment = {
      EXPECTED_CHAIN_ID: chainId,
      PAYMENT_TOKEN: paymentToken,
      PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(paymentToken)),
      PAYMENT_TOKEN_DECIMALS: "18",
      ADMIN_MULTISIG: adminMultisig,
      ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(adminMultisig)),
      ADMIN_MULTISIG_OWNERS: `${deployer.address},${secondOwner.address}`,
      ADMIN_MULTISIG_THRESHOLD: "2",
      ...(await safeSecurityEnvironment(adminMultisig)),
      TREASURY: treasury.address,
      GATEWAY_SIGNER: gateway.address,
      NURTURE_CONTRIBUTOR: nurture.address,
      PIPELINE_OPERATOR: pipeline.address,
      FEE_BPS: "250",
      CHALLENGE_WINDOW_SECONDS: String(7 * 24 * 60 * 60),
    };

    const deployment = await deployMainProtocol(connection, baseEnvironment);
    const adminTransactions = deployment.adminTransactions as AdminTransaction[];
    expect(adminTransactions).to.have.length(6);
    await executeAdminTransactions(safe.connect(deployer), adminTransactions);

    const verificationEnvironment: Environment = {
      ...baseEnvironment,
      ...(deployment.verificationCodeHashes as Environment),
      PROTOCOL_TIMELOCK: outputAddress(deployment, "protocolTimelock"),
      CONTRIBUTOR_REGISTRY: outputAddress(deployment, "contributorRegistry"),
      PROTOCOL_CONFIG: outputAddress(deployment, "protocolConfig"),
      DATASET_REGISTRY: outputAddress(deployment, "datasetRegistry"),
      ENTITLEMENT_NFT: outputAddress(deployment, "entitlementNFT"),
      REVENUE_SPLITTER: outputAddress(deployment, "revenueSplitter"),
      MARKETPLACE: outputAddress(deployment, "marketplace"),
      MARKETPLACE_IMPLEMENTATION: outputAddress(deployment, "marketplaceImplementation"),
      REVENUE_SPLITTER_IMPLEMENTATION: outputAddress(deployment, "revenueSplitterImplementation"),
      DEPLOYER_ADDRESS: deployer.address,
    };
    const verification = await verifyMainProtocol(connection, verificationEnvironment);
    expect(verification.verified).to.equal(true);

    let runtimeCodeMismatch: unknown;
    try {
      await verifyMainProtocol(connection, {
        ...verificationEnvironment,
        PROTOCOL_TIMELOCK_CODE_HASH: ZeroHash,
      });
    } catch (error) {
      runtimeCodeMismatch = error;
    }
    expect(runtimeCodeMismatch).to.be.instanceOf(Error);
    expect((runtimeCodeMismatch as Error).message).to.contain(
      "protocolTimelock runtime code hash mismatch",
    );

    let implementationMismatch: unknown;
    try {
      await verifyMainProtocol(connection, {
        ...verificationEnvironment,
        MARKETPLACE_IMPLEMENTATION: verificationEnvironment.REVENUE_SPLITTER_IMPLEMENTATION,
      });
    } catch (error) {
      implementationMismatch = error;
    }
    expect(implementationMismatch).to.be.instanceOf(Error);
    expect((implementationMismatch as Error).message).to.contain(
      "Marketplace implementation address mismatch",
    );

    const contributorRegistry = await ethers.getContractAt(
      "ContributorRegistry",
      outputAddress(deployment, "contributorRegistry"),
    );
    await (
      await safe.connect(deployer).getFunction("execute")(
        await contributorRegistry.getAddress(),
        contributorRegistry.interface.encodeFunctionData("grantRole", [
          await contributorRegistry.CONTRIBUTOR_ROLE(),
          pipeline.address,
        ]),
      )
    ).wait();
    let extraInitialContributor: unknown;
    try {
      await verifyMainProtocol(connection, verificationEnvironment);
    } catch (error) {
      extraInitialContributor = error;
    }
    expect(extraInitialContributor).to.be.instanceOf(Error);
    expect((extraInitialContributor as Error).message).to.contain(
      "CONTRIBUTOR_ROLE must have exactly one initial member",
    );
    await (
      await safe.connect(deployer).getFunction("execute")(
        await contributorRegistry.getAddress(),
        contributorRegistry.interface.encodeFunctionData("revokeRole", [
          await contributorRegistry.CONTRIBUTOR_ROLE(),
          pipeline.address,
        ]),
      )
    ).wait();

    const protocolConfig = await ethers.getContractAt(
      "ProtocolConfig",
      outputAddress(deployment, "protocolConfig"),
    );
    const timelock = await ethers.getContractAt(
      "ProtocolTimelock",
      outputAddress(deployment, "protocolTimelock"),
    );
    const grantExtraAdmin = protocolConfig.interface.encodeFunctionData("grantRole", [
      await protocolConfig.ADMIN_ROLE(),
      pipeline.address,
    ]);
    const salt = id("deployment-verifier-extra-admin-test");
    const delay = await timelock.getMinDelay();
    const schedule = timelock.interface.encodeFunctionData("schedule", [
      await protocolConfig.getAddress(),
      0,
      grantExtraAdmin,
      ZeroHash,
      salt,
      delay,
    ]);
    await (
      await safe.connect(deployer).getFunction("execute")(await timelock.getAddress(), schedule)
    ).wait();
    await networkHelpers.time.increase(delay);
    const execute = timelock.interface.encodeFunctionData("execute", [
      await protocolConfig.getAddress(),
      0,
      grantExtraAdmin,
      ZeroHash,
      salt,
    ]);
    await (
      await safe.connect(deployer).getFunction("execute")(await timelock.getAddress(), execute)
    ).wait();
    let extraOperationalAdmin: unknown;
    try {
      await verifyMainProtocol(connection, verificationEnvironment);
    } catch (error) {
      extraOperationalAdmin = error;
    }
    expect(extraOperationalAdmin).to.be.instanceOf(Error);
    expect((extraOperationalAdmin as Error).message).to.contain("ADMIN_ROLE member set mismatch");

    const localEoaEnvironment: Environment = {
      ...baseEnvironment,
      ADMIN_MULTISIG: deployer.address,
      ADMIN_MULTISIG_CODE_HASH: undefined,
      ADMIN_MULTISIG_OWNERS: undefined,
      ADMIN_MULTISIG_THRESHOLD: undefined,
      ALLOW_EOA_ADMIN: "true",
    };
    const localDeployment = await deployMainProtocol(connection, localEoaEnvironment);
    expect(localDeployment.adminTransactions).to.deep.equal([]);
    const localVerification = await verifyMainProtocol(connection, {
      ...localEoaEnvironment,
      ...(localDeployment.verificationCodeHashes as Environment),
      PROTOCOL_TIMELOCK: outputAddress(localDeployment, "protocolTimelock"),
      CONTRIBUTOR_REGISTRY: outputAddress(localDeployment, "contributorRegistry"),
      PROTOCOL_CONFIG: outputAddress(localDeployment, "protocolConfig"),
      DATASET_REGISTRY: outputAddress(localDeployment, "datasetRegistry"),
      ENTITLEMENT_NFT: outputAddress(localDeployment, "entitlementNFT"),
      REVENUE_SPLITTER: outputAddress(localDeployment, "revenueSplitter"),
      MARKETPLACE: outputAddress(localDeployment, "marketplace"),
      MARKETPLACE_IMPLEMENTATION: outputAddress(localDeployment, "marketplaceImplementation"),
      REVENUE_SPLITTER_IMPLEMENTATION: outputAddress(
        localDeployment,
        "revenueSplitterImplementation",
      ),
      DEPLOYER_ADDRESS: deployer.address,
    });
    expect(localVerification.verified).to.equal(true);
  });
});

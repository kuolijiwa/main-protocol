import { expect } from "chai";
import {
  concat,
  Contract,
  ContractFactory,
  getAddress,
  getBytes,
  type InterfaceAbi,
  keccak256,
  Signature,
  toBeHex,
  ZeroAddress,
} from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";
import {
  type AdminTransaction,
  deployMainProtocol,
} from "../../scripts/lib/deploy-main-protocol.js";
import type { Environment } from "../../scripts/lib/deployment-validation.js";
import { verifyMainProtocol } from "../../scripts/lib/verify-main-protocol.js";

const connection = await network.create();
const { ethers } = connection;
type TestSigner = Awaited<ReturnType<typeof ethers.getSigners>>[number];

interface ExternalArtifact {
  abi: InterfaceAbi;
  bytecode: string;
}

async function safeArtifact(relativePath: string): Promise<ExternalArtifact> {
  return JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "node_modules/@safe-global/safe-smart-account/build/artifacts/contracts",
        relativePath,
      ),
      "utf8",
    ),
  ) as ExternalArtifact;
}

function outputAddress(output: Record<string, unknown>, name: string): string {
  const value = output[name];
  expect(value, name).to.be.a("string");
  return value as string;
}

async function deployOfficialSafe(owners: TestSigner[]): Promise<Contract> {
  const singletonArtifact = await safeArtifact("Safe.sol/Safe.json");
  const factoryArtifact = await safeArtifact("proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
  const singleton = await new ContractFactory(
    singletonArtifact.abi,
    singletonArtifact.bytecode,
    owners[0],
  ).deploy();
  const factory = await new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    owners[0],
  ).deploy();
  await Promise.all([singleton.waitForDeployment(), factory.waitForDeployment()]);

  const setup = singleton.interface.encodeFunctionData("setup", [
    owners.map((owner) => owner.address),
    owners.length,
    ZeroAddress,
    "0x",
    ZeroAddress,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);
  const singletonAddress = await singleton.getAddress();
  const proxyAddress = (await factory
    .getFunction("createProxyWithNonce")
    .staticCall(singletonAddress, setup, 0)) as string;
  await (await factory.getFunction("createProxyWithNonce")(singletonAddress, setup, 0)).wait();
  return new Contract(proxyAddress, singletonArtifact.abi, owners[0]);
}

async function signedSafeCall(
  safe: Contract,
  transaction: AdminTransaction,
  owners: TestSigner[],
): Promise<{ args: unknown[]; signatures: string }> {
  const nonce = (await safe.getFunction("nonce")()) as bigint;
  const args: unknown[] = [
    transaction.to,
    0,
    transaction.data,
    0,
    0,
    0,
    0,
    ZeroAddress,
    ZeroAddress,
  ];
  const transactionHash = (await safe
    .getFunction("getTransactionHash")
    .staticCall(...args, nonce)) as string;
  const signatures = await Promise.all(
    owners.map(async (owner) => {
      const signature = Signature.from(await owner.signMessage(getBytes(transactionHash)));
      return {
        owner: owner.address.toLowerCase(),
        encoded: concat([signature.r, signature.s, toBeHex(signature.v + 4, 1)]),
      };
    }),
  );
  signatures.sort((left, right) => left.owner.localeCompare(right.owner));
  return { args, signatures: concat(signatures.map(({ encoded }) => encoded)) };
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

describe("Official Safe deployment integration", function () {
  it("requires 2/2 signatures, prevents nonce replay, and executes all admin transactions", async function () {
    const [deployer, secondOwner, treasury, gateway, nurture, pipeline] = await ethers.getSigners();
    const owners = [deployer, secondOwner];
    const token = await ethers.deployContract("MockERC20");
    const safe = await deployOfficialSafe(owners);
    const paymentToken = await token.getAddress();
    const adminMultisig = await safe.getAddress();
    expect(await safe.getFunction("getOwners")()).to.have.members(
      owners.map((owner) => owner.address),
    );
    expect(await safe.getFunction("getThreshold")()).to.equal(2);

    const environment: Environment = {
      EXPECTED_CHAIN_ID: (await ethers.provider.getNetwork()).chainId.toString(),
      PAYMENT_TOKEN: paymentToken,
      PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(paymentToken)),
      PAYMENT_TOKEN_DECIMALS: "18",
      ADMIN_MULTISIG: adminMultisig,
      ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(adminMultisig)),
      ADMIN_MULTISIG_OWNERS: owners.map((owner) => owner.address).join(","),
      ADMIN_MULTISIG_THRESHOLD: "2",
      ...(await safeSecurityEnvironment(adminMultisig)),
      TREASURY: treasury.address,
      GATEWAY_SIGNER: gateway.address,
      NURTURE_CONTRIBUTOR: nurture.address,
      PIPELINE_OPERATOR: pipeline.address,
      FEE_BPS: "250",
      CHALLENGE_WINDOW_SECONDS: String(7 * 24 * 60 * 60),
    };
    const deployment = await deployMainProtocol(connection, environment);
    const transactions = deployment.adminTransactions as AdminTransaction[];
    expect(transactions).to.have.length(6);

    const oneSignature = await signedSafeCall(safe, transactions[0], [deployer]);
    await expect(
      safe.getFunction("execTransaction")(...oneSignature.args, oneSignature.signatures),
    ).to.be.revertedWith("GS020");
    expect(await safe.getFunction("nonce")()).to.equal(0);

    const firstCall = await signedSafeCall(safe, transactions[0], owners);
    await (
      await safe.getFunction("execTransaction")(...firstCall.args, firstCall.signatures)
    ).wait();
    expect(await safe.getFunction("nonce")()).to.equal(1);
    await expect(
      safe.getFunction("execTransaction")(...firstCall.args, firstCall.signatures),
    ).to.be.revertedWith("GS026");
    expect(await safe.getFunction("nonce")()).to.equal(1);

    for (const transaction of transactions.slice(1)) {
      const call = await signedSafeCall(safe, transaction, owners);
      await (await safe.getFunction("execTransaction")(...call.args, call.signatures)).wait();
    }
    expect(await safe.getFunction("nonce")()).to.equal(6);

    const verification = await verifyMainProtocol(connection, {
      ...environment,
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
    });
    expect(verification.verified).to.equal(true);
  });
});

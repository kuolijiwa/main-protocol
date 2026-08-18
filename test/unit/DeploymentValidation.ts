import { expect } from "chai";
import { getAddress, keccak256, ZeroAddress, ZeroHash } from "ethers";
import { network } from "hardhat";
import {
  type Environment,
  PERSISTENT_NETWORK_CHAIN_IDS,
  validateAdminMode,
  validateExternalDeploymentInputs,
  validateNetworkIdentity,
} from "../../scripts/lib/deployment-validation.js";

const connection = await network.create();
const { ethers } = connection;

async function expectFailure(operation: Promise<unknown>, message: string): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).to.be.instanceOf(Error);
  expect((failure as Error).message).to.contain(message);
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

describe("Deployment validation", function () {
  it("accepts each reviewed persistent network only at its canonical chain ID", function () {
    for (const [networkName, chainId] of Object.entries(PERSISTENT_NETWORK_CHAIN_IDS)) {
      expect(() =>
        validateNetworkIdentity(false, networkName, chainId, {
          EXPECTED_CHAIN_ID: chainId.toString(),
          EIP1153_CONFIRMED: "true",
        }),
      ).not.to.throw();
    }
  });

  it("rejects a persistent network name paired with a noncanonical chain ID", function () {
    expect(() =>
      validateNetworkIdentity(false, "baseSepolia", 1n, {
        EXPECTED_CHAIN_ID: "1",
        EIP1153_CONFIRMED: "true",
      }),
    ).to.throw("baseSepolia canonical chain ID mismatch: expected 84532, got 1");
  });

  it("rejects unreviewed persistent networks and missing EIP-1153 confirmation", function () {
    expect(() =>
      validateNetworkIdentity(false, "custom", 123n, {
        EXPECTED_CHAIN_ID: "123",
        EIP1153_CONFIRMED: "true",
      }),
    ).to.throw("persistent deployment must use a reviewed");
    expect(() =>
      validateNetworkIdentity(false, "baseSepolia", 84_532n, {
        EXPECTED_CHAIN_ID: "84532",
      }),
    ).to.throw("EIP1153_CONFIRMED=true is required");
  });

  it("permits a simulated network without persistent-network confirmation", function () {
    expect(() =>
      validateNetworkIdentity(true, "hardhat", 31_337n, { EXPECTED_CHAIN_ID: "31337" }),
    ).not.to.throw();
    expect(() =>
      validateNetworkIdentity(true, "hardhat", 31_337n, { EXPECTED_CHAIN_ID: "1" }),
    ).to.throw("chain ID mismatch");
  });

  it("allows the EOA-admin exception only locally and only for the deployer", function () {
    const deployer = "0x1111111111111111111111111111111111111111";
    const other = "0x2222222222222222222222222222222222222222";
    expect(() =>
      validateAdminMode(true, "hardhat", { ALLOW_EOA_ADMIN: "true" }, deployer, deployer),
    ).not.to.throw();
    expect(() =>
      validateAdminMode(false, "baseSepolia", { ALLOW_EOA_ADMIN: "true" }, deployer, deployer),
    ).to.throw("explicit Base Sepolia test override");
    expect(() =>
      validateAdminMode(true, "hardhat", { ALLOW_EOA_ADMIN: "true" }, other, deployer),
    ).to.throw("requires ADMIN_MULTISIG to equal the local deployer");
    expect(() =>
      validateAdminMode(
        false,
        "baseSepolia",
        {
          ALLOW_EOA_ADMIN: "true",
          ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST: "true",
        },
        deployer,
        deployer,
      ),
    ).not.to.throw();
  });

  it("rejects payment-token code-hash and decimals mismatches", async function () {
    const [deployer, secondOwner, thirdOwner] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const safe = await ethers.deployContract("MockSafe", [
      [deployer.address, secondOwner.address, thirdOwner.address],
      3,
    ]);
    const tokenAddress = await token.getAddress();
    const safeAddress = await safe.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId.toString();
    const env: Environment = {
      EXPECTED_CHAIN_ID: chainId,
      PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(tokenAddress)),
      PAYMENT_TOKEN_DECIMALS: "18",
      ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(safeAddress)),
      ADMIN_MULTISIG_OWNERS: `${deployer.address},${secondOwner.address},${thirdOwner.address}`,
      ADMIN_MULTISIG_THRESHOLD: "3",
      ...(await safeSecurityEnvironment(safeAddress)),
    };

    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, PAYMENT_TOKEN_CODE_HASH: ZeroHash },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "PAYMENT_TOKEN runtime code hash mismatch",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, PAYMENT_TOKEN_DECIMALS: "6" },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "PAYMENT_TOKEN decimals mismatch",
    );
  });

  it("rejects Safe code-hash, owner-set, and threshold mismatches", async function () {
    const [deployer, secondOwner, thirdOwner, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const safe = await ethers.deployContract("MockSafe", [
      [deployer.address, secondOwner.address, thirdOwner.address],
      3,
    ]);
    const tokenAddress = await token.getAddress();
    const safeAddress = await safe.getAddress();
    const env: Environment = {
      EXPECTED_CHAIN_ID: (await ethers.provider.getNetwork()).chainId.toString(),
      PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(tokenAddress)),
      PAYMENT_TOKEN_DECIMALS: "18",
      ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(safeAddress)),
      ADMIN_MULTISIG_OWNERS: `${deployer.address},${secondOwner.address},${thirdOwner.address}`,
      ADMIN_MULTISIG_THRESHOLD: "3",
      ...(await safeSecurityEnvironment(safeAddress)),
    };

    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, ADMIN_MULTISIG_CODE_HASH: ZeroHash },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG runtime code hash mismatch",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        {
          ...env,
          ADMIN_MULTISIG_OWNERS: `${deployer.address},${secondOwner.address},${outsider.address}`,
        },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG owner set mismatch",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, ADMIN_MULTISIG_THRESHOLD: "2" },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG threshold mismatch",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, ADMIN_MULTISIG_SINGLETON: outsider.address },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG singleton mismatch",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...env, ADMIN_MULTISIG_GUARD: outsider.address },
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG guard mismatch",
    );

    await (await safe.setTestModule(outsider.address)).wait();
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        env,
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG must not have enabled modules",
    );
    await (await safe.setTestModule(ZeroAddress)).wait();
    await (await safe.setTestGuard(outsider.address)).wait();
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        env,
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG guard mismatch",
    );
    await (await safe.setTestGuard(ZeroAddress)).wait();
    await (await safe.setTestFallbackHandler(outsider.address)).wait();
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        env,
        tokenAddress,
        safeAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG fallback handler mismatch",
    );
  });

  it("rejects dependencies with no code or incompatible read interfaces", async function () {
    const [deployer, secondOwner, thirdOwner, noCode] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const safe = await ethers.deployContract("MockSafe", [
      [deployer.address, secondOwner.address, thirdOwner.address],
      3,
    ]);
    const tokenAddress = await token.getAddress();
    const safeAddress = await safe.getAddress();
    const base: Environment = {
      EXPECTED_CHAIN_ID: (await ethers.provider.getNetwork()).chainId.toString(),
      PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(tokenAddress)),
      PAYMENT_TOKEN_DECIMALS: "18",
      ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(safeAddress)),
      ADMIN_MULTISIG_OWNERS: `${deployer.address},${secondOwner.address},${thirdOwner.address}`,
      ADMIN_MULTISIG_THRESHOLD: "3",
      ...(await safeSecurityEnvironment(safeAddress)),
    };

    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...base, PAYMENT_TOKEN_CODE_HASH: ZeroHash },
        noCode.address,
        safeAddress,
        deployer.address,
      ),
      "PAYMENT_TOKEN has no deployed code",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        {
          ...base,
          PAYMENT_TOKEN_CODE_HASH: keccak256(await ethers.provider.getCode(safeAddress)),
        },
        safeAddress,
        safeAddress,
        deployer.address,
      ),
      "PAYMENT_TOKEN does not expose the required ERC-20 read interface",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        { ...base, ADMIN_MULTISIG_CODE_HASH: ZeroHash },
        tokenAddress,
        noCode.address,
        deployer.address,
      ),
      "ADMIN_MULTISIG has no deployed code",
    );
    await expectFailure(
      validateExternalDeploymentInputs(
        connection,
        {
          ...base,
          ADMIN_MULTISIG_CODE_HASH: keccak256(await ethers.provider.getCode(tokenAddress)),
        },
        tokenAddress,
        tokenAddress,
        deployer.address,
      ),
      "ADMIN_MULTISIG is not compatible with the required Safe read interface",
    );
  });
});

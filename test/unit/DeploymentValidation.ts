import { expect } from "chai";
import { keccak256, ZeroHash } from "ethers";
import { network } from "hardhat";
import {
  type Environment,
  PERSISTENT_NETWORK_CHAIN_IDS,
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
  });
});

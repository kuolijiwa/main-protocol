import {
  Contract,
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  ZeroAddress,
} from "ethers";
import type { NetworkConnection } from "hardhat/types/network";

export type Environment = Record<string, string | undefined>;

export const PERSISTENT_NETWORK_CHAIN_IDS = {
  baseSepolia: 84_532n,
  base: 8_453n,
  arbitrum: 42_161n,
  optimism: 10n,
} as const;

export function requiredAddress(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || !isAddress(value) || value === ZeroAddress) {
    throw new Error(`${name} must be a nonzero EVM address`);
  }
  return getAddress(value);
}

export function requiredAddressIncludingZero(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || !isAddress(value)) {
    throw new Error(`${name} must be an EVM address`);
  }
  return getAddress(value);
}

export function requiredInteger(env: Environment, name: string, min: bigint, max?: bigint): bigint {
  const raw = env[name];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = BigInt(raw);
  if (value < min || (max !== undefined && value > max)) {
    throw new Error(`${name} is outside the permitted range`);
  }
  return value;
}

export function requiredBytes32(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || !isHexString(value, 32)) {
    throw new Error(`${name} must be a 32-byte hex value`);
  }
  return value.toLowerCase();
}

export function requiredAddressList(env: Environment, name: string): string[] {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} must be a comma-separated address list`);
  }
  const addresses = raw.split(",").map((value) => {
    const address = value.trim();
    if (!isAddress(address) || address === ZeroAddress) {
      throw new Error(`${name} contains an invalid address`);
    }
    return getAddress(address);
  });
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error(`${name} contains a duplicate address`);
  }
  return addresses;
}

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`deployment verification failed: ${message}`);
}

export function isSimulatedNetwork(connection: NetworkConnection): boolean {
  return connection.networkConfig.type === "edr-simulated";
}

export function validateAdminMode(
  simulated: boolean,
  networkName: string,
  env: Environment,
  adminMultisig: string,
  deployerAddress: string,
): void {
  const allowEoaAdmin = env.ALLOW_EOA_ADMIN === "true";
  const allowBaseSepoliaTestEoa = env.ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST === "true";
  const persistentTestOverride =
    !simulated && networkName === "baseSepolia" && allowBaseSepoliaTestEoa;
  if (allowBaseSepoliaTestEoa && !allowEoaAdmin) {
    throw new Error("ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST=true requires ALLOW_EOA_ADMIN=true");
  }
  if (allowEoaAdmin && !simulated && !persistentTestOverride) {
    throw new Error(
      "ALLOW_EOA_ADMIN=true is permitted only on a local simulated network unless the explicit Base Sepolia test override is enabled",
    );
  }
  if (allowEoaAdmin && getAddress(deployerAddress) !== getAddress(adminMultisig)) {
    throw new Error("ALLOW_EOA_ADMIN=true requires ADMIN_MULTISIG to equal the local deployer");
  }
}

export function validateNetworkIdentity(
  simulated: boolean,
  networkName: string,
  chainId: bigint,
  env: Environment,
): void {
  const expectedChainId = requiredInteger(env, "EXPECTED_CHAIN_ID", 1n);
  check(
    chainId === expectedChainId,
    `chain ID mismatch: expected ${expectedChainId}, got ${chainId}`,
  );

  if (simulated) return;

  const canonicalChainId: bigint | undefined =
    PERSISTENT_NETWORK_CHAIN_IDS[networkName as keyof typeof PERSISTENT_NETWORK_CHAIN_IDS];
  check(
    canonicalChainId !== undefined,
    "persistent deployment must use a reviewed Base Sepolia, Base, Arbitrum, or Optimism network config",
  );
  check(
    chainId === canonicalChainId,
    `${networkName} canonical chain ID mismatch: expected ${canonicalChainId}, got ${chainId}`,
  );
  check(
    env.EIP1153_CONFIRMED === "true",
    "EIP1153_CONFIRMED=true is required after confirming transient-storage support",
  );
}

export function sameAddressSet(actual: string[], expected: string[]): boolean {
  const normalize = (values: string[]) =>
    values.map((value) => getAddress(value).toLowerCase()).sort();
  const normalizedActual = normalize(actual);
  const normalizedExpected = normalize(expected);
  return (
    normalizedActual.length === normalizedExpected.length &&
    normalizedActual.every((value, index) => value === normalizedExpected[index])
  );
}

export interface ExternalValidationResult {
  chainId: bigint;
  paymentTokenCodeHash: string;
  paymentTokenDecimals: bigint;
  adminMultisigCodeHash?: string;
  adminMultisigOwners?: string[];
  adminMultisigThreshold?: bigint;
  adminMultisigSingleton?: string;
  adminMultisigGuard?: string;
  adminMultisigFallbackHandler?: string;
}

const SAFE_SENTINEL_MODULES = "0x0000000000000000000000000000000000000001";
const SAFE_GUARD_STORAGE_SLOT = keccak256(toUtf8Bytes("guard_manager.guard.address"));
const SAFE_FALLBACK_HANDLER_STORAGE_SLOT = keccak256(
  toUtf8Bytes("fallback_manager.handler.address"),
);

function addressFromStorageWord(word: string): string {
  if (!isHexString(word, 32)) throw new Error("invalid EVM storage word");
  return getAddress(`0x${word.slice(-40)}`);
}

export async function validateExternalDeploymentInputs(
  connection: NetworkConnection,
  env: Environment,
  paymentToken: string,
  adminMultisig: string,
  deployerAddress: string,
): Promise<ExternalValidationResult> {
  const { ethers } = connection;
  const allowEoaAdmin = env.ALLOW_EOA_ADMIN === "true";
  const simulated = isSimulatedNetwork(connection);
  const allowBaseSepoliaTestEoa = env.ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST === "true";
  const eoaAdminMode = allowEoaAdmin && (simulated || allowBaseSepoliaTestEoa);
  validateAdminMode(simulated, connection.networkName, env, adminMultisig, deployerAddress);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  validateNetworkIdentity(isSimulatedNetwork(connection), connection.networkName, chainId, env);

  const paymentCode = await ethers.provider.getCode(paymentToken);
  check(paymentCode !== "0x", "PAYMENT_TOKEN has no deployed code");
  const paymentTokenCodeHash = keccak256(paymentCode).toLowerCase();
  check(
    paymentTokenCodeHash === requiredBytes32(env, "PAYMENT_TOKEN_CODE_HASH"),
    "PAYMENT_TOKEN runtime code hash mismatch",
  );

  const paymentTokenContract = new Contract(
    paymentToken,
    [
      "function totalSupply() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ],
    ethers.provider,
  );
  let paymentTokenDecimals: bigint;
  try {
    const [, , , decimals] = await Promise.all([
      paymentTokenContract.totalSupply(),
      paymentTokenContract.balanceOf(deployerAddress),
      paymentTokenContract.allowance(deployerAddress, adminMultisig),
      paymentTokenContract.decimals(),
    ]);
    paymentTokenDecimals = BigInt(decimals);
  } catch {
    throw new Error("PAYMENT_TOKEN does not expose the required ERC-20 read interface");
  }
  const expectedDecimals = requiredInteger(env, "PAYMENT_TOKEN_DECIMALS", 0n, 255n);
  check(paymentTokenDecimals === expectedDecimals, "PAYMENT_TOKEN decimals mismatch");

  if (eoaAdminMode) {
    return { chainId, paymentTokenCodeHash, paymentTokenDecimals };
  }

  const adminCode = await ethers.provider.getCode(adminMultisig);
  check(adminCode !== "0x", "ADMIN_MULTISIG has no deployed code");
  const adminMultisigCodeHash = keccak256(adminCode).toLowerCase();
  check(
    adminMultisigCodeHash === requiredBytes32(env, "ADMIN_MULTISIG_CODE_HASH"),
    "ADMIN_MULTISIG runtime code hash mismatch",
  );

  const expectedOwners = requiredAddressList(env, "ADMIN_MULTISIG_OWNERS");
  const expectedThreshold = requiredInteger(
    env,
    "ADMIN_MULTISIG_THRESHOLD",
    2n,
    BigInt(expectedOwners.length),
  );
  const multisigContract = new Contract(
    adminMultisig,
    [
      "function getOwners() view returns (address[])",
      "function getThreshold() view returns (uint256)",
      "function getModulesPaginated(address,uint256) view returns (address[],address)",
    ],
    ethers.provider,
  );
  let adminMultisigOwners: string[];
  let adminMultisigThreshold: bigint;
  try {
    const [owners, threshold] = await Promise.all([
      multisigContract.getOwners() as Promise<string[]>,
      multisigContract.getThreshold() as Promise<bigint>,
    ]);
    adminMultisigOwners = owners.map(getAddress);
    adminMultisigThreshold = BigInt(threshold);
  } catch {
    throw new Error("ADMIN_MULTISIG is not compatible with the required Safe read interface");
  }
  check(sameAddressSet(adminMultisigOwners, expectedOwners), "ADMIN_MULTISIG owner set mismatch");
  check(adminMultisigThreshold === expectedThreshold, "ADMIN_MULTISIG threshold mismatch");

  const adminMultisigSingleton = addressFromStorageWord(
    await ethers.provider.getStorage(adminMultisig, 0n),
  );
  const expectedSingleton = requiredAddress(env, "ADMIN_MULTISIG_SINGLETON");
  check(adminMultisigSingleton === expectedSingleton, "ADMIN_MULTISIG singleton mismatch");
  const singletonCode = await ethers.provider.getCode(adminMultisigSingleton);
  check(singletonCode !== "0x", "ADMIN_MULTISIG singleton has no deployed code");
  check(
    keccak256(singletonCode).toLowerCase() ===
      requiredBytes32(env, "ADMIN_MULTISIG_SINGLETON_CODE_HASH"),
    "ADMIN_MULTISIG singleton runtime code hash mismatch",
  );

  let modules: string[];
  let nextModule: string;
  try {
    [modules, nextModule] = (await multisigContract.getModulesPaginated(
      SAFE_SENTINEL_MODULES,
      100n,
    )) as [string[], string];
  } catch {
    throw new Error("ADMIN_MULTISIG does not expose the required Safe module interface");
  }
  check(
    modules.length === 0 && getAddress(nextModule) === SAFE_SENTINEL_MODULES,
    "ADMIN_MULTISIG must not have enabled modules",
  );

  const adminMultisigGuard = addressFromStorageWord(
    await ethers.provider.getStorage(adminMultisig, SAFE_GUARD_STORAGE_SLOT),
  );
  const adminMultisigFallbackHandler = addressFromStorageWord(
    await ethers.provider.getStorage(adminMultisig, SAFE_FALLBACK_HANDLER_STORAGE_SLOT),
  );
  check(
    adminMultisigGuard === requiredAddressIncludingZero(env, "ADMIN_MULTISIG_GUARD"),
    "ADMIN_MULTISIG guard mismatch",
  );
  check(
    adminMultisigFallbackHandler ===
      requiredAddressIncludingZero(env, "ADMIN_MULTISIG_FALLBACK_HANDLER"),
    "ADMIN_MULTISIG fallback handler mismatch",
  );

  return {
    chainId,
    paymentTokenCodeHash,
    paymentTokenDecimals,
    adminMultisigCodeHash,
    adminMultisigOwners,
    adminMultisigThreshold,
    adminMultisigSingleton,
    adminMultisigGuard,
    adminMultisigFallbackHandler,
  };
}

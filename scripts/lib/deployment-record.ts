import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NetworkConnection } from "hardhat/types/network";
import type { Environment } from "./deployment-validation.js";

const DEPLOYMENT_RECORD_ENV_KEYS = [
  "EXPECTED_CHAIN_ID",
  "EIP1153_CONFIRMED",
  "PAYMENT_TOKEN",
  "PAYMENT_TOKEN_CODE_HASH",
  "PAYMENT_TOKEN_DECIMALS",
  "ADMIN_MULTISIG",
  "ADMIN_MULTISIG_CODE_HASH",
  "ADMIN_MULTISIG_OWNERS",
  "ADMIN_MULTISIG_THRESHOLD",
  "ADMIN_MULTISIG_SINGLETON",
  "ADMIN_MULTISIG_SINGLETON_CODE_HASH",
  "ADMIN_MULTISIG_GUARD",
  "ADMIN_MULTISIG_FALLBACK_HANDLER",
  "TREASURY",
  "GATEWAY_SIGNER",
  "NURTURE_CONTRIBUTOR",
  "PIPELINE_OPERATOR",
  "FEE_BPS",
  "CHALLENGE_WINDOW_SECONDS",
  "TIMELOCK_DELAY_SECONDS",
  "ALLOW_EOA_ADMIN",
  "ALLOW_EOA_ADMIN_ON_BASE_SEPOLIA_TEST",
  "DEPLOYER_ADDRESS",
] as const;

function publicDeploymentConfiguration(env: Environment): Record<string, string | null> {
  return Object.fromEntries(DEPLOYMENT_RECORD_ENV_KEYS.map((key) => [key, env[key] ?? null]));
}

export interface DeploymentRecordLocation {
  historical: string;
  latest: string;
}

export async function writeDeploymentRecord(
  connection: NetworkConnection,
  deployment: Record<string, unknown>,
  env: Environment,
): Promise<DeploymentRecordLocation> {
  const networkName = connection.networkName.replace(/[^a-zA-Z0-9_-]/gu, "_");
  const chainId = (await connection.ethers.provider.getNetwork()).chainId;
  const blockNumber = await connection.ethers.provider.getBlockNumber();
  const block = await connection.ethers.provider.getBlock(blockNumber);
  const recordedAt = new Date().toISOString();
  const deploymentId = `${networkName}-${recordedAt.replace(/[^0-9]/gu, "")}-${blockNumber}`;
  const record = {
    schemaVersion: "main-protocol-deployment-v1",
    deploymentId,
    recordedAt,
    networkName,
    chainId: chainId.toString(),
    blockNumber,
    blockHash: block?.hash ?? null,
    blockTimestamp: block?.timestamp ?? null,
    configuration: publicDeploymentConfiguration(env),
    deployment,
  };

  const directory = path.resolve(process.cwd(), "deployments", networkName);
  await mkdir(directory, { recursive: true });
  const historical = path.join(directory, `${deploymentId}.json`);
  const latest = path.join(directory, "latest.json");
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(historical, contents, { encoding: "utf8", flag: "wx" });
  await writeFile(latest, contents, "utf8");

  return { historical, latest };
}

export { publicDeploymentConfiguration };

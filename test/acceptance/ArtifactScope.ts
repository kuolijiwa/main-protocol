import { expect } from "chai";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

type AbiEntry = { type: string; name?: string };

async function functionNames(contractName: string): Promise<Set<string>> {
  const artifactPath = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    abi: AbiEntry[];
  };
  return new Set(
    artifact.abi
      .filter((entry) => entry.type === "function" && entry.name !== undefined)
      .map((entry) => entry.name as string),
  );
}

async function scriptBundle(...relativePaths: string[]): Promise<string> {
  return (
    await Promise.all(
      relativePaths.map((relativePath) =>
        readFile(path.join(process.cwd(), "scripts", relativePath), "utf8"),
      ),
    )
  ).join("\n");
}

describe("V1 artifact and deployment scope", function () {
  const deferred = ["listExclusiveAuction", "bid", "settle", "createAuction"];

  it("contains no deferred auction entrypoints", async function () {
    for (const contractName of [
      "ContributorRegistry",
      "ProtocolConfig",
      "DatasetRegistry",
      "EntitlementNFT",
      "RevenueSplitter",
      "Marketplace",
    ]) {
      const names = await functionNames(contractName);
      for (const deferredName of deferred) {
        expect(names.has(deferredName), `${contractName}.${deferredName}`).to.equal(false);
      }
    }

    const deploymentSource = await scriptBundle(
      "deploy.ts",
      "lib/deploy-main-protocol.ts",
      "lib/deployment-validation.ts",
    );
    for (const forbiddenName of ["AuctionHouse", "IAuctionHouse"]) {
      expect(deploymentSource.includes(forbiddenName)).to.equal(false);
    }

    for (const root of ["contracts", path.join("artifacts", "contracts")]) {
      const entries = await readdir(path.join(process.cwd(), root), { recursive: true });
      for (const forbiddenName of ["AuctionHouse", "IAuctionHouse"]) {
        expect(entries.some((entry) => entry.includes(forbiddenName))).to.equal(false);
      }
    }
  });

  it("keeps only Marketplace and RevenueSplitter upgradeable", async function () {
    for (const contractName of [
      "ContributorRegistry",
      "ProtocolConfig",
      "DatasetRegistry",
      "EntitlementNFT",
      "ProtocolTimelock",
    ]) {
      const names = await functionNames(contractName);
      for (const proxyFunction of ["initialize", "proxiableUUID", "upgradeToAndCall"]) {
        expect(names.has(proxyFunction), `${contractName}.${proxyFunction}`).to.equal(false);
      }
    }

    for (const contractName of ["Marketplace", "RevenueSplitter"]) {
      const names = await functionNames(contractName);
      expect(names.has("initialize")).to.equal(true);
      expect(names.has("proxiableUUID")).to.equal(true);
      expect(names.has("upgradeToAndCall")).to.equal(true);
    }
  });

  it("requires post-deployment checks for every deployer privilege", async function () {
    const verificationSource = await scriptBundle(
      "verify-deployment.ts",
      "lib/verify-main-protocol.ts",
      "lib/deployment-validation.ts",
    );
    for (const requiredCheck of [
      "DEPLOYER_ADDRESS",
      "DEFAULT_ADMIN_ROLE on deployer",
      "ADMIN_ROLE on deployer",
      "OPERATOR_ROLE on deployer",
      "CONTRIBUTOR_ROLE on deployer",
      "deployer retains a ProtocolTimelock role",
      "DEFAULT_ADMIN_ROLE on ADMIN_MULTISIG",
      "ADMIN_MULTISIG holds Timelock DEFAULT_ADMIN_ROLE",
      "fixed governance timelock mismatch",
      "NURTURE_CONTRIBUTOR lacks CONTRIBUTOR_ROLE",
      "PIPELINE_OPERATOR lacks OPERATOR_ROLE",
      "PIPELINE_OPERATOR is not assigned to NURTURE_CONTRIBUTOR",
    ]) {
      expect(verificationSource.includes(requiredCheck), requiredCheck).to.equal(true);
    }

    const deploymentSource = await scriptBundle(
      "deploy.ts",
      "lib/deploy-main-protocol.ts",
      "lib/deployment-validation.ts",
    );
    for (const requiredCheck of [
      "DEFAULT_ADMIN_ROLE on ADMIN_MULTISIG",
      "ADMIN_MULTISIG holds Timelock DEFAULT_ADMIN_ROLE",
      "fixed governance timelock mismatch",
      "NURTURE_CONTRIBUTOR lacks CONTRIBUTOR_ROLE",
      "PIPELINE_OPERATOR lacks OPERATOR_ROLE",
      "PIPELINE_OPERATOR is not assigned to NURTURE_CONTRIBUTOR",
    ]) {
      expect(deploymentSource.includes(requiredCheck), requiredCheck).to.equal(true);
    }
    expect(deploymentSource.includes("allowEoaAdmin && !isSimulatedNetwork(connection)")).to.equal(
      true,
    );
    expect(verificationSource.includes("getMinDelay()) >= 48n * 60n * 60n")).to.equal(true);
    for (const productionGuard of [
      "EXPECTED_CHAIN_ID",
      "EIP1153_CONFIRMED",
      "PAYMENT_TOKEN_CODE_HASH",
      "PAYMENT_TOKEN_DECIMALS",
      "ADMIN_MULTISIG_CODE_HASH",
      "ADMIN_MULTISIG_OWNERS",
      "ADMIN_MULTISIG_THRESHOLD",
    ]) {
      expect(deploymentSource.includes(productionGuard), productionGuard).to.equal(true);
      expect(verificationSource.includes(productionGuard), productionGuard).to.equal(true);
    }
    for (const implementationPin of [
      "MARKETPLACE_IMPLEMENTATION",
      "REVENUE_SPLITTER_IMPLEMENTATION",
      "implementation address mismatch",
    ]) {
      expect(verificationSource.includes(implementationPin), implementationPin).to.equal(true);
    }
  });
});

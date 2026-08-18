import { expect } from "chai";
import { readFile } from "node:fs/promises";
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

    const deploymentSource = await readFile(
      path.join(process.cwd(), "scripts", "deploy.ts"),
      "utf8",
    );
    for (const forbiddenName of ["AuctionHouse", "IAuctionHouse"]) {
      expect(deploymentSource.includes(forbiddenName)).to.equal(false);
    }
  });

  it("keeps only Marketplace and RevenueSplitter upgradeable", async function () {
    for (const contractName of [
      "ContributorRegistry",
      "ProtocolConfig",
      "DatasetRegistry",
      "EntitlementNFT",
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
});

import test from "node:test";
import assert from "node:assert/strict";
import { resolveContractBinding } from "../src/contracts.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(root, "web/config/base-sepolia.json"), "utf8"));

test("runtime config is public-only, testnet-bound, and release guarded", () => {
  assert.equal(config.network.chainId, 84532);
  assert.equal(config.release.testOnly, true);
  assert.equal(config.release.status, "current-verified");
  assert.equal(config.release.writeEnabled, true);
  assert.match(config.network.rpcUrl, /^https:\/\//);
  const raw = fs.readFileSync(path.join(root, "web/config/base-sepolia.json"), "utf8");
  assert.doesNotMatch(raw, /private[_-]?key|secret|mnemonic|DEPLOYER_PRIVATE_KEY/i);
});

test("runtime config contains every business contract address", () => {
  for (const key of [
    "protocolTimelock",
    "contributorRegistry",
    "protocolConfig",
    "datasetRegistry",
    "entitlementNFT",
    "revenueSplitterProxy",
    "marketplaceProxy",
    "paymentToken",
  ]) {
    assert.match(config.addresses[key], /^0x[0-9a-fA-F]{40}$/);
  }
});

test("contract bindings resolve proxy addresses to implementation ABI keys", () => {
  const addresses = {
    marketplaceProxy: "0xmarketplace",
    revenueSplitterProxy: "0xsplitter",
    protocolConfig: "0xconfig",
  };
  const abis = {
    marketplace: ["marketplace ABI"],
    revenueSplitter: ["splitter ABI"],
    protocolConfig: ["config ABI"],
  };
  assert.deepEqual(resolveContractBinding("marketplace", addresses, abis), {
    addressKey: "marketplaceProxy",
    abiKey: "marketplace",
    address: "0xmarketplace",
    abi: ["marketplace ABI"],
  });
  assert.deepEqual(resolveContractBinding("revenueSplitterProxy", addresses, abis), {
    addressKey: "revenueSplitterProxy",
    abiKey: "revenueSplitter",
    address: "0xsplitter",
    abi: ["splitter ABI"],
  });
  assert.deepEqual(resolveContractBinding("protocolConfig", addresses, abis), {
    addressKey: "protocolConfig",
    abiKey: "protocolConfig",
    address: "0xconfig",
    abi: ["config ABI"],
  });
});

test("role pages expose Treasury while keeping Safe-backed Admin semantics", () => {
  const index = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
  assert.match(index, /data-nav="treasury"/);
  assert.match(index, /data-capability="treasury"/);
  assert.match(app, /data-form="treasury"/);
  assert.match(app, /withdrawTreasury\(\)/);
  assert.match(app, /Safe 2\/2/);
  assert.match(app, /getTransactionHash/);
  assert.match(app, /execTransaction/);
  assert.doesNotMatch(app, /当前测试部署 authority 是 EOA/);
});

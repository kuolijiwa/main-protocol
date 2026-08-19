import test from "node:test";
import assert from "node:assert/strict";
import { validateWeightsManifest } from "../src/manifest.mjs";

const base = {
  schema: "main-protocol.weights-manifest.v1",
  datasetId: "1",
  chainId: "84532",
  datasetRegistry: "0x205f4951190C14c1e314C9Fe38855e836c636869",
  weightsRoot: `0x${"11".repeat(32)}`,
  totalWeight: "100",
  leafEncoding: "keccak256(abi.encode(address,uint256))",
  pairHashing: "sorted-keccak256;promote-unpaired",
  entries: [
    { address: "0x0000000000000000000000000000000000000001", weight: "60", proof: [] },
    { address: "0x0000000000000000000000000000000000000002", weight: "40", proof: [] },
  ],
  pipeline: {
    version: "pipeline-v1",
    generatedAt: "2026-08-19T00:00:00.000Z",
    contentDigest: `0x${"22".repeat(32)}`,
  },
};

test("accepts a correctly bound manifest", () => {
  assert.equal(validateWeightsManifest(base, base).ok, true);
});

test("rejects duplicate addresses and incorrect sums", () => {
  const invalid = { ...base, entries: [base.entries[0], { ...base.entries[0], weight: "50" }] };
  const result = validateWeightsManifest(invalid, base);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /地址重复/);
  assert.match(result.errors.join(" "), /严格等于/);
});

test("rejects wrong chain, registry and root bindings", () => {
  const result = validateWeightsManifest(
    {
      ...base,
      chainId: "1",
      datasetRegistry: "0x0000000000000000000000000000000000000003",
      weightsRoot: `0x${"22".repeat(32)}`,
    },
    { ...base, registry: base.datasetRegistry },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => /不匹配/.test(error)).length, 3);
});

test("rejects an individual weight larger than totalWeight", () => {
  const result = validateWeightsManifest(
    { ...base, entries: [{ ...base.entries[0], weight: "101" }] },
    base,
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /不能大于 totalWeight/);
});

test("rejects the legacy schemaVersion field used by no production manifest", () => {
  const result = validateWeightsManifest(
    { ...base, schema: undefined, schemaVersion: "main-protocol.weights-manifest.v1" },
    base,
  );
  assert.match(result.errors.join(" "), /schema 不匹配/);
});

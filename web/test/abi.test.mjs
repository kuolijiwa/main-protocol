import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readAbi = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "ABI", `${name}.abi.json`), "utf8"));

test("frontend ABI preserves the five-parameter DatasetRegistered event", () => {
  const entry = readAbi("DatasetRegistry").find(
    (item) => item.type === "event" && item.name === "DatasetRegistered",
  );
  assert.deepEqual(
    entry.inputs.map((input) => input.type),
    ["uint256", "address", "bytes32", "bytes32", "uint256"],
  );
  assert.equal(
    readAbi("DatasetRegistry").some((item) => item.name === "WeightsManifestCommitted"),
    false,
  );
});

test("frontend ABI does not expose deferred auction functions", () => {
  const names = readAbi("Marketplace")
    .filter((item) => item.type === "function")
    .map((item) => item.name);
  for (const deferred of ["bid", "settle", "createAuction", "listExclusiveAuction"])
    assert.equal(names.includes(deferred), false);
});

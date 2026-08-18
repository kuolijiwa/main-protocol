import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateWeightAllocationDocument } from "./lib/merkle-allocation.js";

const file = process.env.ALLOCATION_FILE;
if (!file) throw new Error("ALLOCATION_FILE is required");

const manifest: unknown = JSON.parse(await readFile(resolve(file), "utf8"));
const allocation = validateWeightAllocationDocument(manifest);

console.log(
  JSON.stringify({
    valid: true,
    entries: allocation.entries.length,
    totalWeight: allocation.totalWeight.toString(),
    root: allocation.root,
  }),
);

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateWeightAllocation, type WeightEntry } from "./lib/merkle-allocation.js";

interface AllocationManifest {
  totalWeight: string;
  root?: string;
  entries: WeightEntry[];
}

const file = process.env.ALLOCATION_FILE;
if (!file) throw new Error("ALLOCATION_FILE is required");

const manifest = JSON.parse(await readFile(resolve(file), "utf8")) as AllocationManifest;
const allocation = validateWeightAllocation(manifest.entries, manifest.totalWeight);
if (manifest.root && allocation.root.toLowerCase() !== manifest.root.toLowerCase()) {
  throw new Error(`allocation root mismatch: expected ${manifest.root}, got ${allocation.root}`);
}

console.log(
  JSON.stringify({
    valid: true,
    entries: allocation.entries.length,
    totalWeight: allocation.totalWeight.toString(),
    root: allocation.root,
  }),
);

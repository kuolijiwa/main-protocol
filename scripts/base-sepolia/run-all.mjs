import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const roles = [
  "inspect",
  "admin",
  "timelock",
  "contributor",
  "operator",
  "buyer",
  "claimant",
  "treasury",
  "gateway",
];
const args = process.argv.slice(2);
let failed = false;
for (const role of roles) {
  console.log(`\n=== Base Sepolia role test: ${role} ===`);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, `${role}.mjs`), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  if (exitCode !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

# Dependency audit policy

Main Protocol deploys Solidity bytecode and has no production Node.js runtime. Node packages are nevertheless part of the trusted build, test, deployment, and verification toolchain, so the exact `package-lock.json` is release-controlled.

The production artifact gate runs the following check against the official npm advisory service:

1. Production dependencies must have no Moderate, High, or Critical advisory: `npm audit --omit=dev --audit-level=moderate --registry=https://registry.npmjs.org`.

The complete toolchain is checked separately with `npm run audit:deps:full` at `--audit-level=low`. It is an explicit non-passing review signal with a non-zero exit code, not hidden by CI: the current Hardhat/OpenZeppelin verification dependency graph contains an unfixed `elliptic` advisory. This repository has no Node.js production runtime, so the advisory is excluded from the production artifact gate, but a production release still requires a documented toolchain review and must not claim that the full development toolchain is clean.

Mocha 11.8.0 currently declares vulnerable transitive ranges even though fixed releases are compatible with its APIs. `package.json` therefore pins its three affected children through npm `overrides`:

- `glob` 10.5.0 fixes the CLI command-injection advisory affecting versions before 10.5.0.
- `serialize-javascript` 7.1.0 fixes the RCE and CPU-exhaustion advisories affecting earlier releases.
- `diff` 8.0.3 fixes the patch parser denial-of-service advisory affecting earlier releases.

The remaining transitive advisory is confined to legacy ethers v5/elliptic paths in Hardhat verification and OpenZeppelin upgrade tooling. It is not imported by deployed contracts, but it remains a build-tool risk and must be reviewed on every lockfile change. Do not weaken the production threshold, suppress the full-toolchain result, or bypass the lockfile to make a release pass.

# Dependency audit policy

Main Protocol deploys Solidity bytecode and has no production Node.js runtime. Node packages are nevertheless part of the trusted build, test, deployment, and verification toolchain, so the exact `package-lock.json` is release-controlled.

The release gate runs both of the following checks against the official npm advisory service:

1. The complete development toolchain must have no High or Critical advisory: `npm audit --audit-level=high --registry=https://registry.npmjs.org`.
2. Production dependencies must have no Moderate, High, or Critical advisory: `npm audit --omit=dev --audit-level=moderate --registry=https://registry.npmjs.org`.

Mocha 11.8.0 currently declares vulnerable transitive ranges even though fixed releases are compatible with its APIs. `package.json` therefore pins its three affected children through npm `overrides`:

- `glob` 10.5.0 fixes the CLI command-injection advisory affecting versions before 10.5.0.
- `serialize-javascript` 7.1.0 fixes the RCE and CPU-exhaustion advisories affecting earlier releases.
- `diff` 8.0.3 fixes the patch parser denial-of-service advisory affecting earlier releases.

Remaining Low advisories are confined to legacy ethers v5/elliptic paths in Hardhat verification and OpenZeppelin upgrade tooling. They are not imported by deployed contracts, are below the automated release threshold, and must still be reviewed on every lockfile change. Do not weaken either audit threshold or bypass the lockfile to make a release pass.

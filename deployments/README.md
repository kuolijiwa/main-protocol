# Deployment records

Every successful `npm run deploy -- --network <network>` execution writes:

- `deployments/<network>/<deployment-id>.json`: immutable historical record;
- `deployments/<network>/latest.json`: copy of the most recent record for reconciliation.

Each record contains the deployment script's complete JSON output, the network and chain ID, the block used for recording, public deployment configuration, all core/proxy/implementation addresses, runtime code hashes, external dependency validation, Timelock delay, and onboarding/wiring status.

Private keys, RPC URLs, and other secret fields are intentionally excluded. `.env` remains the source for secrets and is ignored by Git.

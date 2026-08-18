import {
  address,
  connect,
  createContext,
  env,
  fetchManifest,
  findManifestEntry,
  parseArgs,
  protocolSnapshot,
  Reporter,
  sendTx,
  signerFor,
  uint,
  validateManifest,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const claimantAddress = address(
  env("CLAIMANT_ADDRESS", env("CLAIMANT_WALLET", ctx.addresses.nurtureContributor)),
  "CLAIMANT_ADDRESS",
);
const reporter = new Reporter("claimant", ctx);
await reporter.step(
  "Claimant 全量查询：Manifest commitment、Revenue、claimed、unclaimed、Token backing",
  async () => {
    const snapshot = await protocolSnapshot(ctx, env("TEST_DATASET_ID"));
    snapshot.claimant = claimantAddress;
    return snapshot;
  },
);

if (!env("CLAIMANT_PRIVATE_KEY"))
  reporter.skip("Claimant signer 查询", "未配置 CLAIMANT_PRIVATE_KEY，仅执行公开查询");
else {
  const signer = signerFor(ctx, "CLAIMANT_PRIVATE_KEY", claimantAddress);
  const datasetIdText = env("TEST_DATASET_ID");
  if (!datasetIdText) reporter.skip("Claimable/Manifest 验证", "设置 TEST_DATASET_ID 后启用");
  else {
    const datasetId = uint(datasetIdText, "TEST_DATASET_ID", { positive: true });
    const dataset = await ctx.contracts.dataset.getDataset(datasetId);
    const uri = await ctx.contracts.dataset.weightsURI(datasetId);
    let verified;
    await reporter.step("下载并独立验证 Weights Manifest", async () => {
      const raw = await fetchManifest(uri);
      verified = await validateManifest(ctx, raw, datasetId);
      const entry = findManifestEntry(verified, signer.address);
      return {
        uri,
        manifestHash: verified.manifestHash,
        claimant: signer.address,
        weight: entry.weight,
        proofLength: entry.proof.length,
      };
    });
    if (verified) {
      const entry = findManifestEntry(verified, signer.address);
      await reporter.step(
        "Claimable、claimed、dataset unclaimed 和 Token backing 查询",
        async () => ({
          weight: entry.weight,
          claimed: await ctx.contracts.splitter.claimed(datasetId, signer.address),
          claimable: await ctx.contracts.splitter.claimable(
            datasetId,
            signer.address,
            entry.weight,
          ),
          cumulativeRevenue: await ctx.contracts.splitter.cumulativeRevenue(datasetId),
          unclaimedRevenue: await ctx.contracts.splitter.unclaimedRevenue(datasetId),
          contributorBalance: await ctx.contracts.splitter.contributorBalance(),
          splitterTokenBalance: await ctx.contracts.token.balanceOf(ctx.addresses.revenueSplitter),
          datasetStatus: dataset.status,
        }),
      );
      if (args.has("claim")) {
        await writeGuard(ctx, args, "Claimant RevenueSplitter.claim");
        const claim = connect(ctx.contracts.splitter, signer);
        await reporter.step("RevenueSplitter.claim", () =>
          sendTx(
            ctx,
            claim,
            "claim",
            [datasetId, uint(entry.weight, "manifest weight", { positive: true }), entry.proof],
            "claim",
          ),
        );
        await reporter.step("Claim 后余额和 claimed 查询", async () => ({
          claimed: await ctx.contracts.splitter.claimed(datasetId, signer.address),
          claimable: await ctx.contracts.splitter.claimable(
            datasetId,
            signer.address,
            entry.weight,
          ),
          claimantTokenBalance: await ctx.contracts.token.balanceOf(signer.address),
        }));
      }
    }
  }
}
await reporter.finish({ mode: args.has("write") ? "write-requested" : "read-only" });

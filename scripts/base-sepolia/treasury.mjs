import {
  address,
  connect,
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
  sendTx,
  signerFor,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const treasury = address(env("TREASURY"), "TREASURY");
const reporter = new Reporter("treasury", ctx);
await reporter.step("Treasury、Splitter 账本、支付 Token backing 查询", async () => ({
  treasury,
  treasuryTokenBalance: await ctx.contracts.token.balanceOf(treasury),
  splitterTokenBalance: await ctx.contracts.token.balanceOf(ctx.addresses.revenueSplitter),
  treasuryBalance: await ctx.contracts.splitter.treasuryBalance(),
  contributorBalance: await ctx.contracts.splitter.contributorBalance(),
  fullSnapshot: await protocolSnapshot(ctx, env("TEST_DATASET_ID")),
}));
if (args.has("withdraw")) {
  await writeGuard(ctx, args, "Treasury withdrawal");
  if (!env("TREASURY_PRIVATE_KEY"))
    throw new Error("TREASURY_PRIVATE_KEY is required for --withdraw");
  const signer = signerFor(ctx, "TREASURY_PRIVATE_KEY", treasury);
  await reporter.step("withdrawTreasury", () =>
    sendTx(
      ctx,
      connect(ctx.contracts.splitter, signer),
      "withdrawTreasury",
      [],
      "withdrawTreasury",
    ),
  );
} else reporter.skip("withdrawTreasury 写入", "默认只读；需要 --withdraw --write --confirm");
await reporter.finish({ mode: args.has("write") ? "write-requested" : "read-only" });

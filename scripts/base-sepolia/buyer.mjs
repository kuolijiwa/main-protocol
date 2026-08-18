import {
  address,
  connect,
  createContext,
  env,
  expectRevert,
  parseArgs,
  protocolSnapshot,
  Reporter,
  sendTx,
  signerFor,
  uint,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const buyerAddress = address(
  env("BUYER_ADDRESS", env("BUYER_WALLET", ctx.addresses.treasury)),
  "BUYER_ADDRESS",
);
const reporter = new Reporter("buyer", ctx);
await reporter.step("Buyer 全量查询：Listing、价格、Dataset 状态、NFT、余额和 allowance", () =>
  protocolSnapshot(ctx, env("TEST_DATASET_ID")),
);

if (!env("BUYER_PRIVATE_KEY"))
  reporter.skip("Buyer signer 查询", "未配置 BUYER_PRIVATE_KEY，仅执行公开查询");
else {
  const signer = signerFor(ctx, "BUYER_PRIVATE_KEY", buyerAddress);
  const market = connect(ctx.contracts.market, signer);
  const datasetId = env("TEST_DATASET_ID")
    ? uint(env("TEST_DATASET_ID"), "TEST_DATASET_ID", { positive: true })
    : undefined;
  if (datasetId !== undefined) {
    await reporter.step("Buyer 余额和授权查询", async () => ({
      buyer: signer.address,
      balance: await ctx.contracts.token.balanceOf(signer.address),
      allowance: await ctx.contracts.token.allowance(signer.address, ctx.addresses.marketplace),
      copyListing: await ctx.contracts.market.getListing(datasetId, 0),
      exclusiveListing: await ctx.contracts.market.getListing(datasetId, 1),
      copyAccess: await ctx.contracts.nft.hasAccess(datasetId, signer.address),
      copyTokenId: await ctx.contracts.nft.tokenId(datasetId, 0),
      exclusiveTokenId: await ctx.contracts.nft.tokenId(datasetId, 1),
    }));
    await reporter.step("购买价格保护拒绝路径（eth_call，不广播）", async () => {
      const listing = await ctx.contracts.market.getListing(datasetId, 0);
      if (!listing.active) return { skipped: "Copy listing inactive" };
      return expectRevert(
        () =>
          market.buyCopy.staticCall(
            datasetId,
            listing.price + 1n,
            BigInt(Math.floor(Date.now() / 1000)) + 600n,
          ),
        "buyCopy wrong expectedPrice",
      );
    });
    if (args.has("approve")) {
      await writeGuard(ctx, args, "Buyer token approve");
      const amount = uint(env("TEST_APPROVE_AMOUNT", "0"), "TEST_APPROVE_AMOUNT", {
        positive: true,
      });
      await reporter.step("Buyer approve payment token", () =>
        sendTx(
          ctx,
          ctx.contracts.token.connect(signer),
          "approve",
          [ctx.addresses.marketplace, amount],
          "approve",
        ),
      );
    }
    if (args.has("buy-copy") || args.has("buy-exclusive")) {
      await writeGuard(ctx, args, "Buyer purchase");
      const kind = args.has("buy-copy") ? 0 : 1;
      const listing = await ctx.contracts.market.getListing(datasetId, kind);
      if (!listing.active) throw new Error("selected listing is inactive");
      const deadline = uint(
        env("TEST_PURCHASE_DEADLINE", String(Math.floor(Date.now() / 1000) + 600)),
        "TEST_PURCHASE_DEADLINE",
        { positive: true },
      );
      const fn = kind === 0 ? "buyCopy" : "buyExclusive";
      await reporter.step(fn, () =>
        sendTx(ctx, market, fn, [datasetId, listing.price, deadline], fn),
      );
      await reporter.step("购买后 NFT/access 查询", async () => ({
        hasAccess: await ctx.contracts.nft.hasAccess(datasetId, signer.address),
        balance: await ctx.contracts.nft.balanceOf(
          signer.address,
          await ctx.contracts.nft.tokenId(datasetId, kind),
        ),
      }));
    }
  } else reporter.skip("Buyer Dataset 级测试", "设置 TEST_DATASET_ID 后启用");
}
await reporter.finish({ mode: args.has("write") ? "write-requested" : "read-only+eth_call" });

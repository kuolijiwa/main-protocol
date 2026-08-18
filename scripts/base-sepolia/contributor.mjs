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
  uint,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const contributor = address(
  env("TEST_CONTRIBUTOR_ADDRESS", env("NURTURE_CONTRIBUTOR")),
  "TEST_CONTRIBUTOR_ADDRESS",
);
const reporter = new Reporter("contributor", ctx);
await reporter.step("Contributor 身份、Dataset、Listing、收益和权限查询", () =>
  protocolSnapshot(ctx, env("TEST_DATASET_ID")),
);

if (!env("CONTRIBUTOR_PRIVATE_KEY"))
  reporter.skip("Contributor 签名者地址校验", "未配置 CONTRIBUTOR_PRIVATE_KEY，仅执行公开查询");
else {
  const signer = signerFor(ctx, "CONTRIBUTOR_PRIVATE_KEY", contributor);
  const market = connect(ctx.contracts.market, signer);
  if (
    args.has("list-copy") ||
    args.has("list-exclusive") ||
    args.has("delist-copy") ||
    args.has("delist-exclusive")
  ) {
    await writeGuard(ctx, args, "Contributor listing state transition");
    const datasetId = uint(requiredTestDataset(), "TEST_DATASET_ID", { positive: true });
    if (args.has("list-copy"))
      await reporter.step("listCopy 固定价格写入", () =>
        sendTx(
          ctx,
          market,
          "listCopy",
          [datasetId, uint(env("TEST_COPY_PRICE"), "TEST_COPY_PRICE", { positive: true })],
          "listCopy",
        ),
      );
    if (args.has("list-exclusive"))
      await reporter.step("listExclusiveFixed 固定价格写入", () =>
        sendTx(
          ctx,
          market,
          "listExclusiveFixed",
          [
            datasetId,
            uint(env("TEST_EXCLUSIVE_PRICE"), "TEST_EXCLUSIVE_PRICE", { positive: true }),
          ],
          "listExclusiveFixed",
        ),
      );
    if (args.has("delist-copy"))
      await reporter.step("delist Copy 写入", () =>
        sendTx(ctx, market, "delist", [datasetId, 0], "delist Copy"),
      );
    if (args.has("delist-exclusive"))
      await reporter.step("delist Exclusive 写入", () =>
        sendTx(ctx, market, "delist", [datasetId, 1], "delist Exclusive"),
      );
  } else {
    await reporter.step("Contributor signer 与链上 Contributor 一致", async () => ({
      signer: signer.address,
      configured: contributor,
    }));
  }
}
await reporter.finish({ mode: args.has("write") ? "write-requested" : "read-only" });

function requiredTestDataset() {
  const value = env("TEST_DATASET_ID");
  if (!value) throw new Error("TEST_DATASET_ID is required for Contributor state tests");
  return value;
}

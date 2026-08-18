import {
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
  safeCalldata,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const reporter = new Reporter("admin", ctx);
await reporter.step("ADMIN 多签和全部运营角色查询", () =>
  protocolSnapshot(ctx, env("TEST_DATASET_ID")),
);

if (args.has("safe-tx")) {
  const txs = [
    { operation: "pause", ...safeCalldata(ctx.contracts.config, "pause", []) },
    { operation: "unpause", ...safeCalldata(ctx.contracts.config, "unpause", []) },
  ];
  if (
    env("TEST_DATASET_ID") &&
    env("TEST_CHALLENGE_EVIDENCE_HASH") &&
    env("TEST_CHALLENGE_EVIDENCE_URI")
  ) {
    const datasetId = BigInt(env("TEST_DATASET_ID"));
    txs.push({
      operation: "recordChallenge",
      ...safeCalldata(ctx.contracts.dataset, "recordChallenge", [
        datasetId,
        env("TEST_CHALLENGE_EVIDENCE_HASH"),
        env("TEST_CHALLENGE_EVIDENCE_URI"),
      ]),
    });
    txs.push({
      operation: "resolveChallenge(upheld=false)",
      ...safeCalldata(ctx.contracts.dataset, "resolveChallenge", [datasetId, false]),
    });
  }
  await reporter.step("生成 Safe 可执行 calldata", () => ({
    safe: ctx.addresses.adminMultisig,
    transactions: txs,
    note: "必须在真实 Safe 中完成收集阈值签名和执行；Safe owner EOA 不能直接替代 Safe 调用者",
  }));
}
if (args.has("write")) {
  reporter.skip(
    "直接 ADMIN 写入",
    "ADMIN_MULTISIG 默认是 Safe；请使用 --safe-tx 生成交易并在 Safe UI/API 执行",
  );
}
await reporter.finish({ mode: args.has("safe-tx") ? "read-only+safe-calldata" : "read-only" });

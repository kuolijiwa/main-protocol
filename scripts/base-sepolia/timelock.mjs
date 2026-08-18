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
const reporter = new Reporter("timelock", ctx);
await reporter.step("Timelock 延迟、角色、治理配置查询", () =>
  protocolSnapshot(ctx, env("TEST_DATASET_ID")),
);

if (args.has("safe-tx")) {
  const operations = [
    {
      operation: "setFeeBps",
      ...safeCalldata(ctx.contracts.config, "setFeeBps", [BigInt(env("TEST_NEW_FEE_BPS", "0"))]),
    },
    {
      operation: "setChallengeWindow",
      ...safeCalldata(ctx.contracts.config, "setChallengeWindow", [
        BigInt(env("TEST_NEW_CHALLENGE_WINDOW", "1")),
      ]),
    },
    {
      operation: "setGatewaySigner",
      ...safeCalldata(ctx.contracts.config, "setGatewaySigner", [
        env("TEST_NEW_GATEWAY_SIGNER", ctx.addresses.gatewaySigner),
      ]),
    },
  ];
  await reporter.step("生成 Timelock batch 所需目标 calldata", () => ({
    operations,
    note: "这些是 Timelock 的目标交易 calldata，不是直接调用；必须由 ADMIN Safe 按 48 小时 Timelock 流程 schedule/execute",
  }));
}
await reporter.finish({
  mode: args.has("safe-tx") ? "read-only+governance-calldata" : "read-only",
});

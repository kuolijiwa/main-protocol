import {
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
  strictDeploymentChecks,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const reporter = new Reporter("inspect", ctx);
await reporter.step("完整协议只读快照", () => protocolSnapshot(ctx, env("TEST_DATASET_ID")));
await reporter.step("部署、wiring、角色、初始 Contributor 和代码哈希严格验收", () =>
  strictDeploymentChecks(ctx),
);
await reporter.finish({ mode: "read-only", note: "此脚本不发送交易" });

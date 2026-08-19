import { id, ZeroHash } from "ethers";
import fs from "node:fs/promises";
import {
  connect,
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
  rootPath,
  safeCalldata,
  sendTx,
  signerFor,
  writeGuard,
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
    note: "这些是 Timelock 的目标交易 calldata，不是直接调用；必须由 ADMIN Safe 按当前配置的 Timelock 延迟 schedule/execute",
  }));
}

if (args.values["set-challenge-window"] !== undefined) {
  await writeGuard(ctx, args, "Timelock setChallengeWindow");
  const newWindow = BigInt(args.values["set-challenge-window"]);
  if (newWindow < 1n) throw new Error("challenge window must be positive");
  const signer = signerFor(
    ctx,
    env("ADMIN_PRIVATE_KEY") ? "ADMIN_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY",
    ctx.addresses.adminMultisig,
  );
  const timelock = connect(ctx.contracts.timelock, signer);
  const target = ctx.addresses.protocolConfig;
  const data = ctx.contracts.config.interface.encodeFunctionData("setChallengeWindow", [newWindow]);
  const predecessor = ZeroHash;
  const salt = id(`base-sepolia-live-challenge-window-${newWindow}`);
  const operationId = await ctx.contracts.timelock.hashOperation(
    target,
    0n,
    data,
    predecessor,
    salt,
  );
  if (await ctx.contracts.timelock.isOperationDone(operationId)) {
    reporter.skip("Timelock setChallengeWindow", "该治理操作已执行");
  } else {
    if (!(await ctx.contracts.timelock.isOperationPending(operationId))) {
      const delay = await ctx.contracts.timelock.getMinDelay();
      await reporter.step("Timelock schedule setChallengeWindow", () =>
        sendTx(
          ctx,
          timelock,
          "schedule",
          [target, 0n, data, predecessor, salt, delay],
          "schedule setChallengeWindow",
        ),
      );
    } else reporter.skip("Timelock schedule setChallengeWindow", "治理操作已经 Pending");

    while (!(await ctx.contracts.timelock.isOperationReady(operationId))) {
      const timestamp = await ctx.contracts.timelock.getTimestamp(operationId);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const remaining = timestamp > now ? timestamp - now : 1n;
      await new Promise((resolve) =>
        setTimeout(resolve, Number(remaining > 10n ? 10n : remaining) * 1000),
      );
    }
    await reporter.step("Timelock execute setChallengeWindow", () =>
      sendTx(
        ctx,
        timelock,
        "execute",
        [target, 0n, data, predecessor, salt],
        "execute setChallengeWindow",
      ),
    );
    await reporter.step("新 challenge window 查询", async () => {
      const actual = await ctx.contracts.config.challengeWindow();
      if (actual !== newWindow)
        throw new Error(`challengeWindow expected ${newWindow}, got ${actual}`);
      await updateEnv("CHALLENGE_WINDOW_SECONDS", newWindow.toString());
      return { challengeWindow: actual };
    });
  }
}

if (args.values["set-treasury"] !== undefined) {
  await writeGuard(ctx, args, "Timelock setTreasury");
  const newTreasury = args.values["set-treasury"];
  const signer = signerFor(
    ctx,
    env("ADMIN_PRIVATE_KEY") ? "ADMIN_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY",
    ctx.addresses.adminMultisig,
  );
  const timelock = connect(ctx.contracts.timelock, signer);
  const target = ctx.addresses.protocolConfig;
  const data = ctx.contracts.config.interface.encodeFunctionData("setTreasury", [newTreasury]);
  const predecessor = ZeroHash;
  const salt = id(`base-sepolia-live-treasury-${newTreasury.toLowerCase()}`);
  const operationId = await ctx.contracts.timelock.hashOperation(
    target,
    0n,
    data,
    predecessor,
    salt,
  );
  if (await ctx.contracts.timelock.isOperationDone(operationId)) {
    reporter.skip("Timelock setTreasury", "该治理操作已执行");
  } else {
    if (!(await ctx.contracts.timelock.isOperationPending(operationId))) {
      const delay = await ctx.contracts.timelock.getMinDelay();
      await reporter.step("Timelock schedule setTreasury", () =>
        sendTx(
          ctx,
          timelock,
          "schedule",
          [target, 0n, data, predecessor, salt, delay],
          "schedule setTreasury",
        ),
      );
    } else reporter.skip("Timelock schedule setTreasury", "治理操作已经 Pending");

    while (!(await ctx.contracts.timelock.isOperationReady(operationId))) {
      const timestamp = await ctx.contracts.timelock.getTimestamp(operationId);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const remaining = timestamp > now ? timestamp - now : 1n;
      await new Promise((resolve) =>
        setTimeout(resolve, Number(remaining > 10n ? 10n : remaining) * 1000),
      );
    }
    await reporter.step("Timelock execute setTreasury", () =>
      sendTx(
        ctx,
        timelock,
        "execute",
        [target, 0n, data, predecessor, salt],
        "execute setTreasury",
      ),
    );
    await reporter.step("新 Treasury 查询", async () => {
      const actual = await ctx.contracts.config.treasury();
      if (actual.toLowerCase() !== newTreasury.toLowerCase())
        throw new Error(`treasury expected ${newTreasury}, got ${actual}`);
      await updateEnv("TREASURY", newTreasury);
      return { treasury: actual };
    });
  }
}
await reporter.finish({
  mode: args.has("safe-tx") ? "read-only+governance-calldata" : "read-only",
});

async function updateEnv(name, value) {
  const file = rootPath(".env");
  let contents = await fs.readFile(file, "utf8");
  const pattern = new RegExp(`^${name}=.*$`, "mu");
  const line = `${name}=${value}`;
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
  await fs.writeFile(file, contents);
}

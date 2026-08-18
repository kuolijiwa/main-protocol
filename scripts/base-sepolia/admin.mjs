import {
  address,
  connect,
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
  safeCalldata,
  sendTx,
  signerFor,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const reporter = new Reporter("admin", ctx);
const writeAction =
  args.has("pause-test") || args.has("challenge-test") || args.has("resolve-challenge");
if (writeAction) {
  reporter.skip("ADMIN 多签和全部运营角色查询", "写入动作使用快速路径，写入后执行状态查询");
} else {
  await reporter.step("ADMIN 多签和全部运营角色查询", () =>
    protocolSnapshot(ctx, env("TEST_DATASET_ID")),
  );
}

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
const adminCode = await ctx.provider.getCode(ctx.addresses.adminMultisig);
if (args.has("pause-test") || args.has("challenge-test") || args.has("resolve-challenge")) {
  if (adminCode !== "0x") {
    reporter.skip("普通账号 ADMIN 写入", "ADMIN_MULTISIG 是合约地址，请使用 --safe-tx");
  } else {
    await writeGuard(ctx, args, "ordinary-account ADMIN test");
    const adminKeyName = env("ADMIN_PRIVATE_KEY") ? "ADMIN_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY";
    const signer = signerFor(
      ctx,
      adminKeyName,
      address(ctx.addresses.adminMultisig, "ADMIN_MULTISIG"),
    );
    const config = connect(ctx.contracts.config, signer);
    const dataset = connect(ctx.contracts.dataset, signer);
    if (args.has("pause-test")) {
      await reporter.step("普通账号 pause", () => sendTx(ctx, config, "pause", [], "pause"));
      await reporter.step("暂停状态查询", async () => {
        if (!(await ctx.contracts.config.paused()))
          throw new Error("paused() is false after pause");
        return { paused: true };
      });
      await reporter.step("普通账号 unpause", () => sendTx(ctx, config, "unpause", [], "unpause"));
      await reporter.step("恢复状态查询", async () => {
        if (await ctx.contracts.config.paused()) throw new Error("paused() is true after unpause");
        return { paused: false };
      });
    }
    if (args.has("challenge-test")) {
      const datasetId = requiredChallengeValue("TEST_DATASET_ID");
      const evidenceHash = requiredChallengeValue("TEST_CHALLENGE_EVIDENCE_HASH");
      const evidenceURI = requiredChallengeValue("TEST_CHALLENGE_EVIDENCE_URI");
      await reporter.step("普通账号 recordChallenge", () =>
        sendTx(
          ctx,
          dataset,
          "recordChallenge",
          [datasetId, evidenceHash, evidenceURI],
          "recordChallenge",
        ),
      );
      await reporter.step("Pending Challenge 查询", async () => ({
        status: await ctx.contracts.dataset.challengeStatus(datasetId),
        evidenceHash: await ctx.contracts.dataset.challengeEvidenceHash(datasetId),
        evidenceURI: await ctx.contracts.dataset.challengeEvidenceURI(datasetId),
        resolutionDueAt: await ctx.contracts.dataset.challengeResolutionDueAt(datasetId),
      }));
      if (args.has("reject-challenge")) {
        await reporter.step("普通账号 resolveChallenge(false)", () =>
          sendTx(ctx, dataset, "resolveChallenge", [datasetId, false], "resolveChallenge(false)"),
        );
      }
    } else if (args.has("resolve-challenge")) {
      const datasetId = requiredChallengeValue("TEST_DATASET_ID");
      const upheld = env("TEST_CHALLENGE_UPHELD", "false") === "true";
      await reporter.step(`普通账号 resolveChallenge(${upheld})`, () =>
        sendTx(ctx, dataset, "resolveChallenge", [datasetId, upheld], "resolveChallenge"),
      );
    }
  }
} else if (args.has("write")) {
  reporter.skip(
    "普通账号 ADMIN 写入",
    "请指定 --pause-test 或 --challenge-test [--reject-challenge]",
  );
}
await reporter.finish({ mode: args.has("safe-tx") ? "read-only+safe-calldata" : "read-only" });

function requiredChallengeValue(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required for Challenge test`);
  return name === "TEST_DATASET_ID" ? BigInt(value) : value;
}

import {
  address,
  connect,
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  readBytes,
  Reporter,
  sendTx,
  signerFor,
  uint,
  validateManifestDocument,
  writeGuard,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const operatorAddress = address(
  env("TEST_OPERATOR_ADDRESS", env("PIPELINE_OPERATOR")),
  "TEST_OPERATOR_ADDRESS",
);
const reporter = new Reporter("operator", ctx);
const configuredDatasetId = env("TEST_DATASET_ID");
const nextDatasetId = await ctx.contracts.dataset.nextDatasetId();
const snapshotDatasetId =
  configuredDatasetId && BigInt(configuredDatasetId) < nextDatasetId
    ? configuredDatasetId
    : undefined;
await reporter.step("Operator、Contributor 映射、nextDatasetId 和注册前查询", () =>
  protocolSnapshot(ctx, snapshotDatasetId ?? null),
);

if (!env("OPERATOR_PRIVATE_KEY"))
  reporter.skip("Operator 注册签名者", "未配置 OPERATOR_PRIVATE_KEY，仅执行公开查询");
else {
  const signer = signerFor(ctx, "OPERATOR_PRIVATE_KEY", operatorAddress);
  const dataset = connect(ctx.contracts.dataset, signer);
  await reporter.step("Operator signer 与 PIPELINE_OPERATOR 一致", () => ({
    signer: signer.address,
    configured: operatorAddress,
  }));
  if (args.has("register")) {
    await writeGuard(ctx, args, "Operator registerDataset");
    const params = registrationParams(await ctx.contracts.dataset.nextDatasetId());
    if (env("TEST_MANIFEST_FILE")) {
      await reporter.step("注册前独立验证 Weights Manifest", async () => {
        const verified = validateManifestDocument(ctx, await readBytes(env("TEST_MANIFEST_FILE")), {
          datasetId: params.expectedDatasetId,
          totalWeight: params.totalWeight,
          weightsRoot: params.weightsRoot,
          manifestHash: params.weightsManifestHash,
        });
        return { manifestHash: verified.manifestHash, entryCount: verified.entries.length };
      });
    } else
      throw new Error(
        "TEST_MANIFEST_FILE is required for --register; registration cannot bypass independent Manifest validation",
      );
    await reporter.step("registerDataset 交易", () =>
      sendTx(ctx, dataset, "registerDataset", [params], "registerDataset"),
    );
    await reporter.step("注册后 Dataset 查询", async () => {
      const id = params.expectedDatasetId;
      return ctx.contracts.dataset.getDataset(id);
    });
  } else
    reporter.skip("Operator registerDataset 写入", "默认不广播；需要 --register --write --confirm");
}
await reporter.finish({ mode: args.has("write") ? "write-requested" : "read-only" });

function registrationParams(nextId) {
  const policy = {
    allowCopy: env("TEST_ALLOW_COPY", "true") === "true",
    allowExclusive: env("TEST_ALLOW_EXCLUSIVE", "false") === "true",
    exclusiveRequiresZeroCopies: env("TEST_EXCLUSIVE_REQUIRES_ZERO_COPIES", "true") === "true",
    licensesTransferable: false,
  };
  return {
    expectedDatasetId: uint(env("TEST_REGISTER_EXPECTED_DATASET_ID", nextId), "expectedDatasetId", {
      positive: true,
    }),
    contentHash: envRequired("TEST_CONTENT_HASH"),
    sampleURI: envRequired("TEST_SAMPLE_URI"),
    payloadURI: envRequired("TEST_PAYLOAD_URI"),
    weightsRoot: envRequired("TEST_WEIGHTS_ROOT"),
    totalWeight: uint(envRequired("TEST_TOTAL_WEIGHT"), "TEST_TOTAL_WEIGHT", { positive: true }),
    weightsURI: envRequired("TEST_WEIGHTS_URI"),
    weightsManifestHash: envRequired("TEST_WEIGHTS_MANIFEST_HASH"),
    policy,
    tag: env("TEST_TAG", "base-sepolia-live-test"),
  };
}

function envRequired(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required for registration`);
  return value;
}

import {
  address,
  createContext,
  env,
  parseArgs,
  protocolSnapshot,
  Reporter,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const reporter = new Reporter("gateway", ctx);
await reporter.step("Gateway signer、entitlement 和 payload 查询", async () => {
  const result = {
    gatewaySigner: ctx.addresses.gatewaySigner,
    configuredGatewaySigner: await ctx.contracts.config.gatewaySigner(),
  };
  if (env("TEST_DATASET_ID")) {
    const datasetId = BigInt(env("TEST_DATASET_ID"));
    const subject = address(
      env("GATEWAY_SUBJECT", env("BUYER_ADDRESS", ctx.addresses.treasury)),
      "GATEWAY_SUBJECT",
    );
    result.entitlement = {
      subject,
      hasAccess: await ctx.contracts.nft.hasAccess(datasetId, subject),
      dataset: await ctx.contracts.dataset.getDataset(datasetId),
      payloadURI: (await ctx.contracts.dataset.getDataset(datasetId)).payloadURI,
    };
  }
  return result;
});
await reporter.finish({
  mode: "read-only",
  note: "Gateway 是链下服务，本脚本不伪造签名或发放数据",
});

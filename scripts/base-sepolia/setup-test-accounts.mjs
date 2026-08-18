import fs from "node:fs/promises";
import {
  address,
  connect,
  createContext,
  env,
  parseArgs,
  Reporter,
  roleMembers,
  sendTx,
  signerFor,
  writeGuard,
  rootPath,
} from "./lib/common.mjs";

const args = parseArgs();
const ctx = await createContext(args);
const reporter = new Reporter("setup-test-accounts", ctx);
const adminAddress = address(ctx.addresses.adminMultisig, "ADMIN_MULTISIG");
const contributorAddress = requiredAddress("CONTRIBUTOR_ADDRESS");
const operatorAddress = requiredAddress("OPERATOR_ADDRESS");
const buyerAddress = requiredAddress("BUYER_ADDRESS");
const claimantAddress = requiredAddress("CLAIMANT_ADDRESS");
const treasuryAddress = requiredAddress("TREASURY_ADDRESS");

await reporter.step("测试账号地址和 Gas 余额查询", async () => {
  const accounts = {
    operatorAddress,
    contributorAddress,
    buyerAddress,
    claimantAddress,
    treasuryAddress,
  };
  const balances = {};
  for (const [name, target] of Object.entries(accounts)) {
    balances[name] = await ctx.provider.getBalance(target);
  }
  return { accounts, balances, minimumExpectedWei: 1000000000000000n };
});

await reporter.step("测试账号私钥地址一致性校验", async () => {
  const pairs = [
    ["OPERATOR_PRIVATE_KEY", operatorAddress],
    ["CONTRIBUTOR_PRIVATE_KEY", contributorAddress],
    ["BUYER_PRIVATE_KEY", buyerAddress],
    ["CLAIMANT_PRIVATE_KEY", claimantAddress],
    ["TREASURY_PRIVATE_KEY", treasuryAddress],
  ];
  const checked = [];
  for (const [keyName, expected] of pairs) {
    const signer = signerFor(ctx, keyName);
    if (signer.address.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${keyName} does not match its *_ADDRESS value`);
    }
    checked.push({ keyName, address: signer.address });
  }
  return checked;
});

if (!args.has("write")) {
  reporter.skip("链上角色配置", "预览模式；添加 --write --confirm 才会授予角色和设置映射");
} else {
  await writeGuard(ctx, args, "test account role setup");
  const adminKeyName = env("ADMIN_PRIVATE_KEY") ? "ADMIN_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY";
  const admin = signerFor(ctx, adminKeyName, adminAddress);
  const registry = connect(ctx.contracts.contributor, admin);
  const contributorRole = await ctx.contracts.contributor.CONTRIBUTOR_ROLE();
  const operatorRole = await ctx.contracts.contributor.OPERATOR_ROLE();

  if (await ctx.contracts.contributor.hasRole(contributorRole, contributorAddress)) {
    reporter.skip("授予测试 Contributor 角色", "CONTRIBUTOR_ROLE 已存在");
  } else {
    await reporter.step("授予测试 Contributor 的 CONTRIBUTOR_ROLE", () =>
      sendTx(
        ctx,
        registry,
        "grantRole",
        [contributorRole, contributorAddress],
        "grant CONTRIBUTOR_ROLE",
      ),
    );
  }

  if (await ctx.contracts.contributor.hasRole(operatorRole, operatorAddress)) {
    reporter.skip("授予测试 Operator 角色", "OPERATOR_ROLE 已存在");
  } else {
    await reporter.step("授予测试 Operator 的 OPERATOR_ROLE", () =>
      sendTx(ctx, registry, "grantRole", [operatorRole, operatorAddress], "grant OPERATOR_ROLE"),
    );
  }

  const currentAssignment = await ctx.contracts.contributor.operatorContributor(operatorAddress);
  if (currentAssignment.toLowerCase() === contributorAddress.toLowerCase()) {
    reporter.skip("设置测试 Operator 映射", "operatorContributor 映射已正确");
  } else {
    await reporter.step("设置测试 Operator → Contributor 映射", () =>
      sendTx(
        ctx,
        registry,
        "setOperatorContributor",
        [operatorAddress, contributorAddress],
        "setOperatorContributor",
      ),
    );
  }

  await reporter.step("角色配置后查询", async () => ({
    contributorRoleMembers: await roleMembers(ctx.contracts.contributor, contributorRole),
    operatorRoleMembers: await roleMembers(ctx.contracts.contributor, operatorRole),
    operatorContributor: await ctx.contracts.contributor.operatorContributor(operatorAddress),
  }));
  await updateLocalTestEnvironment({ operatorAddress, contributorAddress, treasuryAddress });
}

await reporter.finish({
  mode: args.has("write") ? "write-requested" : "read-only-preview",
  note: "测试 Contributor 会使初始 Contributor 数量不再是 1；本地验收已切换为 EXPECT_INITIAL_CONTRIBUTOR_ONLY=false",
});

function requiredAddress(name) {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return address(value, name);
}

async function updateLocalTestEnvironment({
  operatorAddress: operator,
  contributorAddress: contributor,
  treasuryAddress: treasury,
}) {
  const file = rootPath(".env");
  let contents = await fs.readFile(file, "utf8");
  const values = {
    TEST_OPERATOR_ADDRESS: operator,
    TEST_CONTRIBUTOR_ADDRESS: contributor,
    TEST_TREASURY_ADDRESS: treasury,
    EXPECT_INITIAL_CONTRIBUTOR_ONLY: "false",
  };
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "mu");
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(file, contents);
}

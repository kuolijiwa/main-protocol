# Main Protocol V1 — Base Sepolia 真实链角色验收测试手册

## 1. 目的和边界

本手册对应 `scripts/base-sepolia/*.mjs`，用于对已经部署到 Base Sepolia（Chain ID `84532`）的 Main Protocol V1 合约执行真实 RPC 验收。

脚本使用 Node.js + `ethers`，不会启动 Hardhat 本地链，也不会把测试结果误认为 Solidity 单元测试。默认模式只读并使用 `eth_call` 模拟拒绝分支；任何广播交易都必须同时满足：命令包含 `--write --confirm`，并且未提交的 `.env` 中有 `ALLOW_BASE_SEPOLIA_WRITES=true`。

当前 V1 只支持固定价 Copy/Exclusive，不包含拍卖、`bid`、Crowdsourcing、Arcade、Gateway 服务实现或链上 permissionless challenge。Gateway 脚本只验收链上 entitlement 和配置，不伪造 Gateway 签名或发放 payload。

## 2. 脚本和角色覆盖

| 脚本              | 对应角色/对象              | 只读查询                                                                                     | 可选真实写入或验收动作                                                                                    |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `inspect.mjs`     | 发布验收                   | 网络、代码、配置、wiring、全部角色、Safe、Token、Dataset、Listing、Revenue、NFT              | 严格部署验收，不写链                                                                                      |
| `admin.mjs`       | ADMIN Safe                 | 五个运营合约的 `ADMIN_ROLE`、暂停状态、挑战状态、Safe owner/threshold/modules/guard/fallback | 生成 `pause/unpause/recordChallenge/resolveChallenge` Safe calldata；不把 Safe owner 私钥当作 Safe 调用者 |
| `timelock.mjs`    | ProtocolTimelock / 治理    | 48 小时延迟、self-admin、Proposer/Executor/Canceller、配置和 UUPS 治理地址                   | 生成配置目标 calldata；实际 schedule/execute 必须走 Safe + Timelock                                       |
| `contributor.mjs` | CONTRIBUTOR                | 身份、Dataset、两种 Listing、价格、状态、Revenue、NFT、权限                                  | `listCopy`、`listExclusiveFixed`、两种 `delist`                                                           |
| `operator.mjs`    | OPERATOR / Pipeline        | Operator 角色、映射 Contributor、`nextDatasetId`、注册前配置、Dataset/Manifest commitment    | `registerDataset`，并查询注册结果                                                                         |
| `buyer.mjs`       | Buyer                      | Token 余额/allowance、Listing/价格、Dataset 状态、Copy/Exclusive token ID、`hasAccess`       | `approve`、`buyCopy`、`buyExclusive`；错误价格拒绝路径使用 `eth_call`                                     |
| `claimant.mjs`    | Sub-contributor / Claimant | Manifest URI/hash/root、`claimed`、`claimable`、Dataset 隔离余额、Splitter backing           | 下载并独立验证 Manifest；`RevenueSplitter.claim`                                                          |
| `treasury.mjs`    | Treasury                   | Treasury 地址和余额、Splitter treasury/contributor 账本、Token backing、完整快照             | `withdrawTreasury`                                                                                        |
| `gateway.mjs`     | Gateway 链下服务边界       | Gateway signer、Dataset payload URI、指定主体 `hasAccess`                                    | 不发交易                                                                                                  |
| `run-all.mjs`     | 全部角色                   | 按顺序运行上述全部脚本                                                                       | 透传同一组参数；不建议批量广播写入                                                                        |

每个脚本都会输出 `PASS/FAIL/SKIP`，并写入 `reports/base-sepolia-live/<role>-<timestamp>.json`。报告中只包含地址、查询值、交易哈希和错误信息，不写入私钥。

## 3. 环境准备

### 3.1 编译和依赖

```bash
npm ci
npm run compile
```

Node.js 建议使用项目 CI 使用的 Node 22 或更高版本。脚本从 Hardhat `artifacts/` 读取 ABI，因此必须先执行 `npm run compile`。

### 3.2 配置文件

参考模板中的字段填写本地 `.env`，不要覆盖已有的部署密钥：

```bash
sed -n '1,200p' .env.base-sepolia-live.example
```

实际运行时仍使用仓库根目录下未跟踪的 `.env`。模板只提供字段，不包含任何密钥。`.gitignore` 已忽略真实 `.env` 和测试报告目录，同时保留两个不含密钥的模板文件。

至少要填写：

```dotenv
BASE_SEPOLIA_RPC_URL=https://base-sepolia-rpc.publicnode.com
PROTOCOL_TIMELOCK=0x...
CONTRIBUTOR_REGISTRY=0x...
PROTOCOL_CONFIG=0x...
DATASET_REGISTRY=0x...
ENTITLEMENT_NFT=0x...
REVENUE_SPLITTER=0x...
MARKETPLACE=0x...
PAYMENT_TOKEN=0x...
ADMIN_MULTISIG=0x...
TREASURY=0x...
GATEWAY_SIGNER=0x...
NURTURE_CONTRIBUTOR=0x...
PIPELINE_OPERATOR=0x...
ALLOW_BASE_SEPOLIA_WRITES=false
EXPECT_INITIAL_CONTRIBUTOR_ONLY=true
```

地址必须来自同一笔部署和同一条链。不能把本地 Hardhat、Base Mainnet 或另一套 Base Sepolia 地址混用。

真实写入才需要相应角色私钥：

```dotenv
CONTRIBUTOR_PRIVATE_KEY=...
OPERATOR_PRIVATE_KEY=...
BUYER_PRIVATE_KEY=...
BUYER_ADDRESS=0x...
CLAIMANT_PRIVATE_KEY=...
CLAIMANT_ADDRESS=0x...
TREASURY_PRIVATE_KEY=...
```

私钥只允许保存于本地 `.env` 或密钥管理系统，不得出现在脚本、报告、命令历史、提交、Issue 或聊天内容中。`ADMIN_MULTISIG` 是 Safe 时，Safe owner 私钥不能直接调用 `onlyRole(ADMIN_ROLE)` 合约；必须由 Safe 收集阈值签名后以 Safe 地址执行。

## 4. 推荐验收顺序

### 第一步：完整只读发布验收

```bash
npm run live:base-sepolia:inspect
```

该步骤必须通过：

- RPC Chain ID 是 `84532`；
- 七个核心合约均有 runtime code；
- `ProtocolTimelock` 延迟不少于 48 小时，且只有自身持有 `DEFAULT_ADMIN_ROLE`；
- Timelock 的 `PROPOSER_ROLE`、`EXECUTOR_ROLE`、`CANCELLER_ROLE` 是预期的精确成员集合；
- 六个受治理合约的 `DEFAULT_ADMIN_ROLE` 精确指向 Timelock；
- `DatasetRegistry`、`EntitlementNFT`、`RevenueSplitter` 的 Marketplace wiring 与反向依赖一致；
- `NURTURE_CONTRIBUTOR` 是唯一初始 `CONTRIBUTOR_ROLE` 成员（除非明确设置 `EXPECT_INITIAL_CONTRIBUTOR_ONLY=false` 做后续扩展成员环境验收）；
- `PIPELINE_OPERATOR` 持有 `OPERATOR_ROLE`，不持有 `CONTRIBUTOR_ROLE`，且只映射到 Nurture；
- `.env` 中存在代码哈希时，链上 runtime code hash 与其完全一致。
- `ADMIN_MULTISIG` 必须有 Safe 合约代码，并通过 owner、threshold、modules、guard、fallback handler 校验；只有显式设置 `ALLOW_BASE_SEPOLIA_EOA_ADMIN_TEST=true` 时才允许把 EOA 作为临时测试例外。

如果部署阶段由 EOA 临时持有管理员权限，生产验收必须失败；不能用 `ALLOW_EOA_ADMIN=true` 作为生产通过条件。

### 第二步：按角色读取

```bash
npm run live:base-sepolia:admin
npm run live:base-sepolia:timelock
npm run live:base-sepolia:contributor
npm run live:base-sepolia:operator
npm run live:base-sepolia:buyer
npm run live:base-sepolia:claimant
npm run live:base-sepolia:treasury
npm run live:base-sepolia:gateway
```

没有 `TEST_DATASET_ID` 时，协议级查询仍会执行；Dataset、Listing、Manifest、购买和 Claim 级查询会明确显示 `SKIP`，不会伪造通过。

### 第三步：Safe 管理员和治理 calldata

先只生成 calldata：

```bash
npm run live:base-sepolia:admin -- --safe-tx
npm run live:base-sepolia:timelock -- --safe-tx
```

输出中的 `to/data/value` 可导入 Safe 交易工具。`admin.mjs` 的 challenge calldata 只有在同时配置以下字段时才会生成：

```dotenv
TEST_DATASET_ID=...
TEST_CHALLENGE_EVIDENCE_HASH=0x...
TEST_CHALLENGE_EVIDENCE_URI=https://...
```

Evidence 必须先通过仓库的严格校验脚本，并且 `recordChallenge` 只能在挑战窗口结束前执行。V1 是 ADMIN 介导 Challenge：任何人链下提交证据，只有 ADMIN 记录和裁决；脚本不会声称实现 permissionless challenge。

### 第四步：Operator 注册验收

先准备并公开发布 v1 Manifest。注册字段必须与链上前置 `nextDatasetId()` 一致。建议先只读确认，然后使用一次性测试 Dataset：

```bash
npm run live:base-sepolia:operator -- --register --write --confirm
```

此命令要求 `OPERATOR_PRIVATE_KEY` 与 `PIPELINE_OPERATOR` 一致，并要求设置：

```dotenv
TEST_CONTENT_HASH=0x...
TEST_SAMPLE_URI=https://...
TEST_PAYLOAD_URI=https://...
TEST_WEIGHTS_ROOT=0x...
TEST_TOTAL_WEIGHT=1000000
TEST_WEIGHTS_URI=https://.../manifest.json
TEST_WEIGHTS_MANIFEST_HASH=0x...
```

注册前必须独立运行：

```bash
ALLOCATION_FILE=./allocation.json npm run validate:allocation
npm run verify:weights-manifest
```

脚本会使用链上 `nextDatasetId` 作为默认 expected ID；如果出现并发注册导致 ID 改变，必须重新生成 Manifest，不得重用旧文件。

### 第五步：Contributor Listing 验收

Contributor 只能为自己的 Dataset 创建或撤销 Listing。使用已注册但尚未销售的验收 Dataset：

```dotenv
CONTRIBUTOR_PRIVATE_KEY=...
TEST_DATASET_ID=1
TEST_COPY_PRICE=1000000
TEST_EXCLUSIVE_PRICE=2000000
```

只创建 Copy Listing：

```bash
npm run live:base-sepolia:contributor -- --list-copy --write --confirm
```

只创建 Exclusive Listing：

```bash
npm run live:base-sepolia:contributor -- --list-exclusive --write --confirm
```

撤销时使用：

```bash
npm run live:base-sepolia:contributor -- --delist-copy --write --confirm
npm run live:base-sepolia:contributor -- --delist-exclusive --write --confirm
```

V1 价格是创建 Listing 时固定的；修改价格必须先 delist，再以新价格创建。Listing 建立后会记录 `maxFeeBps`，费率升高会使旧 Listing 拒绝购买，费率降低不会损害卖家。

### 第六步：Buyer 购买和拒绝分支

先查询余额、授权和 Listing：

```bash
npm run live:base-sepolia:buyer
```

Buyer 的 Token 必须由测试 Token 水龙头或测试分发账户提供，脚本不会凭空铸币。授权和购买是明确的真实写入：

```dotenv
BUYER_PRIVATE_KEY=...
BUYER_ADDRESS=0x...
TEST_APPROVE_AMOUNT=1000000
```

```bash
npm run live:base-sepolia:buyer -- --approve --write --confirm
npm run live:base-sepolia:buyer -- --buy-copy --write --confirm
```

购买前应确认：挑战窗口已结束、状态为 `Listed`、Listing active、余额足够、allowance 足够。脚本默认使用 Listing 链上当前价格，不会接受不匹配价格。错误 expected price 的拒绝分支使用 `eth_call`，不会消耗 Gas；购买成功后会再次查询 NFT balance 和 `hasAccess`。

Exclusive 测试使用：

```bash
npm run live:base-sepolia:buyer -- --buy-exclusive --write --confirm
```

该操作是终态销售，建议只在专用 Dataset 上执行。不要在承载真实用户资金的 Dataset 上运行购买写测试。

### 第七步：Claimant Manifest 和 Claim

Claimant 查询：

```bash
npm run live:base-sepolia:claimant
```

脚本会从链上读取 `weightsURI` 和 `weightsManifestHash`，下载精确文件字节，并在 Node.js 中独立检查：

- schema、Dataset ID、Chain ID、DatasetRegistry 地址；
- Leaf 编码和 sorted Merkle pair 规则；
- `totalWeight`、`weightsRoot`、每个 weight；
- 地址唯一、weight > 0、单个 weight 不超过 totalWeight；
- 全部 weight 之和严格等于 totalWeight；
- 每个 claimant proof 能回到链上 root；
- Manifest 原始字节的 keccak 与链上 commitment 一致。

验证通过后会查询 `claimed`、`claimable`、`cumulativeRevenue`、`unclaimedRevenue`、全局 contributorBalance 以及支付 Token backing。真实 Claim：

```bash
npm run live:base-sepolia:claimant -- --claim --write --confirm
```

该命令只使用 Manifest 中与签名者地址匹配的 leaf 和 proof。Claim 成功后会再次检查 `claimed`、`claimable` 和 Token 余额。由于 RevenueSplitter 按 Dataset 维护 `unclaimedRevenue`，验收报告应确认某 Dataset 的 claim 不会减少另一个 Dataset 的隔离余额。

### 第八步：Treasury 和 Gateway

Treasury 读取：

```bash
npm run live:base-sepolia:treasury
```

提取是 permissionless 的合约函数，但只发送到配置中的 Treasury。只在有明确 treasury 余额、且已记录余额前后差异时运行：

```bash
npm run live:base-sepolia:treasury -- --withdraw --write --confirm
```

Gateway 读取：

```bash
npm run live:base-sepolia:gateway
```

它会核对 Gateway signer、payload URI 和指定主体的 `hasAccess`。签名验证、加密数据读取、SLA、存储可用性和密钥发放仍需在 Gateway 独立运营验收中完成。

## 5. 全量只读运行

确认 `.env` 已填入完整部署地址后，可以运行：

```bash
npm run live:base-sepolia:all
```

全量脚本按 inspect → admin → timelock → contributor → operator → buyer → claimant → treasury → gateway 顺序串行执行。它会运行所有公开查询，但不会自动广播注册、Listing、购买、Claim、提款或治理交易。任何一个角色的 `FAIL` 都会让进程以非零状态退出。

## 6. 测试报告和判定

报告文件至少记录：

- 目标 RPC、Chain ID、区块高度；
- 合约地址和 runtime code hash；
- 配置、wiring、角色成员集合、Safe 参数；
- Dataset、Listing、NFT、Revenue、Token 余额和 Manifest 验证结果；
- 每个步骤的 PASS/FAIL/SKIP、耗时、交易哈希和区块；
- 失败原因或跳过原因。

验收判定规则：

1. `inspect` 的严格部署验收必须 PASS；
2. 任何未配置私钥导致的角色写测试可为 SKIP，但不能标记为 PASS；
3. 真实写入必须在报告中有交易哈希，并在写入后重新查询状态；
4. Manifest 下载失败、摘要不一致、root 不一致、重复地址或权重总和错误必须 FAIL；
5. Safe 操作只生成 calldata 不算 Safe 已执行，必须补充 Safe 实际执行交易哈希；
6. 所有测试通过不等于完成外部智能合约审计、Gateway 运营验收或生产发布。

## 7. 安全和故障排查

### RPC 或网络错误

确认 `BASE_SEPOLIA_RPC_URL` 返回 `84532`。默认不允许用 `--skip-chain-check`；该参数只用于诊断，不能作为验收通过依据。

### 地址或 ABI 错误

确认已执行 `npm run compile`，并且地址全部来自同一部署输出。代理地址应填写 Proxy 地址，不要把 implementation 地址填入 `REVENUE_SPLITTER` 或 `MARKETPLACE`。

### Safe 查询显示 unavailable

如果 `ADMIN_MULTISIG` 没有 Safe runtime code，Safe owner、threshold、modules 等查询无法验收。临时 EOA 管理员只能作为本地/明确测试例外，不能作为生产发布证明。

### Claimable 为 0

依次检查挑战窗口、ChallengeStatus、`weightsInvalidated`、Manifest claimant 地址、proof、`cumulativeRevenue` 和 `unclaimedRevenue`。购买前领取必然失败，因为销售尚未产生收入；挑战 Pending 或 Upheld 时也必须 fail-closed。

### 写入被拒绝

确认命令同时包含 `--write --confirm`，且 `.env` 设置 `ALLOW_BASE_SEPOLIA_WRITES=true`。再检查签名者地址是否与对应角色配置一致、余额和 allowance 是否足够、Dataset 是否处于允许的状态。不要为了让脚本通过而关闭合约的拒绝条件。

## 8. 与自动化测试的关系

本套 Node.js 脚本是 Base Sepolia 的真实 RPC/真实账户验收层；它不能替代仓库现有的 Hardhat 单元、集成、覆盖率、部署验证、Manifest 验证和依赖审计。发布前仍必须执行：

```bash
npm run ci
npm run verify:deployment -- --network baseSepolia
```

真实 Base Sepolia 部署、Safe 六笔 onboarding/wiring 交易、完整链上验证、独立合约审计和 Gateway/Pipeline 运营验收都必须分别留存证据。

# Main Protocol Web V1 逐角色测试与验收计划

## 1. 测试目标

使用当前 Web、当前 ABI、Base Sepolia 配置和链上角色，验证：

1. 所有人可以读取公开 Dataset、Listing、Manifest commitment 和访问结果。
2. Buyer 只能走固定价 Copy/Exclusive 流程，包含 approve、价格保护、deadline 和购买后权益检查。
3. Contributor 只能登记自己的 Dataset，并管理自己 Dataset 的 Listing。
4. Pipeline Operator 只能代表 `operatorContributor` 映射的 Contributor 登记，不能管理 Listing。
5. Claimant 使用 Manifest 的 weight/proof 领取对应 Dataset 收入，不能跨 Dataset 透支。
6. ADMIN 只能执行管理员介导 Challenge 和紧急暂停/恢复；Challenge 不被描述为 permissionless。
7. Treasury 只能提取 treasuryBalance；不能触碰 contributorBalance、unclaimedRevenue 或 division dust。
8. Gateway 只能读取 `hasAccess` 和公开配置；不能 mint、pause、claim 或绕过 entitlement。
9. Timelock 的 schedule/execute 遵守链上最小延迟，不能用角色页面绕过治理。
10. Web 的 release guard、chain guard、地址 wiring guard 或角色 guard 失败时，写操作全部禁用。

## 2. 测试账号现状（测试开始前已核对）

历史 `.env.account` 槽位曾复用地址；本轮不再用它们证明业务身份。当前 `.env` 的业务账号由脚本逐一派生地址并校验，Admin authority 使用官方 Safe：

| 配置/角色                                                 | 当前职责                        | 验收方式                           |
| --------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| `ADMIN_MULTISIG`                                          | Safe 2/2 `ADMIN_ROLE` authority | 两名 Safe owner 签名并由 Safe 执行 |
| `GATEWAY_SIGNER_ADDRESS`                                  | Gateway signer                  | 只读 Gateway 边界验收              |
| `NURTURE_CONTRIBUTOR_ADDRESS`                             | 初始 Contributor                | 初始角色唯一性和 Dataset 归属验收  |
| `PIPELINE_OPERATOR_ADDRESS`                               | Pipeline Operator               | 代表 Nurture 注册 Dataset          |
| `BUYER_ADDRESS` / `CLAIMANT_ADDRESS` / `TREASURY_ADDRESS` | 业务测试账号                    | 分别执行购买、Claim、Treasury 流程 |

历史槽位和重复导入同一私钥不能作为独立身份证据。

### 2.1 当前部署的业务账号与 Safe

根目录 `.env` 配置了业务测试账号；当前发布基线使用官方 Safe 作为 `ADMIN_ROLE` authority，不能把 Safe owner 误写成协议 Admin EOA：

| 业务角色    | 环境变量                                          | 当前用途                      |
| ----------- | ------------------------------------------------- | ----------------------------- |
| Buyer       | `BUYER_PRIVATE_KEY` / `BUYER_ADDRESS`             | 购买者和 Safe owner 之一      |
| Claimant    | `CLAIMANT_PRIVATE_KEY` / `CLAIMANT_ADDRESS`       | Manifest claimant             |
| Contributor | `CONTRIBUTOR_PRIVATE_KEY` / `CONTRIBUTOR_ADDRESS` | 当前 Nurture/初始 Contributor |
| Operator    | `OPERATOR_PRIVATE_KEY` / `OPERATOR_ADDRESS`       | Pipeline Operator             |
| Treasury    | `TREASURY_PRIVATE_KEY` / `TREASURY_ADDRESS`       | 测试 Treasury 执行账号        |

`DEPLOYER_PRIVATE_KEY` / `DEPLOYER_ADDRESS` 是部署账号，也是 Safe owner 之一；`ADMIN_MULTISIG` 是 Safe 地址，不是可直接签名的 EOA。所有这些私钥均已在本地做地址一致性校验；校验只输出派生地址和 match 结果，不输出私钥。

测试规则：

- 私钥只在本地脚本或钱包扩展的安全导入界面使用，绝不写入 Web、Manifest、报告、截图、命令输出或 Git。
- 浏览器 Web 页面不读取 `.env`，也不接收私钥输入；页面只使用注入的钱包账户签名。
- 真实私钥导入浏览器扩展属于敏感凭证操作，必须在扩展弹窗中由用户确认后进行。
- 当前 Web 使用源码版本 `baseSepolia-20260819052231325-45674331`，Web 配置为 `current-verified`、官方 Safe 2/2 authority、48 小时 Timelock 和 `writeEnabled=true`；角色脚本只用于链上测试账号签名，浏览器页面不接收私钥。

## 3. 测试前置条件

### 3.1 当前配置门槛

- Chain ID `84532`，Base Sepolia。
- 使用 `web/config/base-sepolia.json` 的公开地址和 ABI。
- 当前 Web 必须显示 `current-verified`、Base Sepolia、Safe 2/2 和 48 小时 Timelock。
- 当前 Safe-backed 部署已经完成 onboarding/wiring；7 天 Challenge window 是正式 V1 配置，购买/Claim 必须等待窗口结束或使用另一套专用测试部署。

### 3.2 完整角色测试所需账号

建议准备至少 5 个**唯一地址**，并明确分配：

| 角色             | 必须条件                                                       |
| ---------------- | -------------------------------------------------------------- |
| Admin            | 持有 `ADMIN_ROLE`；生产必须是 Safe，测试网可显式 EOA 例外      |
| Contributor      | 持有 `CONTRIBUTOR_ROLE`；与 Admin/Operator/Buyer 不同          |
| Operator         | 持有 `OPERATOR_ROLE`，映射到 Contributor；不能持有 Contributor |
| Buyer            | 无特殊角色，有 USDC 和 gas；与 Contributor 不同                |
| Claimant         | 在专用 Dataset Manifest 中有自己的 leaf/proof；与 Buyer 不同   |
| Treasury/Gateway | 可以复用只读身份，但资金提取和 Gateway 边界应单独记录          |

如果沿用当前 `.env.account`，必须把 Buyer、Claimant 和独立 Contributor 作为新增测试账号配置，而不是重复导入相同私钥。

## 4. 测试任务清单

### T0：静态 Web 工件

- [x] `npm run web:test` 通过（15 项）。
- [x] `node --check web/app.js` 通过。
- [x] ABI 保留五参数 `DatasetRegistered`。
- [x] ABI 不包含 `WeightsManifestCommitted`、`bid`、`settle` 或 `createAuction`。
- [x] Web 配置不包含私钥、助记词、Secret 或部署者凭证。
- [x] role capability 测试通过：Public、Contributor、Operator、Admin、Timelock、Treasury 和 Safe relay。
- [x] role capability 测试覆盖 Treasury；Treasury capability 只由 `ProtocolConfig.treasury()` 地址获得。

### T1：Public / Read-only

- [x] 未连接钱包打开 Overview、Datasets、Access Check、Activity（浏览器冒烟通过）。
- [x] 读取 Chain ID、合约代码、wiring、fee、pause、challenge window 和 Timelock delay（链上预检通过）。
- [x] Dataset 列表使用 `nextDatasetId()` 临时遍历；生产版切换 Indexer。
- [x] Dataset detail 代码支持读取 `weightsURI`、`weightsManifestHash`、`challengeStatus`、`unclaimedRevenue`。
- [x] Public 不显示可用的 Contributor/Admin/Timelock 写按钮；角色页面在 release guard 下的写按钮为 disabled。
- [x] 当前浏览器未注入钱包时触发未连接钱包 guard；配置本身为 `current-verified`，不把当前 Safe-backed 部署误标为历史部署。

### T2：Buyer

- [x] 独立 Buyer 脚本确认 chainId、USDC balance 和 Marketplace allowance。
- [x] 前一套 EOA 测试部署的 Dataset #2 完成 approve + `buyCopy`，验证 Copy NFT、`copiesSold`、RevenueAccrued 和购买后 access。
- [x] Buyer 脚本用 `eth_call` 验证 stale expectedPrice 拒绝；合约测试覆盖 deadline、inactive、Pending/Upheld 和重复购买拒绝。
- [x] 前一套 EOA 测试部署的 Dataset #4 完成 approve + `buyExclusive`，两类 Listing 关闭，状态为 `ExclusivelySold`，Buyer 获得 Exclusive access。
- [x] 隔离 Base Sepolia E2E 部署使用 60 秒 Challenge window；浏览器 Buyer 完成 Approve + `buyCopy`，Approve `0x046b…71da`、购买 `0xe0a9…4e14` 已确认。
- [x] 浏览器购买后通过 Access Check 验证 Buyer `hasAccess = true`；默认 Safe-backed 部署仍保留 7 天窗口，不被测试部署替代。
- [x] Contributor 通过页面完成 Copy 下架、Exclusive 上架；Buyer 完成 Approve + `buyExclusive`，交易 `0xb71f…527a` 已确认并进入终态。

### T3：Contributor

- [x] 独立 Contributor 确认 `CONTRIBUTOR_ROLE`，并用真实 Manifest 校验 chain、Registry、Dataset、root、totalWeight、唯一地址和严格总和。
- [x] Operator 代表该 Contributor 完成 Dataset #2–#5 `registerDataset`，并读取五参数 `DatasetRegistered` 对应 Dataset 状态。
- [x] Contributor 完成 Dataset #4 Exclusive listing、Dataset #3 Copy listing 以及 Copy delist；固定价格只能通过 delist/relist 改变。
- [x] 其他 Contributor 所有权拒绝由合约测试覆盖；当前真实测试部署仅配置一个业务 Contributor。

### T4：Pipeline Operator

- [x] 独立 Operator 确认 `OPERATOR_ROLE` 和 `operatorContributor(operator)` 映射。
- [x] Operator 使用真实签名代表 Contributor 登记 Dataset #2–#5；Contributor/Operator 能力分离由链上角色和自动化测试验证。
- [x] Pipeline 同时持有 Contributor 的直接授予场景会使初始角色验收失败；当前 live-test verifier 显式期望测试 Operator/Contributor 集合并仍拒绝 Operator 持有 Contributor。

### T5：Claimant

- [x] 独立 Claimant 下载并验证 Dataset #2/#5 Manifest 原始字节 hash、绑定字段、leaf、weight 和 proof。
- [x] 前一套 EOA 测试部署 Dataset #2 执行真实 `claim`，验证 Claimant token balance、账本和 Dataset `unclaimedRevenue`。
- [x] Dataset #5 权重失效后执行 Claim 拒绝验证；恶意超额权重跨 Dataset 隔离由 RevenueSplitter 自动化测试覆盖。

### T6：Admin

- [x] 官方 Safe 2/2 以真实双 owner 签名完成 onboarding/wiring、pause/unpause；页面和报告均标记为 Base Sepolia testnet，不把测试 Safe 误称为生产治理。
- [x] Web Safe hash/signature/execTransaction 流程已由两个浏览器 owner 会话真实执行；第一 owner 收集 1/2，第二 owner 完成 2/2 Safe 广播。
- [x] 浏览器 E2E 钱包桥接器已完成真实 UI 验收；桥接器只在本地 RPC 服务端使用测试私钥，不把私钥注入网页。
- [x] Dataset #3 完成真实 `recordChallenge` + `resolveChallenge(false)`；Dataset #5 完成真实 `recordChallenge` + `resolveChallenge(true)`，验证 evidence/hash、Pending、Rejected/Upheld、权重失效和 Listing 关闭。
- [x] 完成 pause/unpause；Pending/Upheld 购买和 Claim 拒绝由链上自动化测试及 Dataset #5 真实 Claim 拒绝覆盖。

### T7：Treasury

- [x] Web Treasury 页面读取 treasury、Splitter 账本和 payment-token backing；非 Treasury 地址按钮保持 disabled。
- [x] 隔离 E2E 部署的 Treasury 页面读取 `0.025 USDC` 并真实执行 `withdrawTreasury`，交易 `0x9476…24e8` 已确认；重复空余额提款按规则拒绝。
- [x] 第二笔 Exclusive 收入后的 Treasury `withdrawTreasury` 再次成功，交易 `0x326a…7a13` 已确认。
- [x] Gateway signer 浏览器会话验证 Buyer `hasAccess=true`、随机地址 `false`，并确认 Admin/Treasury capability locked。
- [x] Buyer 已失效 Listing、Claimant 错误 proof/重复 Claim、Contributor 终态 Listing、Operator 非 Contributor 管理项和非法 Manifest 均完成页面提交/校验拒绝。
- [x] 隔离 Admin 重复 Unpause、Challenge window 关闭后的 Challenge 均完成页面提交拒绝。
- [x] 前一套 EOA 测试部署通过 Timelock 将测试 Treasury 切换为独立地址，再由 Treasury 账号真实执行 `withdrawTreasury`；合约测试验证 contributorBalance/unclaimedRevenue/dust 隔离。当前 Safe-backed 发布基线的 Timelock 延迟为 48 小时，尚未绕过等待期执行新的治理变更。
- [x] 错误 Treasury/rescue 边界由合约测试覆盖。

### T8：Gateway boundary

- [x] Gateway 脚本读取 signer、payloadURI 和 `hasAccess`；Buyer entitlement 返回 true，随机无 entitlement 地址返回 false。
- [x] Gateway signer 不能 mint、pause、claim 或修改 Dataset；Web 只展示边界，不实现解密或密钥托管。

### T9：ProtocolTimelock

- [x] 读取 `getMinDelay`、角色成员并生成 Safe/Timelock calldata。
- [x] Web Safe relay 的 Timelock `schedule` 已由两个浏览器 Safe owner 会话真实签名并确认，交易 `0xb7d6…3250`；只验证 48 小时 Safe-backed schedule 参数，不绕过等待期 execute。
- [x] 隔离 E2E Governance 页面以 60 秒测试延迟真实完成 schedule `0x5499…840a`、等待到期和 execute `0xf1ac…0647`；默认 Safe-backed 48 小时 Timelock 未被缩短。
- [x] 前一套 Base Sepolia 测试部署的 Timelock 真实完成 treasury 配置变更并经过 60 秒测试延迟；当前 Safe-backed 发布基线读取到 48 小时最小延迟。完整延迟、越权、UUPS 和 Safe 2/2 流程由自动化测试覆盖。

## 5. 执行顺序与证据

1. 先执行 T0/T1，确认 Web 自身和只读链路正常。
2. 账号唯一性、余额和链上角色通过后，再执行 T2–T9。
3. 每一步保存：钱包地址（可公开）、chainId、区块号、交易哈希、页面结果、合约事件和报告 JSON。
4. 任何 `SKIP` 不计为通过；任何历史部署/发布校验失败都必须标记为“阻塞写验收”。
5. 只在专用 Dataset 上执行 Challenge upheld、Exclusive 购买、Treasury 提款和不可逆状态测试。

## 6. 当前执行结论

- 已确认 `.env` 的 Buyer、Claimant、Contributor、Operator、Treasury 是 5 个独立业务账号；Admin 使用单独的 Deployer/Admin 测试账号。私钥未提交仓库。
- 本轮通过本地测试钱包桥接器完成浏览器 UI 的真实角色提交；桥接器不向页面暴露私钥。默认 Safe-backed 页面仍保持生产发布配置，隔离 E2E 配置单独标明 60 秒测试窗口。
- 合约回归测试通过 `156 passing`，覆盖 Buyer、Contributor、Operator、Claimant、Admin、Treasury、Gateway boundary、Timelock、Challenge、Manifest、RevenueSplitter 隔离和部署校验。
- `npm run web:test:live` 通过 `32 PASS / 0 FAIL / 0 SKIP`；五个业务账号地址、余额、wiring、配置和角色读取均通过。
- 当前源码已重新部署到 Safe-backed Base Sepolia，并通过 `verify:deployment` 的 `deployment-initial-state` 严格验收；当前链上已有 Dataset #1，Safe 为 2/2、Timelock 为 172800 秒，部署 ID 为 `baseSepolia-20260819052231325-45674331`。
- 浏览器公开页面和角色页面均通过；隔离 E2E 部署已完成 Operator 注册、Contributor Listing、Buyer Approve/buyCopy、Claimant preview/claim、Treasury withdraw、Access Check、重复 Claim/空 Treasury 拒绝和直接 Admin Pause/Unpause。
- 隔离 E2E 部署随后完成 Copy → Exclusive Listing 切换、Buyer `buyExclusive`、增量 Claim（`0xcf54…d644`）和第二次 Treasury 提取，固定价两条购买路径均通过浏览器真实提交验收。
- 默认 Safe-backed 部署已完成 Operator 注册、Contributor Listing、Safe 2/2 Challenge record、Rejected/Upheld resolve、Pause/Unpause 和 Timelock schedule；默认部署的 7 天窗口仍未被缩短，未把隔离 E2E 结果冒充为默认发布基线结果。

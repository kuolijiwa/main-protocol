# Main Protocol Web V1 开发方案

## 1. 目标与边界

本 Web 是 Main Protocol 固定价 V1 的操作入口，直接使用仓库 `ABI/` 中的 ABI 和批准的 Base Sepolia 部署配置。它不是 Batch Pipeline、Access Gateway 或 Indexer 的替代品：

- Web 负责钱包连接、链上读取、交易构建、权限展示、交易状态和公开数据浏览。
- Pipeline 负责计算权重、生成和发布 Weights Manifest；Web 只负责上传前本地校验和登记参数提交。
- Gateway 负责签名、解密、密钥交付和 payload 可用性；Web 只提供 `hasAccess` 检查和公开资源入口。
- Indexer 负责生产级 Dataset 发现、确认数、重组处理和事件补全；V1 Web 在没有 Indexer 时使用 `nextDatasetId()` 做测试网遍历。
- 不实现拍卖、`bid`、`settle`、动态定价、Permissionless Challenge、挑战保证金、Crowdsourcing 或二级市场。

## 2. 当前发布基线

### 2.1 网络与地址

- Base Sepolia Testnet，Chain ID `84532`。
- RPC：`https://base-sepolia-rpc.publicnode.com`。
- Marketplace 和 RevenueSplitter 必须使用代理地址。
- 地址来源：`ABI/base-sepolia.addresses.json`。
- ABI 来源：`ABI/*.abi.json`。

### 2.2 当前部署保护

`web/config/base-sepolia.json` 当前绑定 `baseSepolia-20260819052231325-45674331`，并标记为 `current-verified`、Safe 2/2、48 小时 Timelock。启动校验失败时进入只读模式，禁止发送交易；任何历史部署配置都不得开启写操作。

## 3. 页面与模块

### 3.1 公共页面（所有人可查看）

1. **Overview**：网络、部署状态、暂停状态、手续费、Challenge window、Timelock delay、合约地址和公开 Dataset 数量。
2. **Datasets**：Dataset 列表、状态、Contributor、标签、Copy/Exclusive Listing、公开 sample 链接、Manifest 状态。
3. **Dataset Detail**：完整 Dataset、Manifest commitment、Challenge 状态、Listing、收入公开统计、访问状态、Basescan 链接。
4. **Access Check**：输入 Dataset ID 和地址，读取 `hasAccess`；不绕过 Gateway，不显示私钥或解密材料。
5. **Activity**：读取已加载页面的交易和事件反馈；生产版由 Indexer 替换为确认事件流。

### 3.2 Buyer 页面

权限：钱包已连接即可显示；购买函数仍由合约最终校验。

- 读取 USDC decimals、余额、Marketplace allowance。
- Copy License 购买：重新读取 Listing、价格确认、deadline、approve、buyCopy。
- Exclusive Title 购买：重新读取 Listing、价格确认、deadline、approve、buyExclusive。
- 展示审计窗口、Challenge、暂停、卖家 fee 快照等不可购买原因。
- 购买后读取 ERC-1155 balance 和 `hasAccess`。
- 不展示 auction、bid 或无保护的一参数购买入口。

### 3.3 Contributor 页面

权限：持有 `CONTRIBUTOR_ROLE`，且地址等于 Dataset contributor。

- Dataset 登记表单：顺序 Dataset ID、content hash、sample/payload URI、Weights Manifest URI/hash、root、totalWeight、SalePolicy、tag。
- Manifest 文件选择和本地校验：schema、chainId、Registry、datasetId、root、totalWeight、地址唯一、权重正数、权重和严格相等。
- Listing：固定价 Copy / Exclusive 上架；价格在合约中自动快照 feeBps。
- Delist：暂停期间仍允许；上架/下架按钮按 Dataset contributor 身份显示。
- 成功后按五参数 `DatasetRegistered` 事件和链上 getter 刷新。

### 3.4 Pipeline Operator 页面

权限：持有 `OPERATOR_ROLE`，且 `operatorContributor(wallet)` 指向仍持有 Contributor 角色的地址。

- 显示当前 allowlisted Contributor。
- 使用同一登记表单提交 Dataset；不允许前端伪造 contributor 参数。
- 记录中将 Contributor 归属解释为合约根据 caller 映射得到的地址。
- Operator 不获得 Listing、Challenge、pause 或角色管理权限。

### 3.5 Claimant 页面

权限：连接钱包即可查询自己的 claimable；只有提供有效 weight/proof 且合约校验通过才可领取。

- 读取 Manifest URI/hash，指导用户获得 `(address, weight, proof)`。
- 输入 Dataset ID、weight、Merkle proof。
- 先调用 `claimable(datasetId, wallet, weight)` 做预览，再调用 `claim`。
- 展示 cumulativeRevenue、unclaimedRevenue、已领取金额和 Dataset 隔离余额。
- Web 不接受未绑定 Dataset/chain/Registry 的 Manifest，不把管理员人工联系作为唯一发现路径。

### 3.6 Admin 页面

权限：持有 `ADMIN_ROLE`。

- Dataset Challenge：输入 datasetId、evidenceHash、evidenceURI，调用 `recordChallenge`。
- Challenge resolution：调用 `resolveChallenge(datasetId, upheld)`；显示 24 小时 intake SLA、72 小时 resolution due time 和 Pending fail-closed 规则。
- Pause / Unpause：调用 ProtocolConfig 对应方法。
- Contributor/Operator 只读成员列表和 operator 映射；角色 grant/revoke 仅在配置允许且明确显示风险。
- 当前 Base Sepolia 使用官方 Safe 2/2；Safe owner 不能绕过 Safe 直接调用 `ADMIN_ROLE` 函数，网页管理员交易必须通过 Safe 流程。

### 3.7 Treasury 页面

权限：连接的钱包地址必须等于链上 `ProtocolConfig.treasury()`。

- 读取 `treasuryBalance`、`contributorBalance`、Treasury 地址和支付 Token backing。
- 仅提供 `withdrawTreasury()`，不接受 amount 参数。
- 明确显示 Contributor 未领取收入、Dataset `unclaimedRevenue` 和 division dust 不可由 Treasury 提取。
- 非 Treasury 钱包只能读取，按钮必须禁用；不提供 `rescueToken`。

### 3.8 Governance Timelock 页面

权限：读取所有人可见；schedule 需要 `PROPOSER_ROLE`，execute 需要 `EXECUTOR_ROLE`。

- 显示 `getMinDelay`、`enforcedMinimumDelay`、operation state、timestamp。
- 提供高级 schedule/execute 表单，要求用户输入 target、value、ABI calldata、predecessor、salt、delay。
- 提交前显示 operation ID，并要求 delay 不低于链上 enforced minimum。
- 不提供绕过 Timelock 的配置或升级入口。

## 4. 权限模型

前端权限只影响页面和按钮显隐，不能替代合约授权。启动读取角色常量，不硬编码 role hash：

| 能力                      | Public     | Buyer | Contributor | Operator                  | Admin      | Timelock          |
| ------------------------- | ---------- | ----- | ----------- | ------------------------- | ---------- | ----------------- |
| 浏览 Dataset / Listing    | ✓          | ✓     | ✓           | ✓                         | ✓          | ✓                 |
| 购买 Copy / Exclusive     | 连接钱包后 | ✓     | ✓           | ✓                         | ✓          | ✓                 |
| 登记 Dataset              | -          | -     | ✓           | ✓（代表映射 Contributor） | -          | -                 |
| 管理自己 Listing          | -          | -     | ✓           | -                         | -          | -                 |
| Claim 收入                | 连接钱包后 | ✓     | ✓           | ✓                         | ✓          | -                 |
| Challenge record/resolve  | -          | -     | -           | -                         | ✓          | -                 |
| Pause / Unpause           | -          | -     | -           | -                         | ✓          | -                 |
| Treasury withdrawal       | -          | -     | -           | -                         | -          | Treasury address  |
| 角色与 Operator 映射      | -          | -     | -           | -                         | ✓          | Timelock 约束治理 |
| Timelock schedule/execute | -          | -     | -           | -                         | 依链上角色 | 依链上角色        |
| `hasAccess` 查询          | ✓          | ✓     | ✓           | ✓                         | ✓          | ✓                 |

## 5. 技术实现

### 5.1 目录

```text
web/
  index.html                 单页壳和页面容器
  styles.css                 深色协议控制台样式
  app.js                     钱包、读取、交易、页面渲染
  config/base-sepolia.json   公开网络和地址配置
  src/permissions.mjs        角色能力纯函数
  src/manifest.mjs           Manifest 结构和分配校验纯函数
  test/*.test.mjs            Web 单元测试
```

当前实现使用浏览器 ESM 加载 ethers 6.17.0；ABI 通过静态 HTTP 从仓库 `ABI/` 加载，不把完整 Hardhat artifacts 打包进 Web。后续若引入 React/Vite，只迁移 `web/src` 和协议适配层，不改变合约接口。

### 5.2 启动校验

启动顺序：

1. 校验钱包 chainId（未连接时用公共 RPC）。
2. 校验核心地址有 runtime code。
3. 校验 `paymentToken()`、Marketplace/RevenueSplitter 依赖反向绑定。
4. 校验各合约 `governanceTimelock()` 一致。
5. 校验 Manifest/Challenge schema version。
6. 读取动态 fee、challenge window、paused、Timelock delay。
7. 角色读取完成后计算页面权限。
8. 任意硬失败进入只读故障模式；只读页面仍可访问。

### 5.3 交易安全

- 所有金额和 Dataset ID 使用 `bigint`。
- 购买前重新读取 Listing，要求 expectedPrice 和 deadline。
- approve 的 spender 固定为 Marketplace proxy。
- 交易前执行 `estimateGas`/模拟读取，失败时显示合约自定义错误。
- 交易后等待 receipt，再刷新状态。
- 所有写操作受 release guard、chain guard、pause guard 和角色 guard 共同控制。
- Safe-backed 部署中，Safe owner 先计算 Safe transaction hash，再收集 threshold 个 owner 签名，按 owner 地址排序后由 Safe `execTransaction` 执行；Safe owner 不会被当作直接 `ADMIN_ROLE` 或 Timelock 成员调用。
- 自动化浏览器验收可使用 `npm run web:e2e:wallet-bridge`：私钥只在本地 Node signer 进程中读取，页面只接收标准 EIP-1193 请求；该桥接器仅用于测试，不得部署到生产环境。
- `.env`、私钥、Gateway signer 私钥、Pipeline 私钥绝不进入 `web/`。

## 6. 开发、测试和验证

### 6.1 单元测试

- 权限矩阵：public/buyer/contributor/operator/admin/timelock 显隐正确。
- Manifest：chainId、Registry、Dataset ID、root、totalWeight 绑定；重复地址、零权重、错误总和、错误 schema 拒绝。
- 金额和时间：6 decimals、feeBps、deadline 秒级转换。
- 交易能力：旧部署/release guard 或错误 chain 禁止写入。
- 事件兼容：只识别五参数 `DatasetRegistered`，不依赖 `WeightsManifestCommitted`。

### 6.2 合约集成验证

复用当前 Hardhat 测试和 ABI：

- ContributorRegistry、ProtocolConfig、DatasetRegistry、EntitlementNFT、RevenueSplitter、Marketplace、ProtocolTimelock 回归测试全部通过。
- 固定价 Copy/Exclusive 购买、approve、claim、challenge、pause、timelock、manifest 绑定和 Dataset 隔离流程通过。
- Web 页面交易调用使用当前代理地址，不调用 implementation。

### 6.3 测试网验收

在部署当前源码并生成新 deployment record 后：

1. `npm run compile`、`npm test`、`npm run typecheck`。
2. `npm run export:frontend-abi`，校验 ABI manifest。
3. `npm run web:test`。
4. `npm run web:dev`，浏览器连接 Base Sepolia。
5. 只读启动校验通过后，分别用 Buyer/Contributor/Operator/Claimant/Treasury 测试账号执行页面流程；Admin/Timelock 使用两名 Safe owner 逐一收集签名后执行。
6. 检查 Basescan receipt、五参数 DatasetRegistered、Manifest getter 和交易后状态。
7. 旧部署或任一 release guard 失败时，验收必须证明写操作按钮禁用。

## 7. 交付阶段

- **阶段 1（本次）**：方案、静态 Web 壳、公共 Dashboard/Dataset、钱包与角色权限、Manifest 校验、真实 ABI/地址装载、只读 release guard、测试。
- **阶段 2**：完整 Contributor/Operator 登记、Buyer approve/购买、Claim、Admin Challenge/Pause、Timelock 高级操作。
- **阶段 3**：Indexer 替换临时遍历、Safe SDK、Gateway API、Manifest/Challenge 证据存储适配。
- **阶段 4**：当前源码重新部署、链上验证、全角色测试网验收、独立安全评审后开启生产写入。

本次阶段 1 交付不会把历史 Base Sepolia 部署标记成当前源码的生产发布，也不会把未实现的拍卖或 Permissionless Challenge 暴露为可用功能。

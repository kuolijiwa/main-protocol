# Main Protocol V1 — ADMIN 运营多签操作手册

## 1. 角色定位

`ADMIN_ROLE` 是 Main Protocol 的即时运营权限，生产环境应由 Safe 等多签合约持有，不应由部署 EOA 长期持有。

ADMIN 多签负责日常运营和紧急控制，但不负责延迟治理配置和 UUPS 升级。后两类操作必须通过 `ProtocolTimelock`。

## 2. ADMIN 可以执行的操作

### ContributorRegistry

- 管理 `OPERATOR_ROLE` 成员；
- 管理 `CONTRIBUTOR_ROLE` 成员；
- 设置或清除操作员与贡献者的映射：

  ```solidity
  ContributorRegistry.setOperatorContributor(operator, contributor)
  ```

### ProtocolConfig

- 立即暂停：

  ```solidity
  ProtocolConfig.pause()
  ```

- 立即恢复：

  ```solidity
  ProtocolConfig.unpause()
  ```

### DatasetRegistry

- 记录挑战：

  ```solidity
  DatasetRegistry.recordChallenge(datasetId, evidenceHash, evidenceURI)
  ```

- 裁决挑战：

  ```solidity
  DatasetRegistry.resolveChallenge(datasetId, upheld)
  ```

### 初始化和依赖 wiring

部署阶段由 ADMIN 多签按顺序执行：

1. `grantRole(CONTRIBUTOR_ROLE, NURTURE_CONTRIBUTOR)`；
2. `grantRole(OPERATOR_ROLE, PIPELINE_OPERATOR)`；
3. `setOperatorContributor(PIPELINE_OPERATOR, NURTURE_CONTRIBUTOR)`；
4. `DatasetRegistry.setMarketplaceOnce(MARKETPLACE)`；
5. `EntitlementNFT.setMarketplaceOnce(MARKETPLACE)`；
6. `RevenueSplitter.setMarketplaceOnce(MARKETPLACE)`。

部署脚本在部署者不是 ADMIN 多签时，会按上述顺序输出 `adminTransactions`。必须通过 Safe 按顺序执行，不能改变顺序或跳过中间交易。

## 3. ADMIN 不能执行的操作

以下操作不能由 ADMIN 直接执行：

- `ProtocolConfig.setFeeBps`；
- `ProtocolConfig.setTreasury`；
- `ProtocolConfig.setChallengeWindow`；
- `ProtocolConfig.setGatewaySigner`；
- `RevenueSplitter.rescueToken`；
- Marketplace UUPS 升级；
- RevenueSplitter UUPS 升级；
- 直接授予或转移固定的 `DEFAULT_ADMIN_ROLE`。

这些操作必须由 `ProtocolTimelock` 延迟执行。

此外，以下不是 ADMIN 的权限：

- 贡献者创建或撤销自己的 Listing；
- 买家购买 Dataset；
- 子贡献者 Claim 收益；
- `RevenueSplitter.withdrawTreasury`，该函数可由任何地址调用，但只会转给当前 Treasury。

## 4. 部署后的多签检查

部署完成后，确认：

- ADMIN_MULTISIG 是预期 Safe 地址；
- owner 集合和 threshold 与部署配置一致；
- ADMIN 多签持有五个可运营合约的 `ADMIN_ROLE`；
- ADMIN 多签不持有任何核心合约的 `DEFAULT_ADMIN_ROLE`；
- Timelock 的 proposer、executor、canceller 角色均由该多签持有；
- 部署 EOA 不再持有生产权限；
- 初始 `CONTRIBUTOR_ROLE` 只有 `NURTURE_CONTRIBUTOR`；
- `PIPELINE_OPERATOR` 持有 `OPERATOR_ROLE`，但不持有 `CONTRIBUTOR_ROLE`；
- Pipeline 操作员已正确映射到 Nurture。

使用部署输出填充 `.env` 后运行：

```bash
npm run verify:deployment -- --network baseSepolia
```

## 5. 暂停和恢复操作

### 5.1 触发暂停

发现支付币、Marketplace、Dataset、Gateway 或运营密钥存在风险时：

1. 在 Safe 中发起 `ProtocolConfig.pause()`；
2. 收集足够签名并执行；
3. 记录交易哈希、时间和事件；
4. 通知 Pipeline、贡献者、买家支持和 Gateway 运维人员；
5. 进入事件响应流程。

暂停会阻止：

- `registerDataset`；
- 新建 Listing 和重新上架；
- `buyCopy`；
- `buyExclusive`；
- `RevenueSplitter.claim`。

暂停期间仍可执行：

- 只读查询；
- `claimable` 查询；
- 贡献者 `delist`；
- 记录和解决挑战；
- `withdrawTreasury`；
- `pause`/`unpause` 管理操作。

### 5.2 恢复运行

只有在完成以下检查后才能执行 `unpause()`：

- 事件原因已确认；
- 受影响合约地址和 wiring 正确；
- 支付 Token 余额和精确转账行为正常；
- 未发现异常 Dataset 或 Listing；
- Pending Challenge 已按 SLA 处理；
- Gateway 和 Pipeline 已确认可用；
- 恢复决定通过多签审批。

## 6. 挑战处理流程

V1 的挑战对象仅限：

- `weightsRoot`；
- `totalWeight`；
- 重复或缺失叶子；
- `(address, weight)` 分配错误。

数据内容、版权和线下服务争议不通过该链上状态机处理。

### 6.1 记录挑战

1. 从公开入口 `POST /v1/datasets/{datasetId}/challenges` 接收符合 `schemas/weight-challenge-evidence-v1.schema.json` 的证据，并在 24 小时内确认受理；
2. 校验证据涉及目标 Dataset 的权重分配，且证据文件绑定正确的 chain、Registry、Dataset 和 Root；
3. 确认当前时间仍小于 `challengeWindowEndsAt(datasetId)`；
4. 确认状态为 `None` 或 `Rejected`；
5. 将完整材料发布到持续可读取的 `evidenceURI`，按原始文件字节计算非零 `evidenceHash = keccak256(raw bytes)`；
6. 通过多签执行：

   ```solidity
   DatasetRegistry.recordChallenge(datasetId, evidenceHash, evidenceURI)
   ```

7. 核对 `WeightChallengePending` 中的 URI、摘要、版本和 `resolutionDueAt`，并保存交易记录。

### 6.2 裁决挑战

#### 驳回

```solidity
DatasetRegistry.resolveChallenge(datasetId, false)
```

结果：

- 状态变为 `Rejected`；
- 如果挑战窗口已结束，购买和 Claim 可以继续；
- 如果仍在窗口内，仍需等待截止时间；
- 在截止时间前，可以再次记录新的挑战。

#### 支持

```solidity
DatasetRegistry.resolveChallenge(datasetId, true)
```

结果：

- 状态变为 `Upheld`；
- `weightsInvalidated = true`；
- Dataset 变为 `Delisted`；
- Marketplace 原子关闭所有 Listing；
- 永久禁止重新上架、购买和 Claim；
- 修正权重必须注册为新的 Dataset。

由于挑战窗口结束前禁止购买和 Claim，V1 不需要执行销售退款、收入迁移或旧 Dataset 替换。

### 6.3 Pending SLA

每次记录后的固定裁决 SLA 为 72 小时，链上可读取 `challengeResolutionDueAt`。Pending 到期不会自动通过或驳回，会持续阻止购买、Claim 和重新上架，而且 ADMIN 仍可在到期后裁决。ADMIN 必须：

- 监控 24 小时受理 SLA 和 72 小时裁决 SLA；
- 保持 `evidenceURI` 可公开读取，并定期核对 `challengeEvidenceHash`；
- 在逾期时立即触发最高级别告警、公开 SLA 违约状态并升级给治理多签；
- 在裁决前保持 Dataset 的 fail-closed 状态。

## 7. Treasury 运营

`RevenueSplitter.withdrawTreasury()` 不是 ADMIN 专属函数，任何地址都可以调用。它只会把已记录的 `treasuryBalance` 转给当前 `ProtocolConfig.treasury()`，不能提取贡献者收入、未领取收入或除责任之外的 Dust。

ADMIN 应负责监控：

- Treasury 累计余额；
- RevenueSplitter 支付币余额；
- Treasury 变更请求；
- 提现交易和 `TreasuryWithdrawn` 事件。

不要把 `withdrawTreasury` 当作紧急资金提取或支付币修复入口。

## 8. 安全要求

- Safe owner 和 threshold 变更必须单独审查；
- ADMIN 签名设备应使用硬件钱包或受控环境；
- 不在聊天、日志或仓库中保存签名材料；
- 每笔交易先核对目标地址、函数参数和链 ID；
- 不要使用 Implementation 地址作为操作目标；
- 紧急暂停和 Timelock 治理交易必须使用不同的操作流程；
- 所有挑战证据、签名、交易哈希和裁决结果应归档。

## 9. 参考规则

- [角色和权限](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:107)
- [暂停矩阵](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:632)
- [挑战状态机](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:494)
- [部署顺序和 Safe 交易](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:778)

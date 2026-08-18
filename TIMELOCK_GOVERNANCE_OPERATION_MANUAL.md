# Main Protocol V1 — Timelock 治理参与者操作手册

## 1. 角色定位

`ProtocolTimelock` 是 Main Protocol V1 的延迟治理基础设施。治理参与者通过 Timelock 执行协议配置修改和 UUPS 升级，而不是直接调用目标合约。

当前规则：

- 初始最小延迟固定为 48 小时；
- 延迟可以增加，但不能降低到 48 小时以下；
- Timelock 自己是唯一的 `DEFAULT_ADMIN_ROLE` 持有者；
- 运营 ADMIN 多签是 Timelock 的 proposer、executor 和 canceller；
- Timelock 不能把自身固定的 `DEFAULT_ADMIN_ROLE` 授予其他地址；
- Timelock 不能撤销或放弃自身的固定 `DEFAULT_ADMIN_ROLE`。

## 2. Timelock 与 ADMIN 的边界

| 操作                        | 执行角色   | 延迟         |
| --------------------------- | ---------- | ------------ |
| 暂停/恢复协议               | ADMIN 多签 | 立即         |
| 记录/裁决 Dataset Challenge | ADMIN 多签 | 立即         |
| 管理 Contributor/Operator   | ADMIN 多签 | 立即         |
| 初始 Marketplace wiring     | ADMIN 多签 | 初始化流程   |
| 修改手续费                  | Timelock   | 至少 48 小时 |
| 修改 Treasury               | Timelock   | 至少 48 小时 |
| 修改挑战窗口                | Timelock   | 至少 48 小时 |
| 修改 Gateway signer         | Timelock   | 至少 48 小时 |
| Marketplace UUPS 升级       | Timelock   | 至少 48 小时 |
| RevenueSplitter UUPS 升级   | Timelock   | 至少 48 小时 |
| 支付币或其他 Token rescue   | Timelock   | 至少 48 小时 |

Timelock 没有绕过暂停和挑战的即时紧急权限。紧急操作由 ADMIN 多签承担。

## 3. 标准治理交易流程

每一笔 Timelock 治理操作都必须经过：

```text
确认目标和参数
    ↓
计算 operationId
    ↓
ADMIN 多签作为 proposer 调用 schedule/scheduleBatch
    ↓
等待至少 48 小时
    ↓
ADMIN 多签作为 executor 调用 execute/executeBatch
    ↓
读取链上状态和事件
    ↓
归档交易、operationId 和执行结果
```

不能通过直接调用目标合约来替代 Timelock。`ProtocolConfig` 的配置 Setter 和两个 UUPS 合约的升级授权都会直接检查 `msg.sender == ProtocolTimelock`。

## 4. 单目标治理操作

标准 TimelockController 接口：

```solidity
ProtocolTimelock.schedule(
    target,
    value,
    data,
    predecessor,
    salt,
    delay
)
```

等待期结束后：

```solidity
ProtocolTimelock.execute(
    target,
    value,
    data,
    predecessor,
    salt
)
```

操作参数必须完全一致。`target`、`value`、`data`、`predecessor`、`salt` 中任一项变化都会产生不同的 operationId。

建议：

- 每项治理提案使用唯一 `salt`；
- `predecessor` 不需要依赖其他操作时使用零值；
- `delay` 不得低于当前有效的最小延迟；
- schedule 成功后保存 operationId 和 `CallScheduled` 事件；
- 执行前再次读取目标参数并确认没有重复治理操作。

## 5. 批量治理操作

多个相互依赖的修改可以使用：

```solidity
ProtocolTimelock.scheduleBatch(
    targets,
    values,
    payloads,
    predecessor,
    salt,
    delay
)
```

等待完成后调用：

```solidity
ProtocolTimelock.executeBatch(
    targets,
    values,
    payloads,
    predecessor,
    salt
)
```

批量操作必须确保：

- `targets.length == values.length == payloads.length`；
- 所有调用目标和参数已经过多签复核；
- 批量执行失败时理解整批交易的原子回滚行为；
- 每次执行后分别验证各目标合约状态。

## 6. 修改 ProtocolConfig

### 6.1 修改手续费

目标合约：`ProtocolConfig`。

编码调用：

```solidity
ProtocolConfig.setFeeBps(newFeeBps)
```

规则：

- `newFeeBps <= 10_000`；
- 手续费降低会影响后续购买；
- Listing 创建时会保存 `maxFeeBps`；
- 当前手续费高于 Listing 的 `maxFeeBps` 时，该 Listing 不能购买；
- 手续费提高后，贡献者需要撤销并重新创建 Listing，明确接受新的手续费上限。

### 6.2 修改 Treasury

```solidity
ProtocolConfig.setTreasury(newTreasury)
```

`newTreasury` 不能为零地址。变更后，后续 `withdrawTreasury` 会把包括历史累计手续费在内的可提现 Treasury 余额发送到新的 Treasury。

### 6.3 修改挑战窗口

```solidity
ProtocolConfig.setChallengeWindow(newChallengeWindow)
```

`newChallengeWindow` 必须大于零。该变更只影响之后注册的 Dataset；已有 Dataset 使用注册时快照的截止时间。

### 6.4 修改 Gateway signer

```solidity
ProtocolConfig.setGatewaySigner(newGatewaySigner)
```

新地址不能为零。该地址只是 Gateway 的公开签名身份，不是链上访问权限，也不能铸造 NFT 或绕过 `hasAccess`。

## 7. 执行 UUPS 升级

只有以下两个合约使用 UUPS Proxy：

- `Marketplace`；
- `RevenueSplitter`。

升级前必须完成：

1. 编译和完整测试；
2. OpenZeppelin storage-layout 兼容性检查；
3. Implementation 代码审查和安全审查；
4. 确认新 Implementation 地址和字节码；
5. 确认升级不会改变固定 Timelock 授权逻辑；
6. 通过多签创建 Timelock 操作；
7. 等待至少 48 小时；
8. 由多签执行升级；
9. 检查 Proxy 的 ERC-1967 Implementation 地址；
10. 运行部署验证和升级回归测试。

升级调用目标必须是 Proxy 地址，不能直接调用 Implementation 地址。通过 Proxy 执行时，目标合约的 `_authorizeUpgrade` 才会看到 Timelock 作为调用者。

## 8. 修改 Timelock 延迟

`updateDelay(newDelay)` 只能由 Timelock 自己调用，因此必须把它作为 Timelock 对自身的治理操作进行 schedule 和 execute。

```solidity
ProtocolTimelock.updateDelay(newDelay)
```

规则：

- `newDelay >= 48 hours`；
- 可以把延迟提高；
- 不能降低到 48 小时以下；
- Timelock 自身的 `DEFAULT_ADMIN_ROLE` 不可转移。

## 9. Token Rescue

`RevenueSplitter.rescueToken(token, recipient, amount)` 只能由 Timelock 执行。

允许：

- 取回无关 ERC-20；
- 取回支付 Token 中严格高于 `treasuryBalance + contributorBalance` 的 surplus。

禁止：

- 提取 Treasury liability；
- 提取 Contributor liability；
- 提取未领取收入；
- 提取整数除法产生的 Dust；
- 发送到零地址。

执行前必须读取：

```solidity
RevenueSplitter.treasuryBalance()
RevenueSplitter.contributorBalance()
ProtocolConfig.paymentToken()
```

并计算可取回上限。任何超过 surplus 的请求都会失败。

## 10. 取消和异常处理

在执行前发现参数错误或安全风险时，ADMIN 多签作为 canceller 可以调用：

```solidity
ProtocolTimelock.cancel(operationId)
```

取消后需要重新生成新的 `salt` 和 operationId，重新进入等待流程。不能修改已经排队的目标或参数来“修正”原操作。

如果执行失败：

1. 保存失败交易和 revert 数据；
2. 检查 operationId 是否已就绪；
3. 检查目标地址和 calldata；
4. 检查当前协议状态、暂停状态和目标参数；
5. 不要重复提交相同操作，先确认 nonce 和状态；
6. 必要时取消原操作并建立新的治理提案。

## 11. 治理安全清单

- 每项提案至少由规定数量的 Safe owner 审核；
- 目标合约必须是 Proxy 或具体配置合约的正确地址；
- 目标链和 Chain ID 必须正确；
- 交易 calldata 必须由 ABI 编码并由第二人复核；
- `delay` 不得小于 48 小时；
- 不能直接调用配置合约或 Proxy 的受保护函数；
- 执行后检查事件和关键 storage；
- 生产升级前完成独立审计或正式风险接受；
- Timelock、ADMIN 多签、部署账户和 Pipeline 操作员不得共用不受控私钥。

## 12. 参考规则

- [治理与权限决策](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:56)
- [Timelock 和部署要求](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:632)
- [配置接口](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:123)
- [部署顺序](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:778)

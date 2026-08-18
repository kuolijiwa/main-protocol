# Main Protocol V1 — 数据买家 / 消费者操作手册

## 1. 文档范围

本手册适用于购买 Main Protocol Dataset 的普通用户、机构买家和消费者钱包。

V1 只支持固定价格购买：

- Copy License；
- Exclusive Title。

V1 不支持拍卖、`bid`、竞价、拍卖退款或 KYC Hook。

## 2. 购买前准备

买家需要准备：

1. 支持目标 EVM 网络的钱包；
2. 足够的支付 Token；
3. 足够的网络原生币支付 Gas；
4. 支付 Token 对 Marketplace Proxy 的授权；
5. 购买前确认 Dataset、Listing 和挑战状态。

支付 Token 是部署时固定的 ERC-20 地址。ADMIN 不能在已有部署中直接替换支付 Token。

## 3. 浏览和检查 Dataset

前端或客户端应先读取：

```solidity
DatasetRegistry.getDataset(datasetId)
Marketplace.getListing(datasetId, SaleKind.Copy)
Marketplace.getListing(datasetId, SaleKind.Exclusive)
DatasetRegistry.challengeWindowEndsAt(datasetId)
DatasetRegistry.challengeStatus(datasetId)
DatasetRegistry.weightsInvalidated(datasetId)
ProtocolConfig.paused()
```

买家至少确认：

- Dataset 存在；
- Dataset 状态为 `Listed`；
- 目标 Listing 为 active；
- Listing 类型符合自己的购买目的；
- `price > 0`；
- 当前时间已经达到 `challengeWindowEndsAt`；
- `challengeStatus` 为 `None` 或 `Rejected`；
- `weightsInvalidated == false`；
- 协议没有暂停；
- 当前价格和 Listing 的 `maxFeeBps` 条件可接受。

挑战窗口期间可以查看 Sample 和 Listing，但不能购买。公开 Sample 不需要权益凭证。

## 4. 选择购买类型

| 类型            | 权益         | 是否可转让             | 购买后状态                                       |
| --------------- | ------------ | ---------------------- | ------------------------------------------------ |
| Copy License    | 非独占使用权 | 不可转让               | Dataset 仍可向其他地址出售 Copy                  |
| Exclusive Title | 独占标题     | 可按 ERC-1155 标准转让 | Dataset 进入 `ExclusivelySold`，关闭所有 Listing |

如果 `exclusiveRequiresZeroCopies == true`：

- Exclusive 只能在 `copiesSold == 0` 时购买；
- 第一个 Copy 购买成功后，活跃 Exclusive Listing 会自动关闭；
- 之后不能重新创建该 Exclusive Listing。

## 5. 购买 Copy License

### 5.1 读取当前价格

调用：

```solidity
Marketplace.getListing(datasetId, SaleKind.Copy)
```

保存返回的：

- `price` 作为 `expectedPrice`；
- 当前时间加上合理缓冲作为 `deadline`；
- Marketplace Proxy 地址作为授权 spender。

`expectedPrice` 必须与链上 active Listing 的价格完全一致。`deadline` 到期后交易不能执行。

### 5.2 授权支付 Token

用户先对固定支付 Token 调用标准 ERC-20：

```solidity
paymentToken.approve(marketplaceProxy, expectedPrice)
```

建议使用精确授权或明确的有限额度，并确认授权的 spender 是 Marketplace Proxy，不是 Implementation 地址。

### 5.3 执行购买

调用：

```solidity
Marketplace.buyCopy(
    datasetId,
    expectedPrice,
    deadline
)
```

成功后，协议会依次：

1. 验证 Dataset、Listing、挑战状态和价格；
2. 从买家转入固定价格到 `RevenueSplitter`；
3. 校验收款金额必须精确等于价格；
4. 计算手续费和 Dataset 净收入；
5. 铸造一个 Copy ERC-1155 权益；
6. 增加 `copiesSold`；
7. 按 true-exclusive 规则关闭必要的 Exclusive Listing；
8. 发出 `CopyPurchased` 事件。

同一个钱包已经持有该 Dataset 的 Copy Token 时，不能再次购买同一 Copy License。不同钱包可以分别购买。

## 6. 购买 Exclusive Title

### 6.1 购买前确认

确认：

- Exclusive Listing active；
- `policy.allowExclusive == true`；
- 如果 `exclusiveRequiresZeroCopies == true`，则 `copiesSold == 0`；
- 挑战窗口已结束；
- 没有 Pending 或 Upheld Challenge；
- 当前价格和手续费上限仍然有效。

### 6.2 执行购买

先授权支付 Token，然后调用：

```solidity
Marketplace.buyExclusive(
    datasetId,
    expectedPrice,
    deadline
)
```

成功后：

- 支付转入 `RevenueSplitter`；
- Dataset 状态变为 `ExclusivelySold`；
- Copy 和 Exclusive Listing 全部关闭；
- 买家获得一个 Exclusive ERC-1155 Token；
- 发出 `ExclusivePurchased` 事件；
- 后续不能再创建销售或铸造新的权益。

## 7. 购买后的访问流程

链上只记录权益和数据指针，完整数据由 Access Gateway 服务提供。

预期流程：

1. 买家使用钱包签名 Gateway 的身份挑战；
2. Gateway 查询：

   ```solidity
   EntitlementNFT.hasAccess(datasetId, buyer)
   ```

3. 权益有效时，Gateway 根据 `payloadURI` 返回加密数据访问或解密密钥；
4. 买家在客户端完成解密。

访问规则：

- Dataset 未进入 `ExclusivelySold` 时，Copy 或 Exclusive Token 持有人可通过 `hasAccess`；
- Dataset 进入 `ExclusivelySold` 后，只有 Exclusive Token 持有人通过 `hasAccess`；
- 之前已经下载的数据无法被链上追回；
- 之前 Copy 买家的后续 Gateway 下载和密钥获取会被停止。

## 8. 常见失败原因

| 现象                    | 常见原因                                          |
| ----------------------- | ------------------------------------------------- |
| `ListingNotActive`      | Listing 已关闭或不存在                            |
| `DatasetNotPurchasable` | Dataset 未 Listed、挑战窗口未结束或状态不允许购买 |
| `ProtocolPaused`        | 协议处于暂停状态                                  |
| 价格校验失败            | `expectedPrice` 与链上 Listing 价格不一致         |
| deadline 失败           | 交易执行时间晚于 `deadline`                       |
| 手续费上限失败          | 当前 `feeBps` 高于 Listing 创建时的 `maxFeeBps`   |
| Copy 重复购买失败       | 当前钱包已经持有该 Dataset 的 Copy Token          |
| Exclusive 条件失败      | true-exclusive Dataset 已有 Copy 销售             |
| 支付失败                | 未授权、余额不足或支付 Token 不是精确转账 ERC-20  |
| Challenge 失败          | Dataset 为 Pending 或已 Upheld                    |

## 9. 安全注意事项

- 购买前核对网络、Marketplace Proxy 地址、Dataset ID 和固定支付 Token 地址；
- 不要把支付授权给 Implementation 地址；
- `expectedPrice` 和 `deadline` 必须由前端在提交交易前重新读取；
- 不要把链上 NFT 余额误认为数据本身，完整数据仍由 Gateway 管理；
- Exclusive 购买意味着之前 Copy 用户会失去后续 Gateway 访问，应在付款前阅读买方条款。

## 10. 参考规则

- [Listing 和购买规则](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:406)
- [Copy 购买流程](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:419)
- [Exclusive 购买流程](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:436)
- [访问权限规则](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:521)

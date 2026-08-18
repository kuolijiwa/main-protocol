# Main Protocol 前端 ABI 包

本目录只包含前端调用所需的 ABI、统一导出和当前 Base Sepolia 地址映射，不包含 bytecode、deployedBytecode、metadata、私钥或 RPC 凭据。

## ABI 文件列表

| 文件                           | 调用地址                  | 前端用途                                                          |
| ------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| `ContributorRegistry.abi.json` | ContributorRegistry       | 角色、Operator attribution、白名单管理                            |
| `ProtocolConfig.abi.json`      | ProtocolConfig            | Token、费率、Treasury、Challenge window、Gateway signer、Pause    |
| `DatasetRegistry.abi.json`     | DatasetRegistry           | Dataset、Manifest getter、Challenge 和登记                        |
| `EntitlementNFT.abi.json`      | EntitlementNFT            | ERC-1155 tokenId、余额、访问权、Exclusive 转让                    |
| `Marketplace.abi.json`         | **Marketplace Proxy**     | 固定价 Listing、下架、Copy/Exclusive 购买                         |
| `RevenueSplitter.abi.json`     | **RevenueSplitter Proxy** | 收入、Claim、Treasury withdrawal                                  |
| `ProtocolTimelock.abi.json`    | ProtocolTimelock          | 治理 schedule/execute、状态和延迟                                 |
| `PaymentTokenERC20.abi.json`   | Payment Token             | name/symbol/decimals、余额、allowance、approve、Transfer/Approval |

辅助文件：

| 文件                          | 用途                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `index.ts`                    | 八个 ABI 的统一 TypeScript 导出                      |
| `manifest.json`               | ABI 来源、entry 数量和每个 ABI 文件的 SHA-256        |
| `base-sepolia.addresses.json` | 当前已验证 Base Sepolia 地址、ABI 映射和测试部署警告 |

## 使用规则

1. Marketplace 和 RevenueSplitter 必须使用代理地址配合业务实现 ABI。
2. Implementation 地址只用于实现验证，不能作为业务调用地址。
3. 支付 Token 的 `approve` spender 是 Marketplace Proxy。
4. `DatasetRegistered` 是原始五参数事件：

```solidity
event DatasetRegistered(
  uint256 indexed datasetId,
  address indexed contributor,
  bytes32 contentHash,
  bytes32 weightsRoot,
  uint256 totalWeight
);
```

5. 当前 ABI 没有 `WeightsManifestCommitted` 事件。Indexer 收到 `DatasetRegistered` 后读取 `weightsURI`、`weightsManifestHash` 和 `WEIGHTS_MANIFEST_VERSION`。
6. 当前 V1 没有 `bid`、拍卖或 settle ABI。
7. Base Sepolia 地址文件是测试配置；动态费率、Challenge window、Pause、Treasury 和 Gateway signer 必须从链上 getter 刷新。

## viem/wagmi 示例

```ts
import marketplaceAbi from "./ABI/Marketplace.abi.json";
import baseSepoliaDeployment from "./ABI/base-sepolia.addresses.json";

const listing = await publicClient.readContract({
  address: baseSepoliaDeployment.addresses.marketplaceProxy,
  abi: marketplaceAbi,
  functionName: "getListing",
  args: [datasetId, 0],
});
```

如 TypeScript 将 JSON 推断得过宽，可使用 viem 的 `Abi` 类型：

```ts
import type { Abi } from "viem";
import marketplaceAbiJson from "./ABI/Marketplace.abi.json";

const marketplaceAbi = marketplaceAbiJson as Abi;
```

## ethers v6 示例

```ts
import { Contract } from "ethers";
import marketplaceAbi from "./ABI/Marketplace.abi.json" with { type: "json" };
import deployment from "./ABI/base-sepolia.addresses.json" with { type: "json" };

const marketplace = new Contract(deployment.addresses.marketplaceProxy, marketplaceAbi, signer);
```

## 重新生成

每次 Solidity ABI 发生变化后执行：

```bash
npm run compile
npm run export:frontend-abi
```

生成器会拒绝错误的 `DatasetRegistered` 签名、意外的 Manifest 事件以及泄漏到 V1 的拍卖函数。重新生成后必须提交 ABI 文件和新的 `manifest.json`，并通知前端升级 ABI 版本。

完整业务接入规则见仓库根目录的 `FRONTEND_INTEGRATION_GUIDE.md`。

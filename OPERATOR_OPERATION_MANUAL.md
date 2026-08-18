# Main Protocol V1 — Pipeline 操作员（OPERATOR）操作手册

## 1. 文档范围

本手册适用于持有 `OPERATOR_ROLE`、代表指定贡献者向 Main Protocol 注册 Dataset 的 Pipeline 操作员。

当前 V1 中，Pipeline 操作员负责提交已经由链下 Pipeline 生成并校验的数据承诺、权重根和 Dataset 元数据。权重计算、数据打包、加密、叶子列表发布和争议证据准备属于链下流程；本仓库只实现 Main Protocol 的链上注册和结算接口。

本手册不包含以下未实现范围：

- Crowdsourcing Protocol；
- Arcade、epoch、commit-reveal、honeypot 和标签评分；
- Access Gateway 服务；
- 拍卖和 `bid`；
- 链上挑战保证金、质押或自动裁决。

## 2. 权限和身份规则

Pipeline 操作员必须同时满足：

1. 在 `ContributorRegistry` 中持有 `OPERATOR_ROLE`；
2. 通过 `operatorContributor(operator)` 被 ADMIN 分配给一个持有 `CONTRIBUTOR_ROLE` 的贡献者；
3. 该分配关系在注册时仍然有效。

操作员不能在 `registerDataset` 参数中自行指定贡献者。合约会根据注册者身份解析贡献者：

- 如果调用者持有 `CONTRIBUTOR_ROLE`，直接贡献者身份优先；
- 否则调用者必须是已分配的 `OPERATOR_ROLE`，Dataset 的 `contributor` 会记录被分配的贡献者。

生产环境中，Pipeline 操作员不应同时持有 `CONTRIBUTOR_ROLE`。部署验证要求初始 Contributor 只有 `NURTURE_CONTRIBUTOR`，并要求 Pipeline 操作员是独立地址。

操作员可以：

- 调用 `DatasetRegistry.registerDataset(RegisterParams)`；
- 查询 Dataset、挑战窗口和挑战状态；
- 读取链上注册结果。

操作员不能：

- 修改已经注册的 `weightsRoot` 或 `totalWeight`；
- 代表贡献者创建或撤销 Listing；
- 直接裁决挑战；
- 修改协议费、Treasury、挑战窗口或 Gateway signer；
- 执行 UUPS 升级。

只有 Dataset 的 `contributor` 地址可以调用 `Marketplace.listCopy`、`listExclusiveFixed` 和 `delist`。因此，操作员完成注册后，应将 Dataset ID 和注册信息交给对应贡献者或其市场服务继续创建 Listing。

## 3. 注册前准备

### 3.1 准备 Dataset 元数据

注册参数 `RegisterParams` 包含：

```solidity
struct RegisterParams {
  uint256 expectedDatasetId;
  bytes32 contentHash;
  string sampleURI;
  string payloadURI;
  bytes32 weightsRoot;
  uint256 totalWeight;
  string weightsURI;
  bytes32 weightsManifestHash;
  SalePolicy policy;
  string tag;
}
```

必须满足：

- `contentHash != bytes32(0)`；
- `sampleURI` 非空，且指向公开 Sample；
- `payloadURI` 非空，且指向加密完整数据；
- `weightsRoot != bytes32(0)`；
- `totalWeight > 0`；
- `expectedDatasetId == DatasetRegistry.nextDatasetId()`，使 Manifest 在生成时唯一绑定即将注册的 Dataset；
- `weightsURI` 非空，且任何 claimant 无需联系运营方即可从该公开地址下载 Manifest；
- `weightsManifestHash == keccak256(Manifest 原始文件字节)`；
- `policy.allowCopy || policy.allowExclusive` 至少一个为 `true`；
- `policy.licensesTransferable == false`；
- Dataset 字节不能写入链上，只提交 URI 和完整数据的哈希承诺。

### 3.2 校验权重分配

准备一个分配文件，例如：

```json
{
  "totalWeight": "1000000",
  "entries": [
    {
      "address": "0x...",
      "weight": "700000"
    },
    {
      "address": "0x...",
      "weight": "300000"
    }
  ]
}
```

必须满足：

- 地址不能为零地址；
- 地址不能重复；
- 每个权重必须大于零；
- 每个权重不能大于 `totalWeight`；
- `totalWeight` 和每个权重必须适配 Solidity `uint256`；
- 所有权重之和必须严格等于 `totalWeight`；
- Merkle Leaf 使用 `keccak256(abi.encode(address, weight))`；
- 使用排序后的 Leaf 和排序兄弟节点计算 Merkle Root；
- 完整叶子列表、Proof 和计算过程必须在链下发布，便于重新计算和挑战。

使用项目提供的校验脚本：

```bash
ALLOCATION_FILE=./path/to/allocation.json npm run validate:allocation
```

如果文件中提供了 `root`，脚本还会检查计算出的 Root 是否一致：

```json
{
  "totalWeight": "1000000",
  "root": "0x...",
  "entries": []
}
```

校验成功后，使用 `generate:weights-manifest` 生成包含完整地址、权重和 Proof 的 v1 Manifest。Manifest 必须绑定 `datasetId`、`chainId`、`DatasetRegistry`、固定 Leaf/树算法版本、Pipeline 版本、生成时间和输入内容摘要：

```bash
ALLOCATION_FILE=./path/to/allocation.json \
EXPECTED_CHAIN_ID=<chain-id> \
DATASET_REGISTRY=<registry-address> \
PIPELINE_VERSION=<version> \
GENERATED_AT=<canonical-UTC-time，例如-2026-08-18T00:00:00.000Z> \
CONTENT_DIGEST=<bytes32-source-digest> \
MANIFEST_OUTPUT_FILE=./weights-manifest.json \
npm run generate:weights-manifest
```

分配文件只允许顶层 `totalWeight`、可选 `root`、`entries`，每个 entry 只允许 `address` 和 `weight`。生成器会连接目标网络，确认实际 chain ID、DatasetRegistry 合约代码和 `WEIGHTS_MANIFEST_VERSION`，并直接读取 `nextDatasetId()`；不允许操作员手工输入 Dataset ID。它也不信任外部提供的 Root：会从严格验证后的 leaves 重新计算 Root、按地址规范排序、生成所有 Proof，再调用与公开验证器完全相同的严格校验路径。相同分配无论输入顺序如何都必须生成相同的 Manifest 数据；任何未知字段、重复/零地址、非正或超范围权重、总和错误、Root 错误、非规范时间、空 Pipeline 版本或无效内容摘要都会阻止输出。

将文件发布到 IPFS、Arweave 或具有持续可用性和备份的公开存储，记录其 URI，并对最终上传的原始字节计算 `keccak256`。生成后到上链前如果 `nextDatasetId()` 已变化，必须使用新的 Dataset ID 重新生成 Manifest，不能提交旧绑定。

发布后必须从独立 claimant 环境执行 `npm run verify:weights-manifest`，确认 URI、精确字节摘要、chain/Registry/Dataset 绑定、Root、完整 leaves 及每个 Proof 均可独立验证；不得只验证 Pipeline 本机生成的文件。

## 4. 注册 Dataset

### 4.1 注册前链上检查

确认：

1. 当前钱包是已分配的 Pipeline 操作员；
2. `operatorContributor(currentOperator)` 返回正确的贡献者；
3. 返回的贡献者仍持有 `CONTRIBUTOR_ROLE`；
4. `DatasetRegistry` 的 Marketplace wiring 已完成；
5. `ProtocolConfig.paused() == false`；
6. 使用正确的 `DatasetRegistry` 地址和网络；
7. `weightsRoot`、`totalWeight` 与链下校验结果一致。
8. Manifest 已上传、可公开下载，原始字节哈希等于 `weightsManifestHash`；
9. Manifest 中的 Dataset ID 等于当前 `nextDatasetId()`。

可读取：

```solidity
ContributorRegistry.operatorContributor(operator)
ProtocolConfig.paused()
```

### 4.2 调用注册接口

通过受控 Pipeline 客户端调用：

```solidity
DatasetRegistry.registerDataset(RegisterParams params)
```

注意：注册接口没有 `contributor` 参数。不要尝试通过额外参数选择贡献者或代表其他贡献者。

交易成功后记录：

- `datasetId`；
- 原文五参数 `DatasetRegistered` 事件；
- 通过 Registry getter 查询并校验 Manifest URI、digest 和 version；
- `contentHash`；
- `weightsRoot`；
- `totalWeight`；
- `weightsURI`、`weightsManifestHash` 和 `WEIGHTS_MANIFEST_VERSION`；
- 交易哈希和区块号。

### 4.3 注册后的状态

新 Dataset 初始状态：

```text
status              = Draft
challengeStatus     = None
weightsInvalidated  = false
copiesSold          = 0
```

系统同时记录：

```text
challengeWindowEndsAt[datasetId]
= registrationBlockTimestamp + ProtocolConfig.challengeWindow
```

挑战窗口按 Dataset 独立快照。之后修改全局 `challengeWindow` 不会影响已注册 Dataset。

## 5. 注册后的交接

注册成功后，将以下信息交给贡献者或市场服务：

- `datasetId`；
- 发射 `DatasetRegistered` 的注册交易哈希，以及 Manifest getter 校验结果；
- `getDataset(datasetId)` 返回结果；
- `challengeWindowEndsAt(datasetId)`；
- `weightsURI` 和 `weightsManifestHash`；
- Sample 和加密 Payload 的访问地址；
- 建议的 Listing 类型和价格，但价格不写入注册交易。

贡献者随后根据 `SalePolicy` 创建：

```solidity
Marketplace.listCopy(datasetId, price)
Marketplace.listExclusiveFixed(datasetId, price)
```

注册期间可以创建 Listing，但挑战窗口结束前不能购买或 Claim。

## 6. 挑战和异常处理

权重挑战范围包括：

- `weightsRoot` 错误；
- `totalWeight` 错误；
- 重复或缺失 Leaf；
- `(address, weight)` 分配错误。

操作员应持续保留：

- 原始输入数据；
- 权重计算版本和配置；
- 完整叶子列表；
- Merkle Proof；
- 注册时使用的 Root 和 Total Weight；
- 可复现的构建记录。

V1 是“管理员介导的 Challenge”，不是 permissionless 链上裁决：任何人可以向公开的链下争议入口 `POST /v1/datasets/{datasetId}/challenges` 提交符合 `schemas/weight-challenge-evidence-v1.schema.json` 的公开证据文件，但只有 ADMIN 多签可以记录和裁决。证据文件原始字节的 `keccak256` 作为 `evidenceHash`，公开下载地址作为 `evidenceURI`：

争议入口在接受材料前必须执行 `npm run validate:challenge-evidence`。验证器会拒绝错误的 schema、chain/Registry/Dataset/Root 绑定、零 challenger、非规范 UTC 时间、未知 reason、空摘要、重复证据 URI、零摘要、未知字段和无效 JSON；如提供 `EXPECTED_EVIDENCE_HASH`，还必须与精确原始字节匹配。

```solidity
DatasetRegistry.recordChallenge(datasetId, evidenceHash, evidenceURI)
DatasetRegistry.resolveChallenge(datasetId, upheld)
```

运营方必须在收到格式正确、可读取的材料后 24 小时内确认并在挑战窗口关闭前完成链上记录；临近窗口结束的提交必须由自动告警立即升级。每次链上记录的裁决期限固定为 `challengeResolutionDueAt = challengeRecordedAt + 72 hours`。Pending 到期不会自动通过或驳回，会继续阻止购买、Claim 和重新上架，直到 ADMIN 解决；逾期必须触发最高级别告警、公开 SLA 违约状态并升级给治理多签。所有证据必须在 `evidenceURI` 持续公开，并可由 `challengeEvidenceHash` 校验。

如果挑战成功：

- Dataset 的权重永久失效；
- 所有 Listing 被关闭；
- 旧 Dataset 不能重新上架、购买或 Claim；
- 修正后的权重必须注册为新的 Dataset；
- 不能直接修改旧 Dataset，也不能迁移或绕过新的挑战窗口。

## 7. 安全要求

- Pipeline 私钥应放在 HSM 或多签控制下；
- 不要把私钥、原始数据、解密密钥或未加密 Payload 写入仓库；
- 不要重复注册同一权重版本来绕过挑战；
- 每次注册前重新运行 Merkle 分配校验；
- 注册后立即保存事件、交易和完整分配清单；
- 不要把 Pipeline 操作员钱包当作普通 Contributor 钱包使用；
- 不要在未经 ADMIN/治理批准的情况下修改链下分配结果。

## 8. 参考规则

- [Dataset 注册与权重校验](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:395)
- [OPERATOR 身份解析](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:287)
- [挑战状态机](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:494)
- [部署和角色要求](/Volumes/work/Main%20Protocol%20design/MAIN_PROTOCOL_DEVELOPMENT_SPEC.md:632)

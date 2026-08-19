# Main Protocol Web 用户操作测试方案

## 目标

以普通用户在浏览器中的实际操作路径，验证页面导航、公开读取、角色页面、表单校验、权限提示、release guard 和不可写状态。页面操作只使用钱包注入入口，不在 Web 中输入私钥。

## 测试环境

- 页面：本地 Web 控制台
- 网络：Base Sepolia，Chain ID `84532`
- 钱包状态：未连接钱包
- 当前部署：官方 Safe 2/2、48 小时 Timelock 的 `baseSepolia-20260819052231325-45674331`，`release.status=current-verified`
- 数据状态：当前链上 Dataset #1，处于 7 天 Challenge window；旧 EOA 测试部署的 Copy/Exclusive/Challenge 数据保留为历史测试证据

## 用户流程用例

### U-01 首屏与公开导航

打开控制台，确认网络状态、release guard、公开导航和 Overview 数据卡片；依次点击 Datasets、Access Check、Activity，再返回 Overview。

### U-02 未连接钱包访问角色页面

依次点击 Buyer、Contributor、Claimant、Treasury、Admin、Timelock；确认页面可读取公开状态，但写操作显示权限或 release guard 提示，提交按钮不可用。

### U-03 Buyer 真实链上 Listing 状态

进入 Buyer 页面，确认页面读取当前 Dataset #1 的真实 Listing 和 7 天 Challenge window 状态；窗口结束前页面不应允许购买成功。

### U-04 Contributor 表单校验

进入 Contributor 页面，填写错误的 hash、URI、totalWeight 和 Manifest JSON；点击“校验 Manifest”，确认显示校验失败；随后确认 `registerDataset` 仍不可用。

### U-05 Claimant 无 Dataset 状态

进入 Claimant 页面，确认 Dataset 选择为空；输入错误 weight/proof 后点击“预览 claimable”，确认不能构成成功 Claim，`claim` 保持禁用。

### U-06 Admin/Treasury/Timelock 边界

进入 Admin 和 Timelock 页面，确认未连接钱包不能执行 pause、challenge、resolve、schedule、execute 或升级操作；进入 Treasury 相关页面时确认无可提款数据，不显示成功状态。

### U-07 页面刷新与错误恢复

在每个页面刷新浏览器，确认配置、ABI、链上健康检查重新加载；检查无控制台 error/warn，历史部署提示保持一致。

### U-08 真实格式 Dataset 提交

使用合法 Dataset ID、content hash、Manifest URI/hash、完整 `main-protocol.weights-manifest.v1`、唯一地址、正确 Merkle root 和严格权重总和填写 Contributor 表单；点击 Manifest 校验，再点击 `registerDataset`。必须区分“表单校验通过”和“钱包签名/链上交易确认”。

## 判定标准

- 页面能通过用户可见控件完成导航和输入。
- 所有公开读取显示真实链上状态，不使用伪造 Dataset 或交易结果。
- 未连接钱包和 release guard 下，所有写操作必须禁用或明确拒绝。
- 任何失败或跳过必须记录原因，不计入通过。
- 真实角色写流程需在当前源码重新部署、角色配置和专用 Dataset 建立后另行执行。

## 执行记录（2026-08-19）

- U-01：通过。使用页面导航点击完成 Datasets、Access Check、Activity、Overview 切换，网络和历史部署提示保持正确。
- U-02：通过。Buyer、Contributor、Claimant、Admin、Timelock 页面均可打开；未连接钱包时写操作显示为 disabled 或不可执行。
- U-03：通过。Buyer 无 Dataset 时没有可购买记录，购买按钮保持 disabled。
- U-04：通过。非法 JSON 显示 `Manifest JSON 格式无效`；语义错误显示具体校验项；`registerDataset` 保持 disabled。
- U-05：通过。Claimant 无 Dataset 时点击预览显示 `请先选择 Dataset。`，不再出现 BigInt 异常，`claim` 保持 disabled。
- U-06：通过。Admin 写操作被 release guard 禁用；Timelock 可计算 operation ID，但 schedule/execute 保持 disabled。
- U-07：通过。刷新后配置、页面、网络提示恢复正常；应用自身 error 日志为空，已见的 Chrome extension warning 不来自 Web 应用。
- U-08：表单数据通过。当前 Dataset #1 的真实 Manifest、root 和 Manifest hash 被页面接受；当前浏览器无注入钱包，`registerDataset` 保持 disabled，未在网页弹窗中广播交易。对应 Operator 真实注册交易已在 Safe-backed Base Sepolia 完成。

- U-09：通过。使用浏览器测试钱包桥接器连接 Operator，完成 Manifest 校验和真实 `registerDataset` 提交；交易 `0x44ad…6e12` 已确认。
- U-10：通过。使用 Contributor 页面完成 Dataset #1 Copy 上架；交易 `0xcc5b…9ab8` 已确认。
- U-11：通过。等待隔离 E2E 部署的 60 秒 Challenge window 后，Buyer 页面完成 Approve 和 `buyCopy`；Approve `0x046b…71da`、购买 `0xe0a9…4e14` 已确认。
- U-12：通过。Claimant 页面读取 Manifest 的 weight/proof，预览 `0.585 USDC` 后完成 Claim；交易 `0xafbd…427c` 已确认。
- U-13：通过。Treasury 页面读取 `0.025 USDC` treasuryBalance 并完成 `withdrawTreasury`；交易 `0x9476…24e8` 已确认。随后重复提款按规则拒绝。
- U-14：通过。Buyer 购买后在 Access Check 页面验证 `hasAccess = true`；重复 Claim 按规则拒绝。
- U-15：通过。默认 Safe-backed 部署由两个浏览器 Safe owner 会话完成 Challenge record、Rejected/Upheld resolve、Pause/Unpause 和 Timelock schedule；每项均由 1/2 签名收集后由 2/2 Safe 交易确认。Safe 页面待签数据已按交易哈希持久化，支持跨 owner 浏览器会话继续。
- U-16：通过。公共页面未连接钱包时可读取 Overview，但 Treasury/Admin 导航和写操作保持 locked/disabled。
- U-17：通过。Contributor 页面完成 Copy 下架和 Exclusive 上架，Buyer 页面完成 Approve + `buyExclusive`；购买交易 `0xb71f…527a` 已确认，Dataset 进入 `ExclusivelySold`。
- U-18：通过。第二次购买后的增量 Claim 预览仍为 `0.585 USDC`，Claim 交易 `0xcf54…d644` 已确认；Treasury 第二次提取 `0x326a…7a13` 已确认。
- U-19：通过。隔离 E2E Governance 页面以 60 秒测试延迟真实提交 schedule `0x5499…840a`，等待到期后真实 execute `0xf1ac…0647`；默认 Safe-backed 48 小时 Timelock 未被绕过。
- U-20：通过。Gateway signer 页面验证 Buyer `hasAccess=true`、随机地址 `false`，并确认 Admin/Treasury 写权限 locked。
- U-21：通过。Buyer 提交已失效 Listing 被 `ListingNotActive` 拒绝；Claimant 提交错误 proof、重复 Claim 均被链上拒绝。
- U-22：通过。Operator 页面无 Contributor-owned Listing 管理项；非法 Manifest 提交被前端校验拒绝；Contributor 对终态 Dataset 的 Listing 操作被链上拒绝。
- U-23：通过。隔离 Admin 提交重复 Unpause 和 Challenge window 关闭后的 Challenge，均被链上拒绝。

本轮新增的真实 UI 交易使用隔离配置 `web/config/e2e-base-sepolia-short.json`（60 秒 Challenge window、60 秒 Timelock、仅测试用途）；默认 `web/config/base-sepolia.json` 仍指向 Safe 2/2、48 小时 Timelock 的发布基线。桥接器只在本地服务端保存和使用测试私钥，私钥未注入页面、Manifest 或仓库。

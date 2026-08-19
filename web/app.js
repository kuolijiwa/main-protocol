import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.17.0/+esm";
import { resolveContractBinding } from "./src/contracts.mjs";
import { capabilitiesForRoles } from "./src/permissions.mjs";
import { validateWeightsManifest } from "./src/manifest.mjs";

const e2eQuery = new URLSearchParams(location.search);
if (e2eQuery.get("e2e") === "1" && e2eQuery.get("role")) {
  const e2eRole = e2eQuery.get("role");
  const e2eBridge = e2eQuery.get("bridge") || "http://127.0.0.1:8788";
  window.ethereum = {
    isMainProtocolE2E: true,
    request: async ({ method, params = [] }) => {
      const response = await fetch(`${e2eBridge}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: Date.now(), role: e2eRole, method, params }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "E2E wallet request failed");
      return result.result;
    },
    on() {},
    removeListener() {},
  };
}

const ABI_FILES = {
  contributorRegistry: "ContributorRegistry.abi.json",
  protocolConfig: "ProtocolConfig.abi.json",
  datasetRegistry: "DatasetRegistry.abi.json",
  entitlementNFT: "EntitlementNFT.abi.json",
  marketplace: "Marketplace.abi.json",
  revenueSplitter: "RevenueSplitter.abi.json",
  protocolTimelock: "ProtocolTimelock.abi.json",
  paymentToken: "PaymentTokenERC20.abi.json",
};
const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)",
];
const STATUS = ["Draft", "Listed", "ExclusivelySold", "Delisted"];
const CHALLENGE = ["None", "Pending", "Rejected", "Upheld"];
const KIND = { Copy: 0, Exclusive: 1 };
const app = document.querySelector("#app");
const state = {
  config: null,
  abis: {},
  rpc: null,
  wallet: null,
  signer: null,
  address: null,
  health: { errors: [], warnings: [], chainOk: false, writeAllowed: false },
  roles: {},
  capabilities: capabilitiesForRoles(),
  datasets: [],
  selectedDataset: null,
  page: location.hash.slice(1) || "overview",
  activity: [],
  manifest: null,
  manageDatasetId: null,
  safe: { owners: [], threshold: 0n, owner: false, pending: null },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char],
  );
const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—");
const hex = (value) => (typeof value === "string" ? value : "");
const nowSeconds = () => Math.floor(Date.now() / 1000);
const fmtDate = (value) =>
  value && BigInt(value) > 0n ? new Date(Number(value) * 1000).toLocaleString("zh-CN") : "—";
const fmtUnits = (value, decimals = 6) => {
  try {
    return ethers.formatUnits(BigInt(value ?? 0), decimals);
  } catch {
    return "—";
  }
};
const fmtHash = (value) =>
  `<span class="mono address" title="${esc(value)}">${esc(short(value))}</span>`;
const explorer = (address) => `${state.config.network.explorerUrl}/address/${address}`;
const txExplorer = (hash) => `${state.config.network.explorerUrl}/tx/${hash}`;

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 7000);
}

function errorText(error) {
  return esc(
    error?.shortMessage ||
      error?.reason ||
      error?.info?.error?.message ||
      error?.message ||
      "交易失败",
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

function c(key, write = false) {
  const { address, abi } = resolveContractBinding(key, state.config.addresses, state.abis);
  if (!address || !abi) throw new Error(`未加载 ${key} 的地址或 ABI`);
  return new ethers.Contract(address, abi, write ? state.signer : state.rpc);
}

function safeContract(write = false) {
  return new ethers.Contract(
    state.config.addresses.adminAuthority,
    SAFE_ABI,
    write ? state.signer : state.rpc,
  );
}

function recordActivity(label, hash, status = "submitted") {
  state.activity.unshift({ label, hash, status, at: new Date().toLocaleTimeString("zh-CN") });
  state.activity = state.activity.slice(0, 20);
}

async function send(label, action, capability) {
  if (!state.address) throw new Error("请先连接钱包");
  if (!state.capabilities[capability]) throw new Error("当前钱包没有该操作权限");
  if (!state.health.writeAllowed) throw new Error("当前部署未通过发布校验，Web 已进入只读模式");
  const tx = await action();
  recordActivity(label, tx.hash);
  render();
  const receipt = await tx.wait();
  recordActivity(label, tx.hash, "confirmed");
  toast(
    `${esc(label)} 已确认：<a href="${txExplorer(tx.hash)}" target="_blank" rel="noreferrer">${short(tx.hash)}</a>`,
    "success",
  );
  await refresh();
  return receipt;
}

function safeSignatureBytes(signature) {
  const parsed = ethers.Signature.from(signature);
  return ethers.concat([parsed.r, parsed.s, ethers.toBeHex(parsed.v + 4, 1)]);
}

function safePendingKey(transactionHash) {
  return `main-protocol-safe-pending:${state.config.network.chainId}:${state.config.addresses.adminAuthority}:${transactionHash}`;
}

async function submitThroughSafe(label, target, data, callValue = 0n) {
  if (!state.address || !state.safe.owner) throw new Error("请连接 Safe owner 钱包");
  if (!state.health.writeAllowed) throw new Error("当前部署未通过发布校验，Web 已进入只读模式");
  const safe = safeContract();
  const nonce = await safe.nonce();
  const args = [target, callValue, data, 0, 0n, 0n, 0n, ethers.ZeroAddress, ethers.ZeroAddress];
  const transactionHash = await safe.getTransactionHash(...args, nonce);
  const signature = await state.signer.signMessage(ethers.getBytes(transactionHash));
  let existing =
    state.safe.pending?.transactionHash === transactionHash ? state.safe.pending.signatures : {};
  if (!Object.keys(existing).length) {
    try {
      existing =
        JSON.parse(localStorage.getItem(safePendingKey(transactionHash)) || "{}").signatures || {};
    } catch {
      existing = {};
    }
  }
  existing[state.address.toLowerCase()] = safeSignatureBytes(signature);
  state.safe.pending = { label, target, data, transactionHash, nonce, signatures: existing };
  localStorage.setItem(
    safePendingKey(transactionHash),
    JSON.stringify({
      label,
      target,
      data,
      transactionHash,
      nonce: nonce.toString(),
      signatures: existing,
    }),
  );
  const signatures = Object.entries(existing)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, encoded]) => encoded);
  if (signatures.length < Number(state.safe.threshold)) {
    toast(
      `${esc(label)} 已收集 ${signatures.length}/${state.safe.threshold} 个 Safe 签名，请切换另一名 owner 继续。`,
      "info",
    );
    render();
    return null;
  }
  const tx = await safeContract(true).execTransaction(...args, ethers.concat(signatures));
  recordActivity(`${label} (Safe)`, tx.hash);
  render();
  const receipt = await tx.wait();
  localStorage.removeItem(safePendingKey(transactionHash));
  state.safe.pending = null;
  recordActivity(`${label} (Safe)`, tx.hash, "confirmed");
  state.safe.pending = null;
  toast(
    `${esc(label)} 已由 Safe 确认：<a href="${txExplorer(tx.hash)}" target="_blank" rel="noreferrer">${short(tx.hash)}</a>`,
    "success",
  );
  await refresh();
  return receipt;
}

async function load() {
  const configName = e2eQuery.get("config") || "base-sepolia.json";
  if (!/^[a-zA-Z0-9._-]+\.json$/u.test(configName)) throw new Error("invalid runtime config name");
  state.config = await fetchJson(`./config/${configName}`);
  const base = state.config.abiBaseUrl;
  await Promise.all(
    Object.entries(ABI_FILES).map(async ([key, file]) => {
      state.abis[key] = await fetchJson(`${base}/${file}`);
    }),
  );
  state.rpc = new ethers.JsonRpcProvider(
    state.config.network.rpcUrl,
    state.config.network.chainId,
    { staticNetwork: true },
  );
  await healthCheck();
  await refresh();
}

async function healthCheck() {
  const errors = [];
  const warnings = [];
  const readCheck = async (label, action) => {
    try {
      return await action();
    } catch (error) {
      errors.push(`${label} 校验失败：${error.message}`);
      return null;
    }
  };
  const contractCheck = (label, key) => {
    try {
      return c(key);
    } catch (error) {
      errors.push(`${label} 合约绑定失败：${error.message}`);
      return null;
    }
  };
  try {
    const network = await state.rpc.getNetwork();
    state.health.chainOk = Number(network.chainId) === state.config.network.chainId;
    if (!state.health.chainOk)
      errors.push(`RPC chainId ${network.chainId} 不等于 ${state.config.network.chainId}`);
  } catch (error) {
    errors.push(`RPC 不可用：${error.message}`);
  }

  const codeKeys = [
    "protocolTimelock",
    "contributorRegistry",
    "protocolConfig",
    "datasetRegistry",
    "entitlementNFT",
    "revenueSplitterProxy",
    "marketplaceProxy",
    "paymentToken",
  ];
  for (const key of codeKeys) {
    try {
      if ((await state.rpc.getCode(state.config.addresses[key])) === "0x")
        errors.push(`${key} 没有合约代码`);
    } catch (error) {
      errors.push(`${key} 地址校验失败：${error.message}`);
    }
  }
  const config = contractCheck("ProtocolConfig", "protocolConfig");
  const marketplace = contractCheck("Marketplace", "marketplaceProxy");
  const splitter = contractCheck("RevenueSplitter", "revenueSplitterProxy");
  const dataset = contractCheck("DatasetRegistry", "datasetRegistry");
  const nft = contractCheck("EntitlementNFT", "entitlementNFT");
  const expected = state.config.addresses;
  const paymentToken = config
    ? await readCheck("ProtocolConfig.paymentToken", () => config.paymentToken())
    : null;
  if (paymentToken && paymentToken.toLowerCase() !== expected.paymentToken.toLowerCase())
    errors.push("paymentToken 与部署配置不一致");
  const marketplaceDatasetRegistry = marketplace
    ? await readCheck("Marketplace.datasetRegistry", () => marketplace.datasetRegistry())
    : null;
  if (
    marketplaceDatasetRegistry &&
    marketplaceDatasetRegistry.toLowerCase() !== expected.datasetRegistry.toLowerCase()
  )
    errors.push("Marketplace.datasetRegistry 绑定不一致");
  const marketplaceNFT = marketplace
    ? await readCheck("Marketplace.entitlementNFT", () => marketplace.entitlementNFT())
    : null;
  if (marketplaceNFT && marketplaceNFT.toLowerCase() !== expected.entitlementNFT.toLowerCase())
    errors.push("Marketplace.entitlementNFT 绑定不一致");
  const marketplaceSplitter = marketplace
    ? await readCheck("Marketplace.revenueSplitter", () => marketplace.revenueSplitter())
    : null;
  if (
    marketplaceSplitter &&
    marketplaceSplitter.toLowerCase() !== expected.revenueSplitterProxy.toLowerCase()
  )
    errors.push("Marketplace.revenueSplitter 绑定不一致");
  const splitterDatasetRegistry = splitter
    ? await readCheck("RevenueSplitter.datasetRegistry", () => splitter.datasetRegistry())
    : null;
  if (
    splitterDatasetRegistry &&
    splitterDatasetRegistry.toLowerCase() !== expected.datasetRegistry.toLowerCase()
  )
    errors.push("RevenueSplitter.datasetRegistry 绑定不一致");
  const splitterMarketplace = splitter
    ? await readCheck("RevenueSplitter.marketplace", () => splitter.marketplace())
    : null;
  if (
    splitterMarketplace &&
    splitterMarketplace.toLowerCase() !== expected.marketplaceProxy.toLowerCase()
  )
    errors.push("RevenueSplitter.marketplace 绑定不一致");
  const datasetMarketplace = dataset
    ? await readCheck("DatasetRegistry.marketplace", () => dataset.marketplace())
    : null;
  if (
    datasetMarketplace &&
    datasetMarketplace.toLowerCase() !== expected.marketplaceProxy.toLowerCase()
  )
    errors.push("DatasetRegistry.marketplace 绑定不一致");
  const nftMarketplace = nft
    ? await readCheck("EntitlementNFT.marketplace", () => nft.marketplace())
    : null;
  if (nftMarketplace && nftMarketplace.toLowerCase() !== expected.marketplaceProxy.toLowerCase())
    errors.push("EntitlementNFT.marketplace 绑定不一致");
  const configTimelock = config
    ? await readCheck("ProtocolConfig.governanceTimelock", () => config.governanceTimelock())
    : null;
  const timelock = configTimelock?.toLowerCase();
  if (timelock && timelock !== expected.protocolTimelock.toLowerCase())
    errors.push("ProtocolConfig.governanceTimelock 绑定不一致");
  const marketplaceTimelock = marketplace
    ? await readCheck("Marketplace.governanceTimelock", () => marketplace.governanceTimelock())
    : null;
  if (timelock && marketplaceTimelock && marketplaceTimelock.toLowerCase() !== timelock)
    errors.push("Marketplace.governanceTimelock 绑定不一致");
  const splitterTimelock = splitter
    ? await readCheck("RevenueSplitter.governanceTimelock", () => splitter.governanceTimelock())
    : null;
  if (timelock && splitterTimelock && splitterTimelock.toLowerCase() !== timelock)
    errors.push("RevenueSplitter.governanceTimelock 绑定不一致");
  const timelockContract = contractCheck("ProtocolTimelock", "protocolTimelock");
  const delay = timelockContract
    ? await readCheck("ProtocolTimelock.getMinDelay", () => timelockContract.getMinDelay())
    : null;
  const enforced = timelockContract
    ? await readCheck("ProtocolTimelock.enforcedMinimumDelay", () =>
        timelockContract.enforcedMinimumDelay(),
      )
    : null;
  if (delay !== null && enforced !== null && delay < enforced)
    errors.push("Timelock delay 小于 enforced minimum");
  if (state.config.release.status !== "current-verified")
    warnings.push(state.config.release.reason);
  state.health = {
    ...state.health,
    errors,
    warnings,
    writeAllowed: state.config.release.writeEnabled && errors.length === 0,
  };
  const banner = $("#release-banner");
  if (warnings.length || errors.length) {
    banner.classList.remove("hidden");
    banner.innerHTML = `<strong>${errors.length ? "链上启动校验未通过 · 只读模式" : "测试网发布提示"}</strong>${esc([...warnings, ...errors].join("；"))}`;
  } else banner.classList.add("hidden");
  $("#network-pill").className = `pill ${errors.length ? "danger" : "ok"}`;
  $("#network-pill").textContent = errors.length ? "只读故障" : "Base Sepolia · 84532";
}

async function refresh() {
  try {
    await loadDatasets();
  } catch (error) {
    toast(`读取 Dataset 失败：${errorText(error)}`, "error");
  }
  if (state.address) await readRoles();
  render();
}

async function loadDatasets() {
  const registry = c("datasetRegistry");
  const next = Number(await registry.nextDatasetId());
  const count = Math.min(Math.max(next - 1, 0), 100);
  const values = [];
  for (let id = 1; id <= count; id += 1) {
    try {
      const dataset = await registry.getDataset(id);
      const [
        copy,
        exclusive,
        challengeStatus,
        challengeEnds,
        weightsURI,
        manifestHash,
        invalidated,
        cumulative,
        unclaimed,
      ] = await Promise.all([
        c("marketplace").getListing(id, KIND.Copy),
        c("marketplace").getListing(id, KIND.Exclusive),
        registry.challengeStatus(id),
        registry.challengeWindowEndsAt(id),
        registry.weightsURI(id),
        registry.weightsManifestHash(id),
        registry.weightsInvalidated(id),
        c("revenueSplitter").cumulativeRevenue(id),
        c("revenueSplitter").unclaimedRevenue(id),
      ]);
      values.push({
        id: BigInt(dataset.id),
        contributor: dataset.contributor,
        contentHash: dataset.contentHash,
        sampleURI: dataset.sampleURI,
        payloadURI: dataset.payloadURI,
        weightsRoot: dataset.weightsRoot,
        totalWeight: BigInt(dataset.totalWeight),
        status: Number(dataset.status),
        policy: dataset.policy,
        copiesSold: BigInt(dataset.copiesSold),
        tag: dataset.tag,
        createdAt: BigInt(dataset.createdAt),
        copy,
        exclusive,
        challengeStatus: Number(challengeStatus),
        challengeEnds: BigInt(challengeEnds),
        weightsURI,
        manifestHash,
        invalidated,
        cumulative,
        unclaimed,
      });
    } catch (error) {
      console.warn(`Dataset ${id} skipped`, error);
    }
  }
  state.datasets = values;
  if (state.selectedDataset)
    state.selectedDataset = values.find((item) => item.id === state.selectedDataset.id) ?? null;
}

async function readRoles() {
  const addr = state.address;
  const cr = c("contributorRegistry");
  const tc = c("protocolTimelock");
  const [
    adminRole,
    operatorRole,
    contributorRole,
    proposerRole,
    executorRole,
    admin,
    operator,
    contributor,
    proposer,
    executor,
  ] = await Promise.all([
    cr.ADMIN_ROLE(),
    cr.OPERATOR_ROLE(),
    cr.CONTRIBUTOR_ROLE(),
    tc.PROPOSER_ROLE(),
    tc.EXECUTOR_ROLE(),
    cr.hasRole(await cr.ADMIN_ROLE(), addr),
    cr.hasRole(await cr.OPERATOR_ROLE(), addr),
    cr.hasRole(await cr.CONTRIBUTOR_ROLE(), addr),
    tc.hasRole(await tc.PROPOSER_ROLE(), addr),
    tc.hasRole(await tc.EXECUTOR_ROLE(), addr),
  ]);
  const operatorContributor = operator ? await cr.operatorContributor(addr) : ethers.ZeroAddress;
  const treasuryAddress = await c("protocolConfig").treasury();
  const treasury = treasuryAddress.toLowerCase() === addr.toLowerCase();
  let safeOwners = [];
  let safeThreshold = 0n;
  try {
    safeOwners = await safeContract().getOwners();
    safeThreshold = await safeContract().getThreshold();
  } catch {
    // Non-Safe deployments remain direct-role only.
  }
  const safeOwner = safeOwners.some((owner) => owner.toLowerCase() === addr.toLowerCase());
  state.safe = {
    owners: safeOwners,
    threshold: safeThreshold,
    owner: safeOwner,
    pending: state.safe.pending,
  };
  state.roles = {
    adminRole,
    operatorRole,
    contributorRole,
    proposerRole,
    executorRole,
    admin,
    operator,
    contributor,
    proposer,
    executor,
    operatorContributor,
    treasuryAddress,
    treasury,
    safeOwner,
  };
  state.capabilities = capabilitiesForRoles({
    connected: true,
    contributor,
    operator,
    admin,
    proposer,
    executor,
    treasury,
    safeOwner,
  });
}

async function connectWallet() {
  if (!window.ethereum) throw new Error("未检测到浏览器钱包（window.ethereum）");
  state.wallet = new ethers.BrowserProvider(window.ethereum);
  await state.wallet.send("eth_requestAccounts", []);
  const network = await state.wallet.getNetwork();
  if (Number(network.chainId) !== state.config.network.chainId)
    throw new Error(`请切换到 Base Sepolia（84532），当前为 ${network.chainId}`);
  state.signer = await state.wallet.getSigner();
  state.address = await state.signer.getAddress();
  $("#connect-wallet").textContent = "已连接";
  $("#wallet-address").textContent = short(state.address);
  await readRoles();
  render();
  toast(`已连接 ${short(state.address)}`, "success");
}

function statusBadge(value, type = "gray") {
  return `<span class="status ${type}">${esc(value)}</span>`;
}
function datasetStatus(status) {
  return statusBadge(
    STATUS[status] ?? "Unknown",
    status === 1 ? "green" : status === 2 ? "yellow" : "gray",
  );
}
function challengeBadge(status) {
  return statusBadge(
    CHALLENGE[status] ?? "Unknown",
    status === 1 || status === 3 ? "red" : status === 2 ? "yellow" : "gray",
  );
}
function listingStatus(listing) {
  return listing?.active
    ? statusBadge(`Active · ${fmtUnits(listing.price)}`, "green")
    : statusBadge("Inactive", "gray");
}
function writeHint(capability = "buy") {
  return state.health.writeAllowed && state.capabilities[capability]
    ? ""
    : `<div class="notice warning">${state.health.writeAllowed ? "当前钱包没有该角色权限。" : "当前部署未通过 release guard，写操作已安全禁用。"}</div>`;
}
function addressLink(address) {
  return `<a class="mono" href="${explorer(address)}" target="_blank" rel="noreferrer">${short(address)}</a>`;
}

function render() {
  $$("[data-nav]").forEach((node) =>
    node.classList.toggle("active", node.dataset.nav === state.page),
  );
  $$(".gated").forEach((node) => {
    const cap = node.dataset.capability;
    node.classList.toggle("locked", !state.capabilities[cap]);
    node.title = state.capabilities[cap] ? "" : "连接具备对应角色的钱包后可用";
  });
  const pages = {
    overview: renderOverview,
    datasets: renderDatasets,
    access: renderAccess,
    buyer: renderBuyer,
    contributor: renderContributor,
    claimant: renderClaimant,
    treasury: renderTreasury,
    admin: renderAdmin,
    governance: renderGovernance,
    activity: renderActivity,
    detail: renderDatasetDetail,
  };
  (pages[state.page] ?? renderOverview)();
}

function renderOverview() {
  const config = state.config;
  const liveConfig = c("protocolConfig");
  const values = { paused: "—", fee: "—", challenge: "—", delay: "—" };
  Promise.all([
    liveConfig.paused(),
    liveConfig.feeBps(),
    liveConfig.challengeWindow(),
    c("protocolTimelock").getMinDelay(),
  ])
    .then(([paused, fee, challenge, delay]) => {
      values.paused = paused ? "Paused" : "Live";
      values.fee = `${fee} bps`;
      values.challenge = `${challenge}s`;
      values.delay = `${delay}s`;
      ["overview-paused", "overview-fee", "overview-challenge", "overview-delay"].forEach(
        (id, index) => {
          const node = document.getElementById(id);
          if (node)
            node.textContent = [values.paused, values.fee, values.challenge, values.delay][index];
        },
      );
    })
    .catch(() => {});
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Protocol Console / Overview</div><h1>Settlement layer, in view.</h1><p class="subtitle">Main Protocol 固定价 V1 的公开控制台。所有 Dataset、Listing、Manifest commitment 和访问判断都来自链上读取；操作权限由钱包角色和合约最终校验共同决定。</p></div><button class="button secondary" data-action="run-health">重新执行启动校验</button></div>
    <div class="grid stats"><div class="card stat-card"><div class="stat-label">Datasets</div><div class="stat-value">${state.datasets.length}</div><div class="stat-meta">顺序 ID 从 1 开始</div></div><div class="card stat-card"><div class="stat-label">Protocol state</div><div id="overview-paused" class="stat-value">${values.paused}</div><div class="stat-meta">暂停会关闭登记、上架、购买和 Claim</div></div><div class="card stat-card"><div class="stat-label">Current fee</div><div id="overview-fee" class="stat-value">${values.fee}</div><div class="stat-meta">Listing 创建时快照 maxFeeBps</div></div><div class="card stat-card"><div class="stat-label">Timelock delay</div><div id="overview-delay" class="stat-value">${values.delay}</div><div class="stat-meta">仅治理配置与升级走 Timelock</div></div></div>
    <div class="section grid two"><div class="card"><div class="section-head"><h2>Release guard</h2>${state.health.writeAllowed ? statusBadge("Write enabled", "green") : statusBadge("Read only", "yellow")}</div><div class="notice ${state.health.errors.length ? "danger" : "warning"}">${esc(state.config.release.reason)}<br /><span class="small">deploymentId: ${esc(config.release.deploymentId)}</span></div><dl class="kv"><dt>Chain</dt><dd>${esc(config.network.name)} · ${config.network.chainId}</dd><dt>RPC</dt><dd class="mono">${esc(config.network.rpcUrl)}</dd><dt>Wallet</dt><dd>${state.address ? addressLink(state.address) : "未连接"}</dd></dl></div><div class="card"><div class="section-head"><h2>当前身份</h2><span class="pill ${state.address ? "ok" : "muted"}">${state.address ? "Connected" : "Public"}</span></div>${renderRoleSummary()}<div class="form-actions"><button class="button primary" data-action="connect">${state.address ? "刷新钱包角色" : "连接钱包"}</button><a class="button" href="${esc(config.network.explorerUrl)}" target="_blank" rel="noreferrer">打开 BaseScan</a></div></div></div>
    <div class="section card"><div class="section-head"><h2>Core contracts</h2><span class="muted-text small">proxy addresses are used for business calls</span></div><div class="table-wrap"><table><thead><tr><th>Contract</th><th>Address</th><th>Health</th></tr></thead><tbody>${Object.entries(
      config.addresses,
    )
      .map(
        ([key, address]) =>
          `<tr><td>${esc(key)}</td><td>${addressLink(address)}</td><td>${state.health.errors.some((e) => e.toLowerCase().includes(key.toLowerCase())) ? statusBadge("check failed", "red") : statusBadge("code checked", "green")}</td></tr>`,
      )
      .join("")}</tbody></table></div></div>`;
}

function renderRoleSummary() {
  if (!state.address)
    return `<div class="empty">连接钱包后，Web 会读取角色常量和 Operator → Contributor 映射。</div>`;
  const roles = [
    state.roles.admin && "ADMIN",
    state.roles.operator && "OPERATOR",
    state.roles.contributor && "CONTRIBUTOR",
    state.roles.treasury && "TREASURY",
    state.roles.safeOwner && "SAFE_OWNER",
    state.roles.proposer && "PROPOSER",
    state.roles.executor && "EXECUTOR",
  ].filter(Boolean);
  return `<p class="subtitle">${roles.length ? `当前角色：${roles.map((role) => `<span class="pill ok">${role}</span>`).join(" ")}` : "当前地址没有特殊角色，仅可执行 permissionless 读取和购买。"}</p>${state.roles.operator && state.roles.operatorContributor ? `<p class="small muted-text">Operator 代表：${addressLink(state.roles.operatorContributor)}</p>` : ""}`;
}

function renderDatasets() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Public registry</div><h1>Datasets</h1><p class="subtitle">所有人可查看的 Dataset 登记、固定价 Listing、Manifest commitment 和 Challenge 状态。</p></div><button class="button secondary" data-action="refresh">刷新链上数据</button></div><div class="card"><div class="table-wrap">${state.datasets.length ? `<table><thead><tr><th>ID / Tag</th><th>Contributor</th><th>Status</th><th>Copy</th><th>Exclusive</th><th>Challenge</th><th></th></tr></thead><tbody>${state.datasets.map((d) => `<tr><td><strong>#${d.id}</strong><br /><span class="muted-text small">${esc(d.tag || "untagged")}</span></td><td>${addressLink(d.contributor)}</td><td>${datasetStatus(d.status)}</td><td>${listingStatus(d.copy)}</td><td>${listingStatus(d.exclusive)}</td><td>${challengeBadge(d.challengeStatus)}</td><td><button class="button" data-action="select-dataset" data-id="${d.id}">详情</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">当前链上尚未登记 Dataset。</div>`}</div></div>`;
}

function renderAccess() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Gateway boundary</div><h1>Access check</h1><p class="subtitle">读取 EntitlementNFT.hasAccess。真正的 payload 下载、签名、解密和密钥交付由链下 Gateway 负责。</p></div></div><div class="grid two"><div class="card"><h2>Check entitlement</h2><form data-form="access"><div class="field"><label>Dataset ID</label><input name="datasetId" type="number" min="1" placeholder="1" required /></div><div class="field"><label>Requester address</label><input name="who" value="${esc(state.address ?? "")}" placeholder="0x…" required /></div><div class="form-actions"><button class="button primary">查询 hasAccess</button></div></form><div id="access-result" class="section"></div></div><div class="card"><h2>Access rules</h2><div class="notice">Copy license 不可转让；Exclusive Title 在铸造后可按 ERC-1155 转让。Exclusive 售出后，只有当前 Exclusive holder 通过 hasAccess。</div><dl class="kv"><dt>NFT contract</dt><dd>${addressLink(state.config.addresses.entitlementNFT)}</dd><dt>Gateway signer</dt><dd>${addressLink(state.config.addresses.gatewaySigner)}</dd></dl></div></div>`;
}

function renderDatasetDetail() {
  const d = state.selectedDataset;
  if (!d) {
    renderDatasets();
    return;
  }
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Dataset / #${d.id}</div><h1>${esc(d.tag || "Untitled Dataset")}</h1><p class="subtitle">Contributor ${addressLink(d.contributor)} · 创建于 ${fmtDate(d.createdAt)}</p></div><button class="button" data-nav="datasets">返回列表</button></div><div class="detail-grid"><div class="card"><h2>Dataset record</h2><dl class="kv"><dt>Status</dt><dd>${datasetStatus(d.status)}</dd><dt>Contributor</dt><dd>${addressLink(d.contributor)}</dd><dt>Content hash</dt><dd>${fmtHash(d.contentHash)}</dd><dt>Weights root</dt><dd>${fmtHash(d.weightsRoot)}</dd><dt>Total weight</dt><dd class="mono">${d.totalWeight}</dd><dt>Copies sold</dt><dd class="mono">${d.copiesSold}</dd><dt>Sample URI</dt><dd class="mono">${esc(d.sampleURI)}</dd><dt>Payload URI</dt><dd class="mono">${esc(d.payloadURI)}</dd></dl></div><div class="card"><h2>Lifecycle & commitments</h2><dl class="kv"><dt>Challenge</dt><dd>${challengeBadge(d.challengeStatus)}</dd><dt>Window ends</dt><dd>${fmtDate(d.challengeEnds)}</dd><dt>Weights invalidated</dt><dd>${d.invalidated ? statusBadge("Yes", "red") : statusBadge("No", "green")}</dd><dt>Manifest URI</dt><dd class="mono">${esc(d.weightsURI)}</dd><dt>Manifest hash</dt><dd>${fmtHash(d.manifestHash)}</dd><dt>Cumulative revenue</dt><dd class="mono">${fmtUnits(d.cumulative)}</dd><dt>Unclaimed revenue</dt><dd class="mono">${fmtUnits(d.unclaimed)}</dd></dl></div></div><div class="section grid two"><div class="card"><h2>Listings</h2><dl class="kv"><dt>Copy</dt><dd>${listingStatus(d.copy)} ${d.copy?.active ? `<span class="mono">${d.copy.price}</span>` : ""}</dd><dt>Exclusive</dt><dd>${listingStatus(d.exclusive)} ${d.exclusive?.active ? `<span class="mono">${d.exclusive.price}</span>` : ""}</dd><dt>Policy</dt><dd class="small">Copy ${d.policy.allowCopy ? "allowed" : "disabled"} · Exclusive ${d.policy.allowExclusive ? "allowed" : "disabled"} · zero copies ${d.policy.exclusiveRequiresZeroCopies ? "required" : "not required"}</dd></dl></div><div class="card"><h2>Public links</h2><div class="form-actions"><a class="button" href="${esc(d.sampleURI)}" target="_blank" rel="noreferrer">打开 sample URI</a><a class="button" href="${explorer(state.config.addresses.datasetRegistry)}#readContract" target="_blank" rel="noreferrer">在 BaseScan 查看 Registry</a></div><p class="small muted-text section">Manifest 必须绑定 chainId、Registry、Dataset ID、hash/tree 版本、完整唯一 entries 和 totalWeight。</p></div></div>`;
}

function renderBuyer() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Permissionless purchase</div><h1>Buyer</h1><p class="subtitle">固定价 V1 购买 Copy License 或 Exclusive Title。每次购买都重新读取 Listing、锁定 expectedPrice 并使用 deadline 防止价格和交易过期。</p></div></div>${writeHint("buy")}<div class="section grid two"><div class="card"><h2>Buy Copy</h2><form data-form="buy" data-kind="0"><div class="field"><label>Dataset</label><select name="datasetId">${state.datasets.map((d) => `<option value="${d.id}">#${d.id} · ${esc(d.tag || "untitled")} · ${fmtUnits(d.copy?.price ?? 0)}</option>`).join("")}</select></div><div class="notice">同一地址不能重复购买同一 Dataset 的 Copy；不同地址之间没有总量上限。</div><div class="form-actions"><button class="button primary" ${state.health.writeAllowed && state.capabilities.buy ? "" : "disabled"}>Approve + buyCopy</button></div></form></div><div class="card"><h2>Buy Exclusive</h2><form data-form="buy" data-kind="1"><div class="field"><label>Dataset</label><select name="datasetId">${state.datasets.map((d) => `<option value="${d.id}">#${d.id} · ${esc(d.tag || "untitled")} · ${fmtUnits(d.exclusive?.price ?? 0)}</option>`).join("")}</select></div><div class="notice warning">Exclusive 购买会关闭两类 Listing，并进入终态 ExclusivelySold；true-exclusive 还要求 copiesSold == 0。</div><div class="form-actions"><button class="button secondary" ${state.health.writeAllowed && state.capabilities.buy ? "" : "disabled"}>Approve + buyExclusive</button></div></form></div></div>`;
}

function renderContributor() {
  const mine = state.datasets.filter(
    (d) => state.address && d.contributor.toLowerCase() === state.address.toLowerCase(),
  );
  const managed = mine.find((d) => d.id === state.manageDatasetId);
  const manageMarkup = managed
    ? `<div class="section card"><div class="section-head"><h2>Manage Listing #${managed.id}</h2><button type="button" class="button" data-action="cancel-manage-listing">取消</button></div><p class="small muted-text">使用页面表单提交固定价 Listing 操作；价格单位为 USDC，撤销操作不会使用价格值。</p><form data-form="manage-listing"><input type="hidden" name="datasetId" value="${managed.id}" /><div class="form-grid"><div class="field"><label>固定价格（USDC）</label><input name="price" value="1" inputmode="decimal" required /></div><div class="field"><label>操作</label><select name="kind"><option value="copy-list">Copy 上架</option><option value="exclusive-list">Exclusive 上架</option><option value="copy-delist">Copy 下架</option><option value="exclusive-delist">Exclusive 下架</option></select></div></div><div class="form-actions"><button class="button primary">提交 Listing 操作</button></div></form></div>`
    : "";
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Contributor / Operator</div><h1>Publish Dataset</h1><p class="subtitle">Contributor 自己登记，或 Operator 代表 operatorContributor 映射的 Contributor 登记。权重在注册时锁定，错误修正必须创建新 Dataset。</p></div></div>${writeHint("register")}<div class="card"><h2>Registration</h2><form data-form="register"><div class="form-grid"><div class="field"><label>Expected Dataset ID</label><input name="expectedDatasetId" type="number" min="1" value="${state.datasets.length + 1}" required /></div><div class="field"><label>Tag</label><input name="tag" placeholder="robotics/dexterity" /></div><div class="field"><label>Content hash（encrypted payload）</label><input name="contentHash" placeholder="0x…" required /></div><div class="field"><label>Weights root</label><input name="weightsRoot" placeholder="从 Manifest 自动填充或手填" required /></div><div class="field"><label>Sample URI</label><input name="sampleURI" placeholder="ipfs://…" required /></div><div class="field"><label>Payload URI</label><input name="payloadURI" placeholder="ipfs://…" required /></div><div class="field"><label>Weights Manifest URI</label><input name="weightsURI" placeholder="ipfs://manifest.json" required /></div><div class="field"><label>Weights Manifest hash</label><input name="weightsManifestHash" placeholder="0x…" required /></div><div class="field"><label>Total weight</label><input name="totalWeight" type="number" min="1" required /></div><div class="field"><label>Policy</label><select name="policy"><option value="copy">Copy only</option><option value="both" selected>Copy + Exclusive</option><option value="exclusive">Exclusive only</option></select></div><div class="field full"><label>Manifest JSON（本地校验，不会自动上传）</label><textarea name="manifestJson" placeholder='{"schema":"main-protocol.weights-manifest.v1",…}'></textarea></div></div><div id="manifest-result" class="section"></div><div class="form-actions"><button type="button" class="button secondary" data-action="validate-manifest">校验 Manifest</button><button class="button primary" ${state.health.writeAllowed && state.capabilities.register ? "" : "disabled"}>registerDataset</button></div></form></div><div class="section card"><div class="section-head"><h2>My Datasets</h2><span class="muted-text small">只有链上 contributor 本人可以管理 Listing</span></div>${mine.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Copy</th><th>Exclusive</th><th>Actions</th></tr></thead><tbody>${mine.map((d) => `<tr><td>#${d.id}</td><td>${datasetStatus(d.status)}</td><td>${listingStatus(d.copy)}</td><td>${listingStatus(d.exclusive)}</td><td><button class="button" data-action="manage-dataset" data-id="${d.id}">管理</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">当前钱包没有作为 contributor 登记的 Dataset。</div>`}</div>${manageMarkup}`;
}

function renderClaimant() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Merkle pull claim</div><h1>Claim revenue</h1><p class="subtitle">从链上 Manifest commitment 找到自己的 weight 和 proof，预览 claimable 后领取。RevenueSplitter 按 Dataset 隔离未领取余额，错误树不能透支其他 Dataset。</p></div></div>${writeHint("claim")}<div class="grid two"><div class="card"><h2>Claim</h2><form data-form="claim"><div class="field"><label>Dataset</label><select name="datasetId">${state.datasets.map((d) => `<option value="${d.id}">#${d.id} · manifest ${short(d.manifestHash)}</option>`).join("")}</select></div><div class="field"><label>Weight</label><input name="weight" type="number" min="1" required /></div><div class="field"><label>Merkle proof JSON array</label><textarea name="proof" placeholder='["0x…", "0x…"]' required></textarea></div><div id="claim-preview" class="notice">输入 weight 和 proof 后可预览 claimable。</div><div class="form-actions"><button type="button" class="button secondary" data-action="preview-claim">预览 claimable</button><button class="button primary" ${state.health.writeAllowed && state.capabilities.claim ? "" : "disabled"}>claim</button></div></form></div><div class="card"><h2>Revenue ledger</h2>${state.datasets.length ? `<div class="table-wrap"><table><thead><tr><th>Dataset</th><th>Cumulative</th><th>Unclaimed</th><th>Manifest</th></tr></thead><tbody>${state.datasets.map((d) => `<tr><td>#${d.id}</td><td class="mono">${fmtUnits(d.cumulative)}</td><td class="mono">${fmtUnits(d.unclaimed)}</td><td>${fmtHash(d.manifestHash)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">暂无 Dataset。</div>`}</div></div>`;
}

function renderTreasury() {
  const treasury = state.roles.treasuryAddress ?? state.config.addresses.treasury;
  const splitter = c("revenueSplitter");
  const token = c("paymentToken");
  Promise.all([
    splitter.treasuryBalance(),
    splitter.contributorBalance(),
    token.balanceOf(treasury),
  ])
    .then(([treasuryBalance, contributorBalance, tokenBalance]) => {
      const values = [
        ["treasury-balance", fmtUnits(treasuryBalance)],
        ["contributor-balance", fmtUnits(contributorBalance)],
        ["treasury-token-balance", fmtUnits(tokenBalance)],
      ];
      for (const [id, value] of values) {
        const node = document.getElementById(id);
        if (node) node.textContent = `${value} USDC`;
      }
    })
    .catch(() => {});
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Treasury boundary</div><h1>Treasury</h1><p class="subtitle">Treasury 只能提取 RevenueSplitter 的 treasuryBalance；Contributor 未领取收入和 Dataset 隔离余额不能被提取。</p></div></div>${writeHint("treasury")}<div class="grid stats"><div class="card stat-card"><div class="stat-label">Treasury balance</div><div id="treasury-balance" class="stat-value">读取中…</div><div class="stat-meta">可由 Treasury 提取</div></div><div class="card stat-card"><div class="stat-label">Contributor balance</div><div id="contributor-balance" class="stat-value">读取中…</div><div class="stat-meta">Treasury 不可提取</div></div><div class="card stat-card"><div class="stat-label">Treasury wallet backing</div><div id="treasury-token-balance" class="stat-value">读取中…</div><div class="stat-meta">支付 Token 当前余额</div></div></div><div class="section grid two"><div class="card"><h2>Configured Treasury</h2><dl class="kv"><dt>Address</dt><dd>${addressLink(treasury)}</dd><dt>Connected wallet</dt><dd>${state.address ? addressLink(state.address) : "未连接"}</dd><dt>Permission</dt><dd>${state.roles.treasury ? statusBadge("Treasury member", "green") : statusBadge("Read only", "gray")}</dd></dl></div><div class="card"><h2>Withdraw</h2><p class="small muted-text">交易由链上 withdrawTreasury() 执行；页面不会设置 amount，也不会调用 rescueToken。</p><form data-form="treasury"><div class="form-actions"><button class="button primary" ${state.health.writeAllowed && state.capabilities.treasury ? "" : "disabled"}>withdrawTreasury</button></div></form></div></div>`;
}

function renderAdmin() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">ADMIN authority</div><h1>Admin operations</h1><p class="subtitle">V1 Challenge 由管理员介导：证据在链下公开提交，只有 ADMIN_ROLE 记录和裁决。当前 Base Sepolia 发布基线使用官方 Safe 2/2；网页钱包需要通过 Safe 流程提交管理员交易。</p></div></div>${writeHint("admin")}<div class="notice warning">Pending Challenge 不会自动通过或驳回；recordChallenge 写入 evidenceURI/hash，并发布 72 小时 resolution due time。Safe owner 不是 ADMIN_ROLE 本身，不能绕过 Safe 直接调用管理员函数。</div><div class="section grid two"><div class="card"><h2>Record Challenge</h2><form data-form="record-challenge"><div class="field"><label>Dataset ID</label><input name="datasetId" type="number" min="1" required /></div><div class="field"><label>Evidence hash</label><input name="evidenceHash" placeholder="0x…" required /></div><div class="field"><label>Evidence URI</label><input name="evidenceURI" placeholder="ipfs://evidence.json" required /></div><div class="form-actions"><button class="button primary" ${state.health.writeAllowed && state.capabilities.admin ? "" : "disabled"}>recordChallenge</button></div></form></div><div class="card"><h2>Resolve Challenge</h2><form data-form="resolve-challenge"><div class="field"><label>Dataset ID</label><input name="datasetId" type="number" min="1" required /></div><div class="field"><label>Decision</label><select name="upheld"><option value="false">Rejected · continue lifecycle</option><option value="true">Upheld · invalidate weights</option></select></div><div class="form-actions"><button class="button danger" ${state.health.writeAllowed && state.capabilities.admin ? "" : "disabled"}>resolveChallenge</button></div></form></div></div><div class="section grid two"><div class="card"><h2>Emergency pause</h2><p class="small muted-text">Pause stops registration, listing, purchase and claim. Reads, delist, challenge and treasury withdrawal remain available.</p><div class="form-actions"><button class="button danger" data-action="pause" ${state.health.writeAllowed && state.capabilities.pause ? "" : "disabled"}>pause</button><button class="button secondary" data-action="unpause" ${state.health.writeAllowed && state.capabilities.pause ? "" : "disabled"}>unpause</button></div></div><div class="card"><h2>Role members</h2>${renderRoleMembers()}</div></div>`;
}

function renderRoleMembers() {
  return `<p class="small muted-text">角色成员读取自 AccessControlEnumerable，当前页面不提供未审查的批量权限修改。</p><dl class="kv"><dt>ADMIN</dt><dd>当前连接地址 ${state.roles.admin ? statusBadge("member", "green") : statusBadge("not member", "gray")}</dd><dt>OPERATOR</dt><dd>当前连接地址 ${state.roles.operator ? statusBadge("member", "green") : statusBadge("not member", "gray")}</dd><dt>CONTRIBUTOR</dt><dd>当前连接地址 ${state.roles.contributor ? statusBadge("member", "green") : statusBadge("not member", "gray")}</dd></dl>`;
}

function renderGovernance() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">ProtocolTimelock</div><h1>Governance</h1><p class="subtitle">配置变更和 UUPS 升级由 Timelock 控制。Web 只构建标准 schedule/execute 参数，不提供任何延迟绕过。</p></div></div><div class="grid two"><div class="card"><h2>Timelock status</h2><dl class="kv"><dt>Address</dt><dd>${addressLink(state.config.addresses.protocolTimelock)}</dd><dt>Current delay</dt><dd id="gov-delay">读取中…</dd><dt>Enforced minimum</dt><dd id="gov-min">读取中…</dd><dt>Proposer</dt><dd>${state.roles.proposer ? statusBadge("connected wallet", "green") : statusBadge("not connected", "gray")}</dd><dt>Executor</dt><dd>${state.roles.executor ? statusBadge("connected wallet", "green") : statusBadge("not connected", "gray")}</dd></dl></div><div class="card"><h2>Operation</h2><div class="notice">Operation ID 必须由同一组 target/value/calldata/predecessor/salt 计算。execute 只能在链上 ready 状态执行。</div><form data-form="governance"><div class="field"><label>Target</label><input name="target" placeholder="0x…" required /></div><div class="field"><label>Value（wei）</label><input name="value" value="0" required /></div><div class="field full"><label>Calldata（ABI encoded）</label><textarea name="data" placeholder="0x…" required></textarea></div><div class="field"><label>Predecessor</label><input name="predecessor" value="${ethers.ZeroHash}" required /></div><div class="field"><label>Salt</label><input name="salt" value="${ethers.ZeroHash}" required /></div><div class="field"><label>Delay</label><input name="delay" type="number" min="0" required /></div><div class="form-actions"><button type="button" class="button secondary" data-action="hash-operation">计算 operation ID</button><button type="button" class="button primary" ${state.health.writeAllowed && state.capabilities.timelock ? "" : "disabled"} data-action="schedule-operation">schedule</button><button type="button" class="button" ${state.health.writeAllowed && state.capabilities.timelock ? "" : "disabled"} data-action="execute-operation">execute</button></div><div id="operation-result" class="section"></div></form></div></div>`;
  Promise.all([c("protocolTimelock").getMinDelay(), c("protocolTimelock").enforcedMinimumDelay()])
    .then(([delay, min]) => {
      $("#gov-delay").textContent = `${delay}s`;
      $("#gov-min").textContent = `${min}s`;
    })
    .catch(() => {});
}

function renderActivity() {
  app.innerHTML = `<div class="page-header"><div><div class="eyebrow">Transaction stream</div><h1>Activity</h1><p class="subtitle">本次会话的交易反馈。生产环境应由 Indexer 以确认区块、blockHash 和 reorg 处理后的事件为准。</p></div></div><div class="card">${state.activity.length ? `<div class="table-wrap"><table><thead><tr><th>Action</th><th>Status</th><th>Tx</th><th>Time</th></tr></thead><tbody>${state.activity.map((item) => `<tr><td>${esc(item.label)}</td><td>${item.status === "confirmed" ? statusBadge("confirmed", "green") : statusBadge("submitted", "yellow")}</td><td><a class="mono" href="${txExplorer(item.hash)}" target="_blank" rel="noreferrer">${short(item.hash)}</a></td><td class="muted-text">${esc(item.at)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">当前会话没有交易。</div>`}</div>`;
}

async function selectedFromForm(form) {
  return state.datasets.find(
    (d) => d.id === BigInt(form.dataset.id || form.elements.datasetId.value),
  );
}

async function handleForm(form) {
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "access") {
    const result = await c("entitlementNFT").hasAccess(BigInt(data.datasetId), data.who);
    $("#access-result").innerHTML =
      `<div class="notice ${result ? "" : "warning"}">hasAccess(${esc(data.datasetId)}, ${esc(short(data.who))}) = <strong>${result}</strong></div>`;
    return;
  }
  if (form.dataset.form === "buy") {
    const dataset = state.datasets.find((item) => item.id === BigInt(data.datasetId));
    if (!dataset) throw new Error("Dataset 不存在");
    const kind = Number(form.dataset.kind);
    const listing =
      kind === 0
        ? await c("marketplace").getListing(dataset.id, KIND.Copy)
        : await c("marketplace").getListing(dataset.id, KIND.Exclusive);
    if (!listing.active) throw new Error("ListingNotActive：Listing 当前无效");
    const token = c("paymentToken", true);
    const marketplace = c("marketplaceProxy", true);
    const allowance = await c("paymentToken").allowance(
      state.address,
      state.config.addresses.marketplaceProxy,
    );
    if (allowance < listing.price)
      await send(
        "Approve payment token",
        () => token.approve(state.config.addresses.marketplaceProxy, listing.price),
        "buy",
      );
    const deadline = BigInt(nowSeconds() + 600);
    if (kind === 0)
      await send(
        `Buy Copy #${dataset.id}`,
        () => marketplace.buyCopy(dataset.id, listing.price, deadline),
        "buy",
      );
    else
      await send(
        `Buy Exclusive #${dataset.id}`,
        () => marketplace.buyExclusive(dataset.id, listing.price, deadline),
        "buy",
      );
    return;
  }
  if (form.dataset.form === "register") {
    const manifest = state.manifest ?? JSON.parse(data.manifestJson || "{}");
    const validation = validateWeightsManifest(manifest, {
      datasetId: data.expectedDatasetId,
      chainId: state.config.network.chainId,
      registry: state.config.addresses.datasetRegistry,
      weightsRoot: data.weightsRoot,
      totalWeight: data.totalWeight,
    });
    if (!validation.ok) throw new Error(`Manifest 校验失败：${validation.errors.join("；")}`);
    const policy =
      data.policy === "copy"
        ? [true, false, false, false]
        : data.policy === "exclusive"
          ? [false, true, true, false]
          : [true, true, false, false];
    const params = {
      expectedDatasetId: BigInt(data.expectedDatasetId),
      contentHash: data.contentHash,
      sampleURI: data.sampleURI,
      payloadURI: data.payloadURI,
      weightsRoot: data.weightsRoot,
      totalWeight: BigInt(data.totalWeight),
      weightsURI: data.weightsURI,
      weightsManifestHash: data.weightsManifestHash,
      policy: {
        allowCopy: policy[0],
        allowExclusive: policy[1],
        exclusiveRequiresZeroCopies: policy[2],
        licensesTransferable: false,
      },
      tag: data.tag || "",
    };
    await send(
      "Register Dataset",
      () => c("datasetRegistry", true).registerDataset(params),
      "register",
    );
    return;
  }
  if (form.dataset.form === "claim") {
    const proof = JSON.parse(data.proof);
    if (!Array.isArray(proof)) throw new Error("proof 必须是 JSON 数组");
    await send(
      `Claim Dataset #${data.datasetId}`,
      () => c("revenueSplitter", true).claim(BigInt(data.datasetId), BigInt(data.weight), proof),
      "claim",
    );
    return;
  }
  if (form.dataset.form === "treasury") {
    await send(
      "Withdraw Treasury",
      () => c("revenueSplitter", true).withdrawTreasury(),
      "treasury",
    );
    return;
  }
  if (form.dataset.form === "manage-listing") {
    const id = BigInt(data.datasetId);
    const price = data.price;
    const kind = data.kind;
    if (!price || Number(price) < 0) throw new Error("固定价格必须是非负数");
    if (kind === "copy-list")
      await send(
        `List Copy #${id}`,
        () => c("marketplace", true).listCopy(id, ethers.parseUnits(price, 6)),
        "manageListings",
      );
    else if (kind === "exclusive-list")
      await send(
        `List Exclusive #${id}`,
        () => c("marketplace", true).listExclusiveFixed(id, ethers.parseUnits(price, 6)),
        "manageListings",
      );
    else if (kind === "copy-delist")
      await send(
        `Delist Copy #${id}`,
        () => c("marketplace", true).delist(id, KIND.Copy),
        "manageListings",
      );
    else if (kind === "exclusive-delist")
      await send(
        `Delist Exclusive #${id}`,
        () => c("marketplace", true).delist(id, KIND.Exclusive),
        "manageListings",
      );
    else throw new Error("未知 Listing 操作");
    state.manageDatasetId = null;
    return;
  }
  if (form.dataset.form === "record-challenge") {
    const contract = c("datasetRegistry");
    const values = [BigInt(data.datasetId), data.evidenceHash, data.evidenceURI];
    if (state.roles.admin)
      await send(
        `Record Challenge #${data.datasetId}`,
        () => contract.connect(state.signer).recordChallenge(...values),
        "challenge",
      );
    else
      await submitThroughSafe(
        `Record Challenge #${data.datasetId}`,
        state.config.addresses.datasetRegistry,
        contract.interface.encodeFunctionData("recordChallenge", values),
      );
    return;
  }
  if (form.dataset.form === "resolve-challenge") {
    const contract = c("datasetRegistry");
    const values = [BigInt(data.datasetId), data.upheld === "true"];
    if (state.roles.admin)
      await send(
        `Resolve Challenge #${data.datasetId}`,
        () => contract.connect(state.signer).resolveChallenge(...values),
        "challenge",
      );
    else
      await submitThroughSafe(
        `Resolve Challenge #${data.datasetId}`,
        state.config.addresses.datasetRegistry,
        contract.interface.encodeFunctionData("resolveChallenge", values),
      );
  }
}

async function handleAction(action, node) {
  if (action === "connect") return connectWallet();
  if (action === "refresh") return refresh();
  if (action === "run-health") {
    await healthCheck();
    await refresh();
    return;
  }
  if (action === "select-dataset" || action === "manage-dataset") {
    if (action === "select-dataset") {
      state.selectedDataset = state.datasets.find((item) => item.id === BigInt(node.dataset.id));
      state.page = "detail";
      renderDatasetDetail();
    } else {
      state.manageDatasetId = BigInt(node.dataset.id);
      renderContributor();
    }
    return;
  }
  if (action === "cancel-manage-listing") {
    state.manageDatasetId = null;
    renderContributor();
    return;
  }
  if (action === "validate-manifest") {
    const form = node.closest("form");
    const data = Object.fromEntries(new FormData(form));
    try {
      state.manifest = JSON.parse(data.manifestJson || "{}");
    } catch {
      state.manifest = null;
      $("#manifest-result").innerHTML = '<div class="notice danger">Manifest JSON 格式无效</div>';
      return;
    }
    const result = validateWeightsManifest(state.manifest, {
      datasetId: data.expectedDatasetId,
      chainId: state.config.network.chainId,
      registry: state.config.addresses.datasetRegistry,
      weightsRoot: data.weightsRoot,
      totalWeight: data.totalWeight,
    });
    $("#manifest-result").innerHTML =
      `<div class="notice ${result.ok ? "" : "danger"}">${result.ok ? `Manifest 通过：${result.sum} weights，地址唯一且总和正确。` : result.errors.map(esc).join("<br />")}</div>`;
    return;
  }
  if (action === "preview-claim") {
    const form = node.closest("form");
    const data = Object.fromEntries(new FormData(form));
    if (!data.datasetId) {
      $("#claim-preview").textContent = "请先选择 Dataset。";
      return;
    }
    if (!state.address) {
      $("#claim-preview").textContent = "请先连接钱包。";
      return;
    }
    if (!data.weight || BigInt(data.weight) <= 0n) {
      $("#claim-preview").textContent = "Weight 必须大于 0。";
      return;
    }
    const value = await c("revenueSplitter").claimable(
      BigInt(data.datasetId),
      state.address,
      BigInt(data.weight),
    );
    $("#claim-preview").textContent =
      `预计可领取：${fmtUnits(value)} USDC（最终以交易时链上状态为准）`;
    return;
  }
  if (action === "pause" || action === "unpause") {
    const contract = c("protocolConfig");
    const method = action === "pause" ? "pause" : "unpause";
    if (state.roles.admin)
      return send(
        action === "pause" ? "Pause protocol" : "Unpause protocol",
        () => contract.connect(state.signer)[method](),
        "pause",
      );
    return submitThroughSafe(
      action === "pause" ? "Pause protocol" : "Unpause protocol",
      state.config.addresses.protocolConfig,
      contract.interface.encodeFunctionData(method),
    );
  }
  if (
    action === "hash-operation" ||
    action === "schedule-operation" ||
    action === "execute-operation"
  ) {
    const form = node.closest("form");
    const data = Object.fromEntries(new FormData(form));
    const target = data.target;
    const value = BigInt(data.value || 0);
    const payload = data.data;
    const predecessor = data.predecessor;
    const salt = data.salt;
    const timelock = c("protocolTimelock", action !== "hash-operation");
    const id = await timelock.hashOperation(target, value, payload, predecessor, salt);
    $("#operation-result").innerHTML =
      `<div class="notice">Operation ID：<span class="mono">${esc(id)}</span></div>`;
    if (action === "schedule-operation")
      if (state.roles.proposer)
        await send(
          "Schedule Timelock operation",
          () =>
            timelock
              .connect(state.signer)
              .schedule(target, value, payload, predecessor, salt, BigInt(data.delay)),
          "timelock",
        );
      else
        await submitThroughSafe(
          "Schedule Timelock operation",
          state.config.addresses.protocolTimelock,
          timelock.interface.encodeFunctionData("schedule", [
            target,
            value,
            payload,
            predecessor,
            salt,
            BigInt(data.delay),
          ]),
        );
    if (action === "execute-operation")
      if (state.roles.executor)
        await send(
          "Execute Timelock operation",
          () =>
            timelock
              .connect(state.signer)
              .execute(target, value, payload, predecessor, salt, { value }),
          "timelock",
        );
      else
        await submitThroughSafe(
          "Execute Timelock operation",
          state.config.addresses.protocolTimelock,
          timelock.interface.encodeFunctionData("execute", [
            target,
            value,
            payload,
            predecessor,
            salt,
          ]),
          0n,
        );
  }
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    state.page = nav.dataset.nav;
    history.replaceState(null, "", `#${state.page}`);
    if (state.page === "detail") renderDatasetDetail();
    else render();
    return;
  }
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  try {
    await handleAction(actionNode.dataset.action, actionNode);
  } catch (error) {
    toast(errorText(error), "error");
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  try {
    await handleForm(form);
  } catch (error) {
    toast(errorText(error), "error");
  }
});

window.addEventListener("hashchange", () => {
  state.page = location.hash.slice(1) || "overview";
  render();
});
$("#connect-wallet").addEventListener("click", () =>
  connectWallet().catch((error) => toast(errorText(error), "error")),
);

load().catch((error) => {
  app.innerHTML = `<div class="card"><h2>无法加载协议配置</h2><div class="notice danger">${errorText(error)}</div><p class="small muted-text">请通过 HTTP server 打开 Web，而不是直接双击 index.html；例如在仓库根目录执行 npm run web:dev。</p></div>`;
});

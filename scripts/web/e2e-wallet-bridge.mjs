import http from "node:http";
import { JsonRpcProvider, Wallet, getBytes, isHexString } from "ethers";

const PORT = Number(process.env.E2E_WALLET_BRIDGE_PORT ?? 8787);
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
if (!RPC_URL) throw new Error("BASE_SEPOLIA_RPC_URL is required");

const provider = new JsonRpcProvider(RPC_URL, 84532, { staticNetwork: true });
const firstKey = process.env.SAFE_OWNER_1_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const secondKey = process.env.SAFE_OWNER_2_PRIVATE_KEY || process.env.BUYER_PRIVATE_KEY;
const accountSpecs = {
  buyer: ["BUYER_PRIVATE_KEY", "BUYER_ADDRESS"],
  claimant: ["CLAIMANT_PRIVATE_KEY", "CLAIMANT_ADDRESS"],
  contributor: ["CONTRIBUTOR_PRIVATE_KEY", "CONTRIBUTOR_ADDRESS"],
  operator: ["OPERATOR_PRIVATE_KEY", "OPERATOR_ADDRESS"],
  treasury: ["TREASURY_PRIVATE_KEY", "TREASURY_ADDRESS"],
  safeOwner1: ["SAFE_OWNER_1_PRIVATE_KEY", "SAFE_OWNER_1_ADDRESS"],
  safeOwner2: ["SAFE_OWNER_2_PRIVATE_KEY", "SAFE_OWNER_2_ADDRESS"],
};

const wallets = new Map();
for (const [role, [keyName, addressName]] of Object.entries(accountSpecs)) {
  const key =
    process.env[keyName] ||
    (role === "safeOwner1" ? firstKey : role === "safeOwner2" ? secondKey : null);
  if (!key) continue;
  const wallet = new Wallet(key, provider);
  const expected = process.env[addressName];
  if (expected && wallet.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${role} derived address does not match ${addressName}`);
  }
  wallets.set(role, wallet);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

function body(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => (value += chunk));
    request.on("end", () => resolve(value ? JSON.parse(value) : {}));
    request.on("error", reject);
  });
}

function walletFor(role) {
  const wallet = wallets.get(role);
  if (!wallet) throw new Error(`unknown or unconfigured e2e wallet role: ${role}`);
  return wallet;
}

function hexOrText(value) {
  return isHexString(value) ? getBytes(value) : value;
}

async function handleRpc(role, method, params = []) {
  const wallet = walletFor(role);
  if (method === "eth_chainId") return "0x14a34";
  if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet.address];
  if (method === "eth_sendTransaction") {
    const input = params[0] ?? {};
    if (!input.from || input.from.toLowerCase() !== wallet.address.toLowerCase())
      throw new Error("transaction from does not match selected e2e wallet");
    const tx = { ...input };
    delete tx.from;
    if (tx.gas) {
      tx.gasLimit = tx.gas;
      delete tx.gas;
    }
    const sent = await wallet.sendTransaction(tx);
    return sent.hash;
  }
  if (method === "personal_sign" || method === "eth_sign") {
    const values = params;
    const message = values.find((value) => typeof value === "string" && isHexString(value));
    if (!message) throw new Error(`${method} requires a hex message`);
    return wallet.signMessage(hexOrText(message));
  }
  if (method === "eth_signTypedData_v4") {
    const typed = JSON.parse(params[1]);
    const types = { ...typed.types };
    delete types.EIP712Domain;
    return wallet.signTypedData(typed.domain, types, typed.message);
  }
  return provider.send(method, params);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.url === "/health")
      return json(response, 200, { ok: true, chainId: 84532, roles: [...wallets.keys()] });
    if (request.method !== "POST" || request.url !== "/rpc")
      return json(response, 404, { error: "not found" });
    const payload = await body(request);
    const result = await handleRpc(payload.role, payload.method, payload.params);
    return json(response, 200, { jsonrpc: "2.0", id: payload.id ?? 1, result });
  } catch (error) {
    return json(response, 200, {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`E2E_WALLET_BRIDGE_READY http://127.0.0.1:${PORT}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

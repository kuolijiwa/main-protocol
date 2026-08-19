import fs from "node:fs/promises";
import path from "node:path";
import {
  Contract,
  ContractFactory,
  Signature,
  Wallet,
  ZeroAddress,
  concat,
  getBytes,
  keccak256,
  JsonRpcProvider,
  toBeHex,
} from "ethers";

const args = new Set(process.argv.slice(2));
const root = process.cwd();
const rpcUrl = required("BASE_SEPOLIA_RPC_URL");
const provider = new JsonRpcProvider(rpcUrl);
const owner1 = wallet("SAFE_OWNER_1_PRIVATE_KEY", "SAFE_OWNER_1_ADDRESS");
const owner2 = wallet("SAFE_OWNER_2_PRIVATE_KEY", "SAFE_OWNER_2_ADDRESS");
if (owner1.address.toLowerCase() === owner2.address.toLowerCase()) {
  throw new Error("Safe owners must be distinct");
}

const safeArtifact = await artifact("Safe.sol/Safe.json");
const factoryArtifact = await artifact("proxies/SafeProxyFactory.sol/SafeProxyFactory.json");

if (args.has("--deploy")) {
  requireWrite();
  const singleton = await new ContractFactory(
    safeArtifact.abi,
    safeArtifact.bytecode,
    owner1,
  ).deploy();
  await singleton.waitForDeployment();
  const factory = await new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    owner1,
  ).deploy();
  await factory.waitForDeployment();

  const setup = singleton.interface.encodeFunctionData("setup", [
    [owner1.address, owner2.address],
    2,
    ZeroAddress,
    "0x",
    ZeroAddress,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);
  const singletonAddress = await singleton.getAddress();
  const factoryContract = new Contract(await factory.getAddress(), factoryArtifact.abi, owner1);
  const safeNonce = BigInt(Date.now());
  const safeAddress = await factoryContract
    .getFunction("createProxyWithNonce")
    .staticCall(singletonAddress, setup, safeNonce);
  await (
    await factoryContract.getFunction("createProxyWithNonce")(singletonAddress, setup, safeNonce)
  ).wait();

  const safe = new Contract(safeAddress, safeArtifact.abi, provider);
  const codeHash = keccak256(await provider.getCode(safeAddress));
  const singletonCodeHash = keccak256(await provider.getCode(singletonAddress));
  const result = {
    safe: safeAddress,
    singleton: singletonAddress,
    factory: await factory.getAddress(),
    safeCodeHash: codeHash,
    singletonCodeHash,
    owners: await safe.getFunction("getOwners")(),
    threshold: (await safe.getFunction("getThreshold")()).toString(),
  };
  await writeReport("official-safe-deploy", result);
  console.log(JSON.stringify(result, null, 2));
} else if (args.has("--execute-deployment")) {
  requireWrite();
  const deploymentRecord = JSON.parse(
    await fs.readFile(path.join(root, "deployments/baseSepolia/latest.json"), "utf8"),
  );
  const deployment = deploymentRecord.deployment;
  const safeAddress = required("SAFE_ADDRESS");
  const transactions = deployment.adminTransactions ?? [];
  if (transactions.length !== 6) {
    throw new Error(`expected six deployment transactions, got ${transactions.length}`);
  }
  const safe = new Contract(safeAddress, safeArtifact.abi, owner1);
  const executed = [];
  for (const transaction of transactions) {
    const nonce = await safe.getFunction("nonce")();
    const callArgs = [transaction.to, 0, transaction.data, 0, 0, 0, 0, ZeroAddress, ZeroAddress];
    const transactionHash = await safe
      .getFunction("getTransactionHash")
      .staticCall(...callArgs, nonce);
    const signatures = await Promise.all(
      [owner1, owner2].map(async (owner) => {
        const signature = Signature.from(await owner.signMessage(getBytes(transactionHash)));
        return {
          owner: owner.address.toLowerCase(),
          encoded: concat([signature.r, signature.s, toBeHex(signature.v + 4, 1)]),
        };
      }),
    );
    signatures.sort((left, right) => left.owner.localeCompare(right.owner));
    const sent = await safe.getFunction("execTransaction")(
      ...callArgs,
      concat(signatures.map(({ encoded }) => encoded)),
    );
    const receipt = await sent.wait();
    executed.push({ to: transaction.to, transactionHash, txHash: receipt.hash });
  }
  const result = {
    safe: safeAddress,
    owners: [owner1.address, owner2.address],
    threshold: (await safe.getFunction("getThreshold")()).toString(),
    nonce: (await safe.getFunction("nonce")()).toString(),
    executed,
  };
  await writeReport("official-safe-deployment-execute", result);
  console.log(JSON.stringify(result, null, 2));
} else if (args.has("--execute-call")) {
  requireWrite();
  const safeAddress = required("SAFE_ADDRESS");
  const target = required("SAFE_TARGET");
  const data = required("SAFE_DATA");
  const safe = new Contract(safeAddress, safeArtifact.abi, owner1);
  const nonce = await safe.getFunction("nonce")();
  const callArgs = [target, 0, data, 0, 0, 0, 0, ZeroAddress, ZeroAddress];
  const transactionHash = await safe
    .getFunction("getTransactionHash")
    .staticCall(...callArgs, nonce);
  const signatures = await Promise.all(
    [owner1, owner2].map(async (owner) => {
      const signature = Signature.from(await owner.signMessage(getBytes(transactionHash)));
      return {
        owner: owner.address.toLowerCase(),
        encoded: concat([signature.r, signature.s, toBeHex(signature.v + 4, 1)]),
      };
    }),
  );
  signatures.sort((left, right) => left.owner.localeCompare(right.owner));
  const sent = await safe.getFunction("execTransaction")(
    ...callArgs,
    concat(signatures.map(({ encoded }) => encoded)),
  );
  const receipt = await sent.wait();
  const result = { safe: safeAddress, target, transactionHash, txHash: receipt.hash };
  await writeReport("official-safe-call", result);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error("use --deploy or --execute-deployment");
}

function required(name, fallbackName) {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function wallet(keyName, addressName) {
  const fallbackKey =
    keyName === "SAFE_OWNER_1_PRIVATE_KEY" ? "DEPLOYER_PRIVATE_KEY" : "BUYER_PRIVATE_KEY";
  const fallbackAddress =
    addressName === "SAFE_OWNER_1_ADDRESS" ? "DEPLOYER_ADDRESS" : "BUYER_ADDRESS";
  const signer = new Wallet(required(keyName, fallbackKey), provider);
  const configured = process.env[addressName] ?? process.env[fallbackAddress];
  if (configured && signer.address.toLowerCase() !== configured.toLowerCase()) {
    throw new Error(`${keyName} does not match ${addressName}`);
  }
  return signer;
}

async function artifact(relativePath) {
  return JSON.parse(
    await fs.readFile(
      path.join(
        root,
        "node_modules/@safe-global/safe-smart-account/build/artifacts/contracts",
        relativePath,
      ),
      "utf8",
    ),
  );
}

function requireWrite() {
  if (!args.has("--write") || !args.has("--confirm")) {
    throw new Error("official Safe writes require --write --confirm");
  }
}

async function writeReport(prefix, result) {
  const directory = path.join(root, "reports/base-sepolia-live");
  await fs.mkdir(directory, { recursive: true });
  const filename = `${prefix}-${new Date().toISOString().replace(/[^0-9]/gu, "")}.json`;
  await fs.writeFile(path.join(directory, filename), `${JSON.stringify(result, null, 2)}\n`);
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const ZERO_HASH = /^0x0{64}$/i;
const MANIFEST_SCHEMA = "main-protocol.weights-manifest.v1";
const LEAF_ENCODING = "keccak256(abi.encode(address,uint256))";
const PAIR_HASHING = "sorted-keccak256;promote-unpaired";

function sameAddress(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function validateWeightsManifest(manifest, expected = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object")
    return { ok: false, errors: ["Manifest 必须是 JSON 对象"] };
  if (manifest.schema !== MANIFEST_SCHEMA) errors.push("schema 不匹配");
  if (expected.datasetId != null && String(manifest.datasetId) !== String(expected.datasetId))
    errors.push("datasetId 不匹配");
  if (expected.chainId != null && String(manifest.chainId) !== String(expected.chainId))
    errors.push("chainId 不匹配");
  if (expected.registry && !sameAddress(manifest.datasetRegistry, expected.registry))
    errors.push("DatasetRegistry 地址不匹配");
  if (manifest.leafEncoding !== LEAF_ENCODING) errors.push("leaf encoding 不匹配");
  if (manifest.pairHashing !== PAIR_HASHING) errors.push("pair hashing 不匹配");
  if (!BYTES32.test(manifest.weightsRoot ?? "")) errors.push("weightsRoot 必须是 bytes32");
  if (
    expected.weightsRoot &&
    String(manifest.weightsRoot).toLowerCase() !== String(expected.weightsRoot).toLowerCase()
  )
    errors.push("weightsRoot 与链上承诺不匹配");
  let totalWeight = 0n;
  try {
    totalWeight = BigInt(manifest.totalWeight ?? 0);
  } catch {
    errors.push("totalWeight 格式无效");
  }
  if (totalWeight <= 0n) errors.push("totalWeight 必须大于 0");
  if (expected.totalWeight != null && totalWeight !== BigInt(expected.totalWeight))
    errors.push("totalWeight 与链上承诺不匹配");
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0)
    errors.push("entries 不能为空");

  const seen = new Set();
  let sum = 0n;
  for (const [index, entry] of (manifest.entries ?? []).entries()) {
    if (!entry || !ADDRESS.test(entry.address ?? "")) errors.push(`entries[${index}].address 无效`);
    if (ZERO_ADDRESS.test(entry?.address ?? ""))
      errors.push(`entries[${index}].address 不能为零地址`);
    const key = String(entry?.address ?? "").toLowerCase();
    if (seen.has(key)) errors.push(`entries[${index}] 地址重复`);
    seen.add(key);
    let weight = 0n;
    try {
      weight = BigInt(entry?.weight ?? 0);
    } catch {
      errors.push(`entries[${index}].weight 格式无效`);
    }
    if (weight <= 0n) errors.push(`entries[${index}].weight 必须大于 0`);
    if (weight > totalWeight) errors.push(`entries[${index}].weight 不能大于 totalWeight`);
    sum += weight;
    if (!Array.isArray(entry?.proof)) errors.push(`entries[${index}].proof 必须是数组`);
    else if (entry.proof.some((node) => !BYTES32.test(node)))
      errors.push(`entries[${index}].proof 必须全部是 bytes32`);
  }
  if (sum !== totalWeight) errors.push("entries 权重和必须严格等于 totalWeight");
  const pipeline = manifest.pipeline;
  if (!pipeline || typeof pipeline !== "object") errors.push("pipeline metadata 必须存在");
  else {
    if (typeof pipeline.version !== "string" || !pipeline.version.trim())
      errors.push("pipeline version 必须存在");
    if (
      typeof pipeline.generatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pipeline.generatedAt) ||
      Number.isNaN(Date.parse(pipeline.generatedAt)) ||
      new Date(pipeline.generatedAt).toISOString() !== pipeline.generatedAt
    )
      errors.push("pipeline generatedAt 必须是 canonical UTC timestamp");
    if (!BYTES32.test(pipeline.contentDigest ?? "") || ZERO_HASH.test(pipeline.contentDigest))
      errors.push("pipeline contentDigest 必须是非零 bytes32");
  }
  return { ok: errors.length === 0, errors, sum, totalWeight };
}

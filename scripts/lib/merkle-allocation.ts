import { AbiCoder, concat, getAddress, keccak256, ZeroAddress } from "ethers";

export interface WeightEntry {
  address: string;
  weight: string | bigint;
}

export interface ValidatedWeightAllocation {
  totalWeight: bigint;
  root: string;
  entries: Array<{
    address: string;
    weight: bigint;
    leaf: string;
    proof: string[];
  }>;
}

function sortedPairHash(left: string, right: string): string {
  const pair = left.toLowerCase() < right.toLowerCase() ? [left, right] : [right, left];
  return keccak256(concat(pair));
}

function allocationRoot(leaves: string[]): string {
  let layer = [...leaves].sort((left, right) => left.localeCompare(right));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(
        index + 1 < layer.length ? sortedPairHash(layer[index], layer[index + 1]) : layer[index],
      );
    }
    layer = next;
  }
  return layer[0];
}

function allocationProofs(leaves: string[]): Map<string, string[]> {
  let layer = [...leaves].sort((left, right) => left.localeCompare(right));
  const indexes = new Map(layer.map((leaf, index) => [leaf, index]));
  const proofs = new Map(layer.map((leaf) => [leaf, [] as string[]]));

  while (layer.length > 1) {
    for (const [leaf, proof] of proofs) {
      const index = indexes.get(leaf)!;
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      if (siblingIndex < layer.length) proof.push(layer[siblingIndex]);
      indexes.set(leaf, Math.floor(index / 2));
    }

    const next: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(
        index + 1 < layer.length ? sortedPairHash(layer[index], layer[index + 1]) : layer[index],
      );
    }
    layer = next;
  }
  return proofs;
}

export function validateWeightAllocation(
  entries: WeightEntry[],
  declaredTotalWeight: string | bigint,
): ValidatedWeightAllocation {
  const totalWeight = BigInt(declaredTotalWeight);
  if (totalWeight <= 0n) throw new Error("totalWeight must be greater than zero");
  if (entries.length === 0) throw new Error("weight allocation must contain at least one entry");

  const seen = new Set<string>();
  let sum = 0n;
  const validated = entries.map((entry, index) => {
    let address: string;
    try {
      address = getAddress(entry.address);
    } catch {
      throw new Error(`entry ${index} has an invalid address`);
    }
    if (address === ZeroAddress) throw new Error(`entry ${index} uses the zero address`);
    const key = address.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate weight address: ${address}`);
    seen.add(key);

    const weight = BigInt(entry.weight);
    if (weight <= 0n) throw new Error(`entry ${index} weight must be greater than zero`);
    if (weight > totalWeight) {
      throw new Error(`entry ${index} weight exceeds totalWeight`);
    }
    sum += weight;
    return {
      address,
      weight,
      leaf: keccak256(AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [address, weight])),
    };
  });

  if (sum !== totalWeight) {
    throw new Error(`weight sum mismatch: expected ${totalWeight}, got ${sum}`);
  }

  const proofs = allocationProofs(validated.map(({ leaf }) => leaf));
  return {
    totalWeight,
    root: allocationRoot(validated.map(({ leaf }) => leaf)),
    entries: validated.map((entry) => ({ ...entry, proof: proofs.get(entry.leaf)! })),
  };
}

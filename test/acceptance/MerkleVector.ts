import { expect } from "chai";
import { AbiCoder, concat, keccak256 } from "ethers";
import { readFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers } = await network.create();

interface MerkleVector {
  encoding: string;
  pairing: string;
  totalWeight: string;
  root: string;
  entries: Array<{
    address: string;
    weight: string;
    leaf: string;
    proof: string[];
  }>;
}

function sortedPairHash(left: string, right: string): string {
  const pair = left.toLowerCase() < right.toLowerCase() ? [left, right] : [right, left];
  return keccak256(concat(pair));
}

describe("Cross-system Merkle vector", function () {
  it("matches the fixed off-chain encoding and verifies every proof on-chain", async function () {
    const vector = JSON.parse(
      await readFile(new URL("../../test-vectors/merkle.json", import.meta.url), "utf8"),
    ) as MerkleVector;
    expect(vector.encoding).to.equal("keccak256(abi.encode(address,uint256))");
    expect(vector.pairing).to.equal("sorted-keccak256");
    expect(vector.entries.reduce((sum, entry) => sum + BigInt(entry.weight), 0n)).to.equal(
      BigInt(vector.totalWeight),
    );

    const harness = await ethers.deployContract("MerkleProofHarness");
    for (const entry of vector.entries) {
      const leaf = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [entry.address, BigInt(entry.weight)],
        ),
      );
      expect(leaf).to.equal(entry.leaf);
      expect(sortedPairHash(leaf, entry.proof[0])).to.equal(vector.root);
      expect(
        await harness.verify(entry.address, BigInt(entry.weight), entry.proof, vector.root),
      ).to.equal(true);
    }
  });
});

import { expect } from "chai";
import { MaxUint256 } from "ethers";
import vector from "../../test-vectors/merkle.json" with { type: "json" };
import {
  validateWeightAllocation,
  validateWeightAllocationDocument,
} from "../../scripts/lib/merkle-allocation.js";

describe("Merkle allocation validation", function () {
  const valid = vector.entries.map(({ address, weight }) => ({ address, weight }));

  it("reproduces the fixed cross-system root after enforcing all allocation invariants", function () {
    const allocation = validateWeightAllocation(valid, vector.totalWeight);
    expect(allocation.root).to.equal(vector.root);
    expect(allocation.totalWeight).to.equal(100n);
  });

  it("rejects duplicate addresses regardless of case", function () {
    expect(() =>
      validateWeightAllocation(
        [
          { address: valid[0].address, weight: "50" },
          { address: valid[0].address.toUpperCase().replace("0X", "0x"), weight: "50" },
        ],
        100n,
      ),
    ).to.throw("duplicate weight address");
  });

  it("rejects empty, zero-address, zero-weight, and individually excessive entries", function () {
    expect(() => validateWeightAllocation([], 100n)).to.throw("at least one entry");
    expect(() =>
      validateWeightAllocation(
        [{ address: "0x0000000000000000000000000000000000000000", weight: 100n }],
        100n,
      ),
    ).to.throw("zero address");
    expect(() =>
      validateWeightAllocation([{ address: valid[0].address, weight: 0n }], 100n),
    ).to.throw("greater than zero");
    expect(() =>
      validateWeightAllocation([{ address: valid[0].address, weight: 101n }], 100n),
    ).to.throw("exceeds totalWeight");
  });

  it("rejects allocations whose exact sum differs from totalWeight", function () {
    expect(() => validateWeightAllocation(valid, 101n)).to.throw(
      "weight sum mismatch: expected 101, got 100",
    );
    expect(() => validateWeightAllocation(valid, 99n)).to.throw(
      "weight sum mismatch: expected 99, got 100",
    );
  });

  it("strictly validates the Pipeline allocation document before publication", function () {
    const allocation = validateWeightAllocationDocument({
      totalWeight: vector.totalWeight,
      root: vector.root,
      entries: valid,
    });
    expect(allocation.root).to.equal(vector.root);

    expect(() =>
      validateWeightAllocationDocument({
        totalWeight: vector.totalWeight,
        root: vector.root,
        entries: valid,
        ignoredByOldValidator: true,
      }),
    ).to.throw("unsupported field");
    expect(() =>
      validateWeightAllocationDocument({
        totalWeight: vector.totalWeight,
        entries: [{ ...valid[0], proof: [] }, ...valid.slice(1)],
      }),
    ).to.throw("allocation entry 0 contains unsupported field: proof");
  });

  it("rejects a stale declared root and values outside uint256", function () {
    expect(() =>
      validateWeightAllocationDocument({
        totalWeight: vector.totalWeight,
        root: `0x${"00".repeat(32)}`,
        entries: valid,
      }),
    ).to.throw("allocation root mismatch");
    expect(() =>
      validateWeightAllocation(
        [{ address: valid[0].address, weight: MaxUint256 + 1n }],
        MaxUint256 + 1n,
      ),
    ).to.throw("totalWeight exceeds uint256");
  });
});

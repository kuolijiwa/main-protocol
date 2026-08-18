import { expect } from "chai";
import vector from "../../test-vectors/merkle.json" with { type: "json" };
import { validateWeightAllocation } from "../../scripts/lib/merkle-allocation.js";

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
});

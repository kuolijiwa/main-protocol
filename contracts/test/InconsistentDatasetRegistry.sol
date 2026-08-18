// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    ChallengeStatus,
    Dataset,
    DatasetStatus,
    SalePolicy
} from "../interfaces/IDatasetRegistry.sol";

/// @dev Test-only registry that can expose a state impossible under the real DatasetRegistry.
contract InconsistentDatasetRegistry {
    Dataset private _dataset;

    constructor(address contributor) {
        _dataset = Dataset({
            id: 1,
            contributor: contributor,
            contentHash: bytes32(uint256(1)),
            sampleURI: "ipfs://sample",
            payloadURI: "ipfs://payload",
            weightsRoot: bytes32(uint256(2)),
            totalWeight: 1,
            status: DatasetStatus.Draft,
            policy: SalePolicy({
                allowCopy: true,
                allowExclusive: true,
                exclusiveRequiresZeroCopies: true,
                licensesTransferable: false
            }),
            copiesSold: 0,
            tag: "test-only",
            createdAt: uint64(block.timestamp)
        });
    }

    function getDataset(uint256) external view returns (Dataset memory) {
        return _dataset;
    }

    function markListed(uint256) external {
        _dataset.status = DatasetStatus.Listed;
    }

    function challengeStatus(uint256) external pure returns (ChallengeStatus) {
        return ChallengeStatus.None;
    }

    function weightsInvalidated(uint256) external pure returns (bool) {
        return false;
    }

    function challengeWindowEndsAt(uint256) external pure returns (uint256) {
        return 0;
    }

    function setCopiesSold(uint64 copiesSold) external {
        _dataset.copiesSold = copiesSold;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

enum DatasetStatus {
    Draft,
    Listed,
    ExclusivelySold,
    Delisted
}

enum SaleKind {
    Copy,
    Exclusive
}

enum ChallengeStatus {
    None,
    Pending,
    Rejected,
    Upheld
}

struct SalePolicy {
    bool allowCopy;
    bool allowExclusive;
    bool exclusiveRequiresZeroCopies;
    bool licensesTransferable;
}

struct Dataset {
    uint256 id;
    address contributor;
    bytes32 contentHash;
    string sampleURI;
    string payloadURI;
    bytes32 weightsRoot;
    uint256 totalWeight;
    DatasetStatus status;
    SalePolicy policy;
    uint64 copiesSold;
    string tag;
    uint64 createdAt;
}

interface IDatasetRegistry {
    struct RegisterParams {
        uint256 expectedDatasetId;
        bytes32 contentHash;
        string sampleURI;
        string payloadURI;
        bytes32 weightsRoot;
        uint256 totalWeight;
        string weightsURI;
        bytes32 weightsManifestHash;
        SalePolicy policy;
        string tag;
    }

    function registerDataset(RegisterParams calldata p) external returns (uint256 datasetId);

    function getDataset(uint256 datasetId) external view returns (Dataset memory);

    function nextDatasetId() external view returns (uint256);
    function weightsURI(uint256 datasetId) external view returns (string memory);
    function weightsManifestHash(uint256 datasetId) external view returns (bytes32);
    function WEIGHTS_MANIFEST_VERSION() external view returns (bytes32);

    function challengeWindowEndsAt(uint256 datasetId) external view returns (uint256);
    function challengeStatus(uint256 datasetId) external view returns (ChallengeStatus);
    function challengeEvidenceHash(uint256 datasetId) external view returns (bytes32);
    function challengeEvidenceURI(uint256 datasetId) external view returns (string memory);
    function challengeRecordedAt(uint256 datasetId) external view returns (uint256);
    function challengeResolutionDueAt(uint256 datasetId) external view returns (uint256);
    function CHALLENGE_EVIDENCE_VERSION() external view returns (bytes32);
    function CHALLENGE_RESOLUTION_SLA() external view returns (uint256);
    function weightsInvalidated(uint256 datasetId) external view returns (bool);

    function recordChallenge(
        uint256 datasetId,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external;
    function resolveChallenge(uint256 datasetId, bool upheld) external;

    function markListed(uint256 datasetId) external;
    function markDelisted(uint256 datasetId) external;
    function recordCopySale(uint256 datasetId) external;
    function recordExclusiveSale(uint256 datasetId) external;
}

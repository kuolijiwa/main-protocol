// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ContributorRegistry} from "./ContributorRegistry.sol";
import {ProtocolConfig} from "./ProtocolConfig.sol";
import {
    ChallengeStatus,
    Dataset,
    DatasetStatus,
    IDatasetRegistry
} from "./interfaces/IDatasetRegistry.sol";
import {IMarketplace} from "./interfaces/IMarketplace.sol";

/// @title DatasetRegistry
/// @notice Stores immutable Dataset registrations and protocol-controlled lifecycle state.
contract DatasetRegistry is AccessControl, IDatasetRegistry {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

    ContributorRegistry public immutable contributorRegistry;
    ProtocolConfig public immutable protocolConfig;

    address public marketplace;

    uint256 private _nextDatasetId = 1;
    mapping(uint256 datasetId => Dataset dataset) private _datasets;
    mapping(uint256 datasetId => bool exists) private _datasetExists;

    mapping(uint256 datasetId => uint256 deadline) public override challengeWindowEndsAt;
    mapping(uint256 datasetId => ChallengeStatus status) public override challengeStatus;
    mapping(uint256 datasetId => bytes32 evidenceHash) public override challengeEvidenceHash;
    mapping(uint256 datasetId => bool invalidated) public override weightsInvalidated;

    error ZeroAddress();
    error ProtocolPaused();
    error MarketplaceNotWired();
    error MarketplaceAlreadyWired();
    error InvalidMarketplace(address marketplace);
    error OnlyMarketplace(address caller);
    error UnauthorizedRegistrar(address caller);
    error DatasetNotFound(uint256 datasetId);
    error InvalidContentHash();
    error EmptySampleURI();
    error EmptyPayloadURI();
    error InvalidWeightsRoot();
    error InvalidTotalWeight();
    error NoSaleKindEnabled();
    error TransferableCopyLicenseNotSupported();
    error InvalidDatasetStatus(uint256 datasetId, DatasetStatus status);
    error WeightsPermanentlyInvalidated(uint256 datasetId);
    error ChallengeWindowOpen(uint256 datasetId, uint256 deadline);
    error ChallengeWindowClosed(uint256 datasetId, uint256 deadline);
    error InvalidChallengeTransition(uint256 datasetId, ChallengeStatus status);
    error InvalidEvidenceHash();
    error CopySaleNotAllowed(uint256 datasetId);
    error ExclusiveSaleNotAllowed(uint256 datasetId);
    error CopiesAlreadySold(uint256 datasetId, uint64 copiesSold);

    event DatasetRegistered(
        uint256 indexed datasetId,
        address indexed contributor,
        bytes32 contentHash,
        bytes32 weightsRoot,
        uint256 totalWeight
    );
    event WeightChallengePending(uint256 indexed datasetId, bytes32 indexed evidenceHash);
    event WeightChallengeResolved(uint256 indexed datasetId, bool upheld);
    event MarketplaceWired(address indexed marketplace);

    constructor(
        address contributorRegistry_,
        address protocolConfig_,
        address governanceTimelock,
        address adminMultisig
    ) {
        if (
            contributorRegistry_ == address(0) ||
            protocolConfig_ == address(0) ||
            governanceTimelock == address(0) ||
            adminMultisig == address(0)
        ) {
            revert ZeroAddress();
        }

        contributorRegistry = ContributorRegistry(contributorRegistry_);
        protocolConfig = ProtocolConfig(protocolConfig_);

        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock);
        _grantRole(ADMIN_ROLE, adminMultisig);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert OnlyMarketplace(msg.sender);
        _;
    }

    function setMarketplaceOnce(address marketplace_) external onlyRole(ADMIN_ROLE) {
        if (marketplace != address(0)) revert MarketplaceAlreadyWired();
        if (marketplace_ == address(0) || marketplace_.code.length == 0) {
            revert InvalidMarketplace(marketplace_);
        }

        marketplace = marketplace_;
        emit MarketplaceWired(marketplace_);
    }

    function registerDataset(
        RegisterParams calldata p
    ) external override returns (uint256 datasetId) {
        _requireOperational();
        address contributor = _resolveContributor(msg.sender);
        _validateRegistration(p);

        datasetId = _nextDatasetId++;
        uint64 createdAt = uint64(block.timestamp);

        _datasets[datasetId] = Dataset({
            id: datasetId,
            contributor: contributor,
            contentHash: p.contentHash,
            sampleURI: p.sampleURI,
            payloadURI: p.payloadURI,
            weightsRoot: p.weightsRoot,
            totalWeight: p.totalWeight,
            status: DatasetStatus.Draft,
            policy: p.policy,
            copiesSold: 0,
            tag: p.tag,
            createdAt: createdAt
        });
        _datasetExists[datasetId] = true;
        challengeWindowEndsAt[datasetId] = block.timestamp + protocolConfig.challengeWindow();

        emit DatasetRegistered(datasetId, contributor, p.contentHash, p.weightsRoot, p.totalWeight);
    }

    function getDataset(uint256 datasetId) external view override returns (Dataset memory) {
        _requireDataset(datasetId);
        return _datasets[datasetId];
    }

    function recordChallenge(
        uint256 datasetId,
        bytes32 evidenceHash
    ) external override onlyRole(ADMIN_ROLE) {
        _requireDataset(datasetId);
        uint256 deadline = challengeWindowEndsAt[datasetId];
        if (block.timestamp >= deadline) {
            revert ChallengeWindowClosed(datasetId, deadline);
        }
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();

        ChallengeStatus status = challengeStatus[datasetId];
        if (status != ChallengeStatus.None && status != ChallengeStatus.Rejected) {
            revert InvalidChallengeTransition(datasetId, status);
        }

        challengeStatus[datasetId] = ChallengeStatus.Pending;
        challengeEvidenceHash[datasetId] = evidenceHash;
        emit WeightChallengePending(datasetId, evidenceHash);
    }

    function resolveChallenge(
        uint256 datasetId,
        bool upheld
    ) external override onlyRole(ADMIN_ROLE) {
        _requireDataset(datasetId);
        ChallengeStatus status = challengeStatus[datasetId];
        if (status != ChallengeStatus.Pending) {
            revert InvalidChallengeTransition(datasetId, status);
        }

        if (upheld) {
            challengeStatus[datasetId] = ChallengeStatus.Upheld;
            weightsInvalidated[datasetId] = true;
            _datasets[datasetId].status = DatasetStatus.Delisted;
            IMarketplace(marketplace).invalidateListings(datasetId);
        } else {
            challengeStatus[datasetId] = ChallengeStatus.Rejected;
        }

        emit WeightChallengeResolved(datasetId, upheld);
    }

    function markListed(uint256 datasetId) external override onlyMarketplace {
        _requireOperational();
        _requireDataset(datasetId);
        _requireWeightsUsable(datasetId);

        ChallengeStatus challenge = challengeStatus[datasetId];
        if (challenge == ChallengeStatus.Pending) {
            revert InvalidChallengeTransition(datasetId, challenge);
        }

        DatasetStatus status = _datasets[datasetId].status;
        if (status != DatasetStatus.Draft && status != DatasetStatus.Delisted) {
            revert InvalidDatasetStatus(datasetId, status);
        }
        _datasets[datasetId].status = DatasetStatus.Listed;
    }

    function markDelisted(uint256 datasetId) external override onlyMarketplace {
        _requireDataset(datasetId);
        DatasetStatus status = _datasets[datasetId].status;
        if (status != DatasetStatus.Listed) {
            revert InvalidDatasetStatus(datasetId, status);
        }
        _datasets[datasetId].status = DatasetStatus.Delisted;
    }

    function recordCopySale(uint256 datasetId) external override onlyMarketplace {
        _requireSaleReady(datasetId);
        Dataset storage dataset = _datasets[datasetId];
        if (!dataset.policy.allowCopy) revert CopySaleNotAllowed(datasetId);
        dataset.copiesSold += 1;
    }

    function recordExclusiveSale(uint256 datasetId) external override onlyMarketplace {
        _requireSaleReady(datasetId);
        Dataset storage dataset = _datasets[datasetId];
        if (!dataset.policy.allowExclusive) {
            revert ExclusiveSaleNotAllowed(datasetId);
        }
        if (dataset.policy.exclusiveRequiresZeroCopies && dataset.copiesSold != 0) {
            revert CopiesAlreadySold(datasetId, dataset.copiesSold);
        }
        dataset.status = DatasetStatus.ExclusivelySold;
    }

    function _resolveContributor(address caller) private view returns (address) {
        bytes32 contributorRole = contributorRegistry.CONTRIBUTOR_ROLE();
        if (contributorRegistry.hasRole(contributorRole, caller)) return caller;

        bytes32 operatorRole = contributorRegistry.OPERATOR_ROLE();
        if (!contributorRegistry.hasRole(operatorRole, caller)) {
            revert UnauthorizedRegistrar(caller);
        }

        address contributor = contributorRegistry.operatorContributor(caller);
        if (
            contributor == address(0) || !contributorRegistry.hasRole(contributorRole, contributor)
        ) {
            revert UnauthorizedRegistrar(caller);
        }
        return contributor;
    }

    function _validateRegistration(RegisterParams calldata p) private pure {
        if (p.contentHash == bytes32(0)) revert InvalidContentHash();
        if (bytes(p.sampleURI).length == 0) revert EmptySampleURI();
        if (bytes(p.payloadURI).length == 0) revert EmptyPayloadURI();
        if (p.weightsRoot == bytes32(0)) revert InvalidWeightsRoot();
        if (p.totalWeight == 0) revert InvalidTotalWeight();
        if (!p.policy.allowCopy && !p.policy.allowExclusive) {
            revert NoSaleKindEnabled();
        }
        if (p.policy.licensesTransferable) {
            revert TransferableCopyLicenseNotSupported();
        }
    }

    function _requireOperational() private view {
        if (marketplace == address(0)) revert MarketplaceNotWired();
        if (protocolConfig.paused()) revert ProtocolPaused();
    }

    function _requireDataset(uint256 datasetId) private view {
        if (!_datasetExists[datasetId]) revert DatasetNotFound(datasetId);
    }

    function _requireWeightsUsable(uint256 datasetId) private view {
        if (weightsInvalidated[datasetId]) {
            revert WeightsPermanentlyInvalidated(datasetId);
        }
    }

    function _requireSaleReady(uint256 datasetId) private view {
        if (protocolConfig.paused()) revert ProtocolPaused();
        _requireDataset(datasetId);
        _requireWeightsUsable(datasetId);

        DatasetStatus status = _datasets[datasetId].status;
        if (status != DatasetStatus.Listed) {
            revert InvalidDatasetStatus(datasetId, status);
        }

        uint256 deadline = challengeWindowEndsAt[datasetId];
        if (block.timestamp < deadline) {
            revert ChallengeWindowOpen(datasetId, deadline);
        }

        ChallengeStatus challenge = challengeStatus[datasetId];
        if (challenge != ChallengeStatus.None && challenge != ChallengeStatus.Rejected) {
            revert InvalidChallengeTransition(datasetId, challenge);
        }
    }
}

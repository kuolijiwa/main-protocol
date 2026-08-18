// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ProtocolConfig} from "./ProtocolConfig.sol";
import {ChallengeStatus, Dataset, IDatasetRegistry} from "./interfaces/IDatasetRegistry.sol";
import {IRevenueSplitter} from "./interfaces/IRevenueSplitter.sol";

/// @title RevenueSplitter
/// @notice Accrues fixed-price sale revenue and pays Merkle-identified contributors.
contract RevenueSplitter is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    IRevenueSplitter
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");
    uint256 private constant BPS_DENOMINATOR = 10_000;

    ProtocolConfig public protocolConfig;
    IDatasetRegistry public datasetRegistry;
    address public marketplace;
    address public governanceTimelock;

    uint256 public treasuryBalance;
    uint256 public contributorBalance;
    mapping(uint256 datasetId => uint256 revenue) public cumulativeRevenue;
    mapping(uint256 datasetId => mapping(address claimant => uint256 amount)) public claimed;

    error ZeroAddress();
    error ProtocolPaused();
    error MarketplaceAlreadyWired();
    error InvalidMarketplace(address marketplace);
    error OnlyMarketplace(address caller);
    error InvalidGrossAmount();
    error AccrualNotAvailable(uint256 datasetId);
    error InsufficientTokenBacking(uint256 balance, uint256 required);
    error ClaimNotAvailable(uint256 datasetId);
    error InvalidMerkleProof();
    error NothingToClaim();
    error NoTreasuryBalance();
    error OnlyGovernanceTimelock(address caller);
    error GovernanceRoleLocked(address account);

    event MarketplaceWired(address indexed marketplace);
    event RevenueAccrued(uint256 indexed datasetId, uint256 gross, uint256 fee, uint256 net);
    event RevenueClaimed(uint256 indexed datasetId, address indexed subContributor, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address protocolConfig_,
        address datasetRegistry_,
        address governanceTimelock_,
        address adminMultisig
    ) external initializer {
        if (
            protocolConfig_ == address(0) ||
            datasetRegistry_ == address(0) ||
            governanceTimelock_ == address(0) ||
            adminMultisig == address(0)
        ) {
            revert ZeroAddress();
        }

        __AccessControl_init();
        protocolConfig = ProtocolConfig(protocolConfig_);
        datasetRegistry = IDatasetRegistry(datasetRegistry_);
        governanceTimelock = governanceTimelock_;
        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock_);
        _grantRole(ADMIN_ROLE, adminMultisig);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    function setMarketplaceOnce(address marketplace_) external onlyRole(ADMIN_ROLE) {
        if (marketplace != address(0)) revert MarketplaceAlreadyWired();
        if (marketplace_ == address(0) || marketplace_.code.length == 0) {
            revert InvalidMarketplace(marketplace_);
        }
        marketplace = marketplace_;
        emit MarketplaceWired(marketplace_);
    }

    function accrue(uint256 datasetId, uint256 gross) external override {
        if (msg.sender != marketplace) revert OnlyMarketplace(msg.sender);
        if (protocolConfig.paused()) revert ProtocolPaused();
        if (gross == 0) revert InvalidGrossAmount();

        datasetRegistry.getDataset(datasetId);
        if (!_claimWindowOpen(datasetId)) revert AccrualNotAvailable(datasetId);
        uint256 fee = Math.mulDiv(gross, protocolConfig.feeBps(), BPS_DENOMINATOR);
        uint256 net = gross - fee;

        treasuryBalance += fee;
        contributorBalance += net;
        cumulativeRevenue[datasetId] += net;

        uint256 tokenBalance = _paymentToken().balanceOf(address(this));
        uint256 required = treasuryBalance + contributorBalance;
        if (tokenBalance < required) {
            revert InsufficientTokenBacking(tokenBalance, required);
        }

        emit RevenueAccrued(datasetId, gross, fee, net);
    }

    function claim(
        uint256 datasetId,
        uint256 weight,
        bytes32[] calldata proof
    ) external override nonReentrant {
        if (protocolConfig.paused()) revert ProtocolPaused();
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        if (!_claimWindowOpen(datasetId)) revert ClaimNotAvailable(datasetId);

        bytes32 leaf = keccak256(abi.encode(msg.sender, weight));
        if (!MerkleProof.verifyCalldata(proof, dataset.weightsRoot, leaf)) {
            revert InvalidMerkleProof();
        }

        uint256 entitled = Math.mulDiv(weight, cumulativeRevenue[datasetId], dataset.totalWeight);
        uint256 alreadyClaimed = claimed[datasetId][msg.sender];
        if (entitled <= alreadyClaimed) revert NothingToClaim();
        uint256 owed = entitled - alreadyClaimed;

        claimed[datasetId][msg.sender] = entitled;
        contributorBalance -= owed;
        _paymentToken().safeTransfer(msg.sender, owed);

        emit RevenueClaimed(datasetId, msg.sender, owed);
    }

    function claimable(
        uint256 datasetId,
        address who,
        uint256 weight
    ) external view override returns (uint256) {
        if (who == address(0) || !_claimWindowOpen(datasetId)) return 0;

        try datasetRegistry.getDataset(datasetId) returns (Dataset memory dataset) {
            uint256 entitled = Math.mulDiv(
                weight,
                cumulativeRevenue[datasetId],
                dataset.totalWeight
            );
            uint256 alreadyClaimed = claimed[datasetId][who];
            return entitled > alreadyClaimed ? entitled - alreadyClaimed : 0;
        } catch {
            return 0;
        }
    }

    function withdrawTreasury() external override nonReentrant returns (uint256 amount) {
        amount = treasuryBalance;
        if (amount == 0) revert NoTreasuryBalance();

        address treasury = protocolConfig.treasury();
        treasuryBalance = 0;
        _paymentToken().safeTransfer(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
    }

    function _claimWindowOpen(uint256 datasetId) private view returns (bool) {
        if (datasetRegistry.weightsInvalidated(datasetId)) return false;
        if (block.timestamp < datasetRegistry.challengeWindowEndsAt(datasetId)) {
            return false;
        }
        ChallengeStatus status = datasetRegistry.challengeStatus(datasetId);
        return status == ChallengeStatus.None || status == ChallengeStatus.Rejected;
    }

    function _paymentToken() private view returns (IERC20) {
        return IERC20(protocolConfig.paymentToken());
    }

    /// @dev DEFAULT_ADMIN_ROLE cannot be granted outside the fixed governance timelock.
    function grantRole(bytes32 role, address account) public virtual override {
        if (role == DEFAULT_ADMIN_ROLE && account != governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.grantRole(role, account);
    }

    /// @dev The fixed governance timelock's DEFAULT_ADMIN_ROLE cannot be revoked.
    function revokeRole(bytes32 role, address account) public virtual override {
        if (role == DEFAULT_ADMIN_ROLE && account == governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.revokeRole(role, account);
    }

    /// @dev The fixed governance timelock cannot renounce DEFAULT_ADMIN_ROLE.
    function renounceRole(bytes32 role, address account) public virtual override {
        if (role == DEFAULT_ADMIN_ROLE && account == governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.renounceRole(role, account);
    }

    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != governanceTimelock) revert OnlyGovernanceTimelock(msg.sender);
    }

    uint256[43] private __gap;
}

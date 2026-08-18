// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ProtocolConfig} from "./ProtocolConfig.sol";
import {
    Dataset,
    DatasetStatus,
    IDatasetRegistry,
    SaleKind
} from "./interfaces/IDatasetRegistry.sol";
import {IEntitlementNFT} from "./interfaces/IEntitlementNFT.sol";
import {IMarketplace, Listing} from "./interfaces/IMarketplace.sol";
import {IRevenueSplitter} from "./interfaces/IRevenueSplitter.sol";

/// @title Marketplace
/// @notice Fixed-price Copy and Exclusive listings for Main Protocol V1.
contract Marketplace is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    IMarketplace
{
    using SafeERC20 for IERC20;

    ProtocolConfig public protocolConfig;
    IDatasetRegistry public datasetRegistry;
    IEntitlementNFT public entitlementNFT;
    IRevenueSplitter public revenueSplitter;
    address public governanceTimelock;

    mapping(uint256 datasetId => mapping(SaleKind kind => Listing listing)) private _listings;

    error ZeroAddress();
    error ProtocolPaused();
    error DatasetNotOwned(uint256 datasetId, address caller);
    error InvalidPrice();
    error ListingAlreadyActive(uint256 datasetId, SaleKind kind);
    error ListingNotActive(uint256 datasetId, SaleKind kind);
    error SaleKindNotAllowed(uint256 datasetId, SaleKind kind);
    error ExclusiveRequiresZeroCopies(uint256 datasetId, uint64 copiesSold);
    error DatasetNotPurchasable(uint256 datasetId);
    error DatasetNotListable(uint256 datasetId);
    error DuplicateCopyLicense(uint256 datasetId, address buyer);
    error PurchasePriceChanged(uint256 expectedPrice, uint256 actualPrice);
    error PurchaseDeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error ListingFeeExceeded(uint16 maxFeeBps, uint16 currentFeeBps);
    error IncorrectTokenTransfer(uint256 expected, uint256 received);
    error OnlyDatasetRegistry(address caller);
    error OnlyGovernanceTimelock(address caller);
    error GovernanceRoleLocked(address account);

    event CopyListed(uint256 indexed datasetId, uint256 price, uint16 maxFeeBps);
    event ExclusiveListed(uint256 indexed datasetId, uint256 price, uint16 maxFeeBps);
    event ListingDelisted(uint256 indexed datasetId, SaleKind kind);
    event CopyPurchased(uint256 indexed datasetId, address indexed buyer, uint256 price);
    event ExclusivePurchased(uint256 indexed datasetId, address indexed buyer, uint256 price);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address protocolConfig_,
        address datasetRegistry_,
        address entitlementNFT_,
        address revenueSplitter_,
        address governanceTimelock_
    ) external initializer {
        if (
            protocolConfig_ == address(0) ||
            datasetRegistry_ == address(0) ||
            entitlementNFT_ == address(0) ||
            revenueSplitter_ == address(0) ||
            governanceTimelock_ == address(0)
        ) {
            revert ZeroAddress();
        }
        __AccessControl_init();
        protocolConfig = ProtocolConfig(protocolConfig_);
        datasetRegistry = IDatasetRegistry(datasetRegistry_);
        entitlementNFT = IEntitlementNFT(entitlementNFT_);
        revenueSplitter = IRevenueSplitter(revenueSplitter_);
        governanceTimelock = governanceTimelock_;
        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock_);
    }

    function listCopy(uint256 datasetId, uint256 price) external override {
        _list(datasetId, SaleKind.Copy, price);
    }

    function listExclusiveFixed(uint256 datasetId, uint256 price) external override {
        _list(datasetId, SaleKind.Exclusive, price);
    }

    function delist(uint256 datasetId, SaleKind kind) external override {
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        if (dataset.contributor != msg.sender) {
            revert DatasetNotOwned(datasetId, msg.sender);
        }
        Listing storage listing = _listings[datasetId][kind];
        if (!listing.active) revert ListingNotActive(datasetId, kind);

        listing.active = false;
        emit ListingDelisted(datasetId, kind);
        if (
            !_listings[datasetId][SaleKind.Copy].active &&
            !_listings[datasetId][SaleKind.Exclusive].active
        ) {
            datasetRegistry.markDelisted(datasetId);
        }
    }

    function buyCopy(
        uint256 datasetId,
        uint256 expectedPrice,
        uint256 deadline
    ) external override nonReentrant {
        Listing storage listing = _requirePurchase(
            datasetId,
            SaleKind.Copy,
            expectedPrice,
            deadline
        );
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        uint256 id = entitlementNFT.tokenId(datasetId, SaleKind.Copy);
        if (entitlementNFT.balanceOf(msg.sender, id) != 0) {
            revert DuplicateCopyLicense(datasetId, msg.sender);
        }

        uint256 price = listing.price;
        _collectAndAccrue(datasetId, price);
        entitlementNFT.mint(msg.sender, datasetId, SaleKind.Copy);
        datasetRegistry.recordCopySale(datasetId);

        if (dataset.policy.exclusiveRequiresZeroCopies) {
            _deactivate(datasetId, SaleKind.Exclusive);
        }
        emit CopyPurchased(datasetId, msg.sender, price);
    }

    function buyExclusive(
        uint256 datasetId,
        uint256 expectedPrice,
        uint256 deadline
    ) external override nonReentrant {
        Listing storage listing = _requirePurchase(
            datasetId,
            SaleKind.Exclusive,
            expectedPrice,
            deadline
        );
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        if (dataset.policy.exclusiveRequiresZeroCopies && dataset.copiesSold != 0) {
            revert ExclusiveRequiresZeroCopies(datasetId, dataset.copiesSold);
        }

        uint256 price = listing.price;
        _collectAndAccrue(datasetId, price);
        datasetRegistry.recordExclusiveSale(datasetId);
        _deactivate(datasetId, SaleKind.Copy);
        _deactivate(datasetId, SaleKind.Exclusive);
        entitlementNFT.mint(msg.sender, datasetId, SaleKind.Exclusive);
        emit ExclusivePurchased(datasetId, msg.sender, price);
    }

    function priceOf(uint256 datasetId, SaleKind kind) external view override returns (uint256) {
        Listing storage listing = _listings[datasetId][kind];
        return listing.active ? listing.price : 0;
    }

    function invalidateListings(uint256 datasetId) external override {
        if (msg.sender != address(datasetRegistry)) {
            revert OnlyDatasetRegistry(msg.sender);
        }
        _deactivate(datasetId, SaleKind.Copy);
        _deactivate(datasetId, SaleKind.Exclusive);
    }

    function getListing(
        uint256 datasetId,
        SaleKind kind
    ) external view override returns (Listing memory) {
        Listing memory listing = _listings[datasetId][kind];
        if (listing.datasetId == 0) {
            return Listing(datasetId, kind, 0, 0, false);
        }
        return listing;
    }

    function _list(uint256 datasetId, SaleKind kind, uint256 price) private {
        if (protocolConfig.paused()) revert ProtocolPaused();
        if (price == 0) revert InvalidPrice();
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        if (dataset.contributor != msg.sender) {
            revert DatasetNotOwned(datasetId, msg.sender);
        }
        uint8 challenge = uint8(datasetRegistry.challengeStatus(datasetId));
        if (
            dataset.status == DatasetStatus.ExclusivelySold ||
            datasetRegistry.weightsInvalidated(datasetId) ||
            challenge == 1 ||
            challenge == 3
        ) {
            revert DatasetNotListable(datasetId);
        }
        if (kind == SaleKind.Copy && !dataset.policy.allowCopy) {
            revert SaleKindNotAllowed(datasetId, kind);
        }
        if (kind == SaleKind.Exclusive) {
            if (!dataset.policy.allowExclusive) {
                revert SaleKindNotAllowed(datasetId, kind);
            }
            if (dataset.policy.exclusiveRequiresZeroCopies && dataset.copiesSold != 0) {
                revert ExclusiveRequiresZeroCopies(datasetId, dataset.copiesSold);
            }
        }
        Listing storage listing = _listings[datasetId][kind];
        if (listing.active) revert ListingAlreadyActive(datasetId, kind);

        uint16 maxFeeBps = protocolConfig.feeBps();
        _listings[datasetId][kind] = Listing(datasetId, kind, price, maxFeeBps, true);
        if (dataset.status != DatasetStatus.Listed) {
            datasetRegistry.markListed(datasetId);
        }
        if (kind == SaleKind.Copy) emit CopyListed(datasetId, price, maxFeeBps);
        else emit ExclusiveListed(datasetId, price, maxFeeBps);
    }

    function _requirePurchase(
        uint256 datasetId,
        SaleKind kind,
        uint256 expectedPrice,
        uint256 deadline
    ) private view returns (Listing storage listing) {
        if (protocolConfig.paused()) revert ProtocolPaused();
        listing = _listings[datasetId][kind];
        if (!listing.active) revert ListingNotActive(datasetId, kind);
        if (block.timestamp > deadline) {
            revert PurchaseDeadlineExpired(deadline, block.timestamp);
        }
        if (listing.price != expectedPrice) {
            revert PurchasePriceChanged(expectedPrice, listing.price);
        }
        uint16 currentFeeBps = protocolConfig.feeBps();
        if (currentFeeBps > listing.maxFeeBps) {
            revert ListingFeeExceeded(listing.maxFeeBps, currentFeeBps);
        }
        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        if (
            dataset.status != DatasetStatus.Listed ||
            datasetRegistry.weightsInvalidated(datasetId) ||
            block.timestamp < datasetRegistry.challengeWindowEndsAt(datasetId)
        ) {
            revert DatasetNotPurchasable(datasetId);
        }
        uint8 challenge = uint8(datasetRegistry.challengeStatus(datasetId));
        if (challenge != 0 && challenge != 2) revert DatasetNotPurchasable(datasetId);
    }

    function _collectAndAccrue(uint256 datasetId, uint256 price) private {
        IERC20 token = IERC20(protocolConfig.paymentToken());
        address splitter = address(revenueSplitter);
        uint256 beforeBalance = token.balanceOf(splitter);
        token.safeTransferFrom(msg.sender, splitter, price);
        uint256 received = token.balanceOf(splitter) - beforeBalance;
        if (received != price) revert IncorrectTokenTransfer(price, received);
        revenueSplitter.accrue(datasetId, price);
    }

    function _deactivate(uint256 datasetId, SaleKind kind) private {
        Listing storage listing = _listings[datasetId][kind];
        if (listing.active) {
            listing.active = false;
            emit ListingDelisted(datasetId, kind);
        }
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

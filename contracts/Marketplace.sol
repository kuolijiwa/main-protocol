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
import {IMarketplace} from "./interfaces/IMarketplace.sol";
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

    struct Listing {
        uint256 datasetId;
        SaleKind kind;
        uint256 price;
        bool active;
    }

    ProtocolConfig public protocolConfig;
    IDatasetRegistry public datasetRegistry;
    IEntitlementNFT public entitlementNFT;
    IRevenueSplitter public revenueSplitter;

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
    error IncorrectTokenTransfer(uint256 expected, uint256 received);
    error OnlyDatasetRegistry(address caller);

    event CopyListed(uint256 indexed datasetId, uint256 price);
    event ExclusiveListed(uint256 indexed datasetId, uint256 price);
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
        address governanceTimelock
    ) external initializer {
        if (
            protocolConfig_ == address(0) ||
            datasetRegistry_ == address(0) ||
            entitlementNFT_ == address(0) ||
            revenueSplitter_ == address(0) ||
            governanceTimelock == address(0)
        ) {
            revert ZeroAddress();
        }
        __AccessControl_init();
        protocolConfig = ProtocolConfig(protocolConfig_);
        datasetRegistry = IDatasetRegistry(datasetRegistry_);
        entitlementNFT = IEntitlementNFT(entitlementNFT_);
        revenueSplitter = IRevenueSplitter(revenueSplitter_);
        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock);
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

    function buyCopy(uint256 datasetId) external override nonReentrant {
        Listing storage listing = _requirePurchase(datasetId, SaleKind.Copy);
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

    function buyExclusive(uint256 datasetId) external override nonReentrant {
        Listing storage listing = _requirePurchase(datasetId, SaleKind.Exclusive);
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

    function getListing(uint256 datasetId, SaleKind kind) external view returns (Listing memory) {
        return _listings[datasetId][kind];
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

        _listings[datasetId][kind] = Listing(datasetId, kind, price, true);
        if (dataset.status != DatasetStatus.Listed) {
            datasetRegistry.markListed(datasetId);
        }
        if (kind == SaleKind.Copy) emit CopyListed(datasetId, price);
        else emit ExclusiveListed(datasetId, price);
    }

    function _requirePurchase(
        uint256 datasetId,
        SaleKind kind
    ) private view returns (Listing storage listing) {
        if (protocolConfig.paused()) revert ProtocolPaused();
        listing = _listings[datasetId][kind];
        if (!listing.active) revert ListingNotActive(datasetId, kind);
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

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    uint256[44] private __gap;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {FixedGovernanceAccessControl} from "./utils/FixedGovernanceAccessControl.sol";
import {
    Dataset,
    DatasetStatus,
    IDatasetRegistry,
    SaleKind
} from "./interfaces/IDatasetRegistry.sol";
import {IEntitlementNFT} from "./interfaces/IEntitlementNFT.sol";

/// @title EntitlementNFT
/// @notice ERC-1155 access rights for non-transferable Copy licenses and transferable Exclusive titles.
contract EntitlementNFT is ERC1155, FixedGovernanceAccessControl, IEntitlementNFT {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

    IDatasetRegistry public immutable datasetRegistry;
    address public marketplace;

    mapping(uint256 id => bool transferable) private _isTransferableExclusiveToken;
    mapping(uint256 datasetId => bool minted) public exclusiveMinted;

    error MarketplaceAlreadyWired();
    error InvalidMarketplace(address marketplace);
    error OnlyMarketplace(address caller);
    error CopyLicenseNonTransferable(uint256 tokenId);
    error DuplicateCopyLicense(uint256 datasetId, address owner);
    error ExclusiveTitleAlreadyMinted(uint256 datasetId);
    error InvalidMintState(uint256 datasetId, DatasetStatus status, SaleKind kind);

    event MarketplaceWired(address indexed marketplace);

    constructor(
        address datasetRegistry_,
        address governanceTimelock_,
        address adminMultisig
    ) ERC1155("") FixedGovernanceAccessControl(governanceTimelock_) {
        if (datasetRegistry_ == address(0) || adminMultisig == address(0)) {
            revert ZeroAddress();
        }

        datasetRegistry = IDatasetRegistry(datasetRegistry_);
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

    function tokenId(uint256 datasetId, SaleKind kind) public pure override returns (uint256) {
        return uint256(keccak256(abi.encode(datasetId, kind)));
    }

    function balanceOf(
        address account,
        uint256 id
    ) public view override(ERC1155, IEntitlementNFT) returns (uint256) {
        return super.balanceOf(account, id);
    }

    function mint(address to, uint256 datasetId, SaleKind kind) external override {
        if (msg.sender != marketplace) revert OnlyMarketplace(msg.sender);
        if (to == address(0)) revert ZeroAddress();

        Dataset memory dataset = datasetRegistry.getDataset(datasetId);
        uint256 id = tokenId(datasetId, kind);

        if (kind == SaleKind.Copy) {
            if (dataset.status != DatasetStatus.Listed) {
                revert InvalidMintState(datasetId, dataset.status, kind);
            }
            if (balanceOf(to, id) != 0) {
                revert DuplicateCopyLicense(datasetId, to);
            }
        } else {
            if (dataset.status != DatasetStatus.ExclusivelySold) {
                revert InvalidMintState(datasetId, dataset.status, kind);
            }
            if (exclusiveMinted[datasetId]) {
                revert ExclusiveTitleAlreadyMinted(datasetId);
            }
            exclusiveMinted[datasetId] = true;
            _isTransferableExclusiveToken[id] = true;
        }

        _mint(to, id, 1, "");
    }

    function hasAccess(uint256 datasetId, address who) external view override returns (bool) {
        if (who == address(0)) return false;

        try datasetRegistry.getDataset(datasetId) returns (Dataset memory dataset) {
            if (dataset.status == DatasetStatus.ExclusivelySold) {
                return balanceOf(who, tokenId(datasetId, SaleKind.Exclusive)) != 0;
            }
            return
                balanceOf(who, tokenId(datasetId, SaleKind.Copy)) != 0 ||
                balanceOf(who, tokenId(datasetId, SaleKind.Exclusive)) != 0;
        } catch {
            return false;
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; ++i) {
                // Exclusive titles become transferable when minted. Every other ID is
                // rejected, which also covers a computed Copy token ID before its first mint.
                if (!_isTransferableExclusiveToken[ids[i]]) {
                    revert CopyLicenseNonTransferable(ids[i]);
                }
            }
        }
        super._update(from, to, ids, values);
    }
}

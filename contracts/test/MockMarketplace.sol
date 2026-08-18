// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDatasetRegistry, SaleKind} from "../interfaces/IDatasetRegistry.sol";
import {IEntitlementNFT} from "../interfaces/IEntitlementNFT.sol";
import {IRevenueSplitter} from "../interfaces/IRevenueSplitter.sol";

contract MockMarketplace {
    IDatasetRegistry public immutable datasetRegistry;
    address public entitlementNFT;
    address public revenueSplitter;
    mapping(uint256 datasetId => uint256 calls) public invalidationCalls;
    bool public rejectInvalidation;

    error OnlyDatasetRegistry(address caller);
    error InvalidationRejected();

    constructor(address datasetRegistry_) {
        datasetRegistry = IDatasetRegistry(datasetRegistry_);
    }

    function setBindings(address entitlementNFT_, address revenueSplitter_) external {
        entitlementNFT = entitlementNFT_;
        revenueSplitter = revenueSplitter_;
    }

    function setRejectInvalidation(bool reject) external {
        rejectInvalidation = reject;
    }

    function invalidateListings(uint256 datasetId) external {
        if (msg.sender != address(datasetRegistry)) {
            revert OnlyDatasetRegistry(msg.sender);
        }
        if (rejectInvalidation) revert InvalidationRejected();
        invalidationCalls[datasetId] += 1;
    }

    function markListed(uint256 datasetId) external {
        datasetRegistry.markListed(datasetId);
    }

    function markDelisted(uint256 datasetId) external {
        datasetRegistry.markDelisted(datasetId);
    }

    function recordCopySale(uint256 datasetId) external {
        datasetRegistry.recordCopySale(datasetId);
    }

    function recordExclusiveSale(uint256 datasetId) external {
        datasetRegistry.recordExclusiveSale(datasetId);
    }

    function mintEntitlement(
        address entitlementNFT_,
        address to,
        uint256 datasetId,
        SaleKind kind
    ) external {
        IEntitlementNFT(entitlementNFT_).mint(to, datasetId, kind);
    }

    function accrueRevenue(address revenueSplitter_, uint256 datasetId, uint256 gross) external {
        IRevenueSplitter(revenueSplitter_).accrue(datasetId, gross);
    }
}

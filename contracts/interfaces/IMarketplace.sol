// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SaleKind} from "./IDatasetRegistry.sol";

struct Listing {
    uint256 datasetId;
    SaleKind kind;
    uint256 price;
    uint16 maxFeeBps;
    bool active;
}

interface IMarketplace {
    function listCopy(uint256 datasetId, uint256 price) external;
    function listExclusiveFixed(uint256 datasetId, uint256 price) external;
    function delist(uint256 datasetId, SaleKind kind) external;

    function buyCopy(uint256 datasetId, uint256 expectedPrice, uint256 deadline) external;
    function buyExclusive(uint256 datasetId, uint256 expectedPrice, uint256 deadline) external;

    function priceOf(uint256 datasetId, SaleKind kind) external view returns (uint256);
    function getListing(uint256 datasetId, SaleKind kind) external view returns (Listing memory);

    function invalidateListings(uint256 datasetId) external;
}

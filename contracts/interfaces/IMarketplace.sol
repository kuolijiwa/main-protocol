// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SaleKind} from "./IDatasetRegistry.sol";

interface IMarketplace {
    function listCopy(uint256 datasetId, uint256 price) external;
    function listExclusiveFixed(uint256 datasetId, uint256 price) external;
    function delist(uint256 datasetId, SaleKind kind) external;

    function buyCopy(uint256 datasetId) external;
    function buyExclusive(uint256 datasetId) external;

    function priceOf(uint256 datasetId, SaleKind kind) external view returns (uint256);

    function invalidateListings(uint256 datasetId) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SaleKind} from "./IDatasetRegistry.sol";

interface IEntitlementNFT {
    function mint(address to, uint256 datasetId, SaleKind kind) external;
    function tokenId(uint256 datasetId, SaleKind kind) external pure returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function hasAccess(uint256 datasetId, address who) external view returns (bool);
}

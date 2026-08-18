// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal reverse-dependency views used before irreversible Marketplace wiring.
interface IMarketplaceBindings {
    function datasetRegistry() external view returns (address);
    function entitlementNFT() external view returns (address);
    function revenueSplitter() external view returns (address);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Marketplace} from "../Marketplace.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract MarketplaceV2 is Marketplace {
    function version() external pure returns (uint256) {
        return 2;
    }
}

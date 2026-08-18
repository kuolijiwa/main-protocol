// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RevenueSplitter} from "../RevenueSplitter.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract RevenueSplitterV2 is RevenueSplitter {
    function version() external pure returns (uint256) {
        return 2;
    }
}

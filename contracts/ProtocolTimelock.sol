// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title ProtocolTimelock
/// @notice Self-administered 48-hour governance timelock for Main Protocol V1.
contract ProtocolTimelock is TimelockController {
    uint256 public constant PROTOCOL_MIN_DELAY = 48 hours;

    error ZeroAddress();

    constructor(
        address governanceMultisig
    )
        TimelockController(
            PROTOCOL_MIN_DELAY,
            _singleton(governanceMultisig),
            _singleton(governanceMultisig),
            address(0)
        )
    {}

    function _singleton(address account) private pure returns (address[] memory accounts) {
        if (account == address(0)) revert ZeroAddress();
        accounts = new address[](1);
        accounts[0] = account;
    }
}

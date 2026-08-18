// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title ProtocolTimelock
/// @notice Self-administered 48-hour governance timelock for Main Protocol V1.
contract ProtocolTimelock is TimelockController {
    uint256 public constant PROTOCOL_MIN_DELAY = 48 hours;

    error ZeroAddress();
    error MinimumDelayTooShort(uint256 requestedDelay, uint256 minimumDelay);
    error GovernanceRoleLocked(address account);

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

    /// @notice Allows governance to increase the delay but never reduce it below 48 hours.
    function updateDelay(uint256 newDelay) public override {
        if (newDelay < PROTOCOL_MIN_DELAY) {
            revert MinimumDelayTooShort(newDelay, PROTOCOL_MIN_DELAY);
        }
        super.updateDelay(newDelay);
    }

    /// @dev The Timelock remains its sole DEFAULT_ADMIN_ROLE holder.
    function grantRole(bytes32 role, address account) public override {
        if (role == DEFAULT_ADMIN_ROLE && account != address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.grantRole(role, account);
    }

    /// @dev The Timelock cannot revoke its own DEFAULT_ADMIN_ROLE.
    function revokeRole(bytes32 role, address account) public override {
        if (role == DEFAULT_ADMIN_ROLE && account == address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.revokeRole(role, account);
    }

    /// @dev The Timelock cannot renounce its own DEFAULT_ADMIN_ROLE.
    function renounceRole(bytes32 role, address account) public override {
        if (role == DEFAULT_ADMIN_ROLE && account == address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.renounceRole(role, account);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

/// @title ProtocolTimelock
/// @notice Self-administered 48-hour governance timelock for Main Protocol V1.
contract ProtocolTimelock is TimelockController, AccessControlEnumerable {
    uint256 public constant PROTOCOL_MIN_DELAY = 48 hours;
    uint256 public constant TEST_MIN_DELAY = 1 minutes;
    uint256 public immutable enforcedMinimumDelay;

    error ZeroAddress();
    error MinimumDelayTooShort(uint256 requestedDelay, uint256 minimumDelay);
    error InvalidInitialDelay(uint256 requestedDelay, bool shortDelayTestMode);
    error GovernanceRoleLocked(address account);

    constructor(
        address governanceMultisig,
        uint256 initialDelay,
        bool shortDelayTestMode
    )
        TimelockController(
            initialDelay,
            _singleton(governanceMultisig),
            _singleton(governanceMultisig),
            address(0)
        )
    {
        if (shortDelayTestMode) {
            if (initialDelay < TEST_MIN_DELAY || initialDelay >= PROTOCOL_MIN_DELAY) {
                revert InvalidInitialDelay(initialDelay, true);
            }
        } else if (initialDelay < PROTOCOL_MIN_DELAY) {
            revert InvalidInitialDelay(initialDelay, false);
        }
        enforcedMinimumDelay = initialDelay;
    }

    function _singleton(address account) private pure returns (address[] memory accounts) {
        if (account == address(0)) revert ZeroAddress();
        accounts = new address[](1);
        accounts[0] = account;
    }

    /// @notice Allows governance to increase the delay but never reduce it below 48 hours.
    function updateDelay(uint256 newDelay) public override {
        if (newDelay < enforcedMinimumDelay) {
            revert MinimumDelayTooShort(newDelay, enforcedMinimumDelay);
        }
        super.updateDelay(newDelay);
    }

    /// @dev The Timelock remains its sole DEFAULT_ADMIN_ROLE holder.
    function grantRole(
        bytes32 role,
        address account
    ) public override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account != address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.grantRole(role, account);
    }

    /// @dev The Timelock cannot revoke its own DEFAULT_ADMIN_ROLE.
    function revokeRole(
        bytes32 role,
        address account
    ) public override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account == address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.revokeRole(role, account);
    }

    /// @dev The Timelock cannot renounce its own DEFAULT_ADMIN_ROLE.
    function renounceRole(
        bytes32 role,
        address account
    ) public override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account == address(this)) {
            revert GovernanceRoleLocked(account);
        }
        super.renounceRole(role, account);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(TimelockController, AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _grantRole(
        bytes32 role,
        address account
    ) internal override(AccessControl, AccessControlEnumerable) returns (bool) {
        return super._grantRole(role, account);
    }

    function _revokeRole(
        bytes32 role,
        address account
    ) internal override(AccessControl, AccessControlEnumerable) returns (bool) {
        return super._revokeRole(role, account);
    }
}

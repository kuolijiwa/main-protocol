// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title FixedGovernanceAccessControl
/// @notice Permanently binds DEFAULT_ADMIN_ROLE to one governance timelock.
abstract contract FixedGovernanceAccessControl is AccessControlEnumerable {
    address public immutable governanceTimelock;

    error ZeroAddress();
    error OnlyGovernanceTimelock(address caller);
    error GovernanceRoleLocked(address account);

    constructor(address governanceTimelock_) {
        if (governanceTimelock_ == address(0)) revert ZeroAddress();
        governanceTimelock = governanceTimelock_;
        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock_);
    }

    modifier onlyGovernanceTimelock() {
        if (msg.sender != governanceTimelock) revert OnlyGovernanceTimelock(msg.sender);
        _;
    }

    /// @dev DEFAULT_ADMIN_ROLE cannot be granted to any account other than the fixed timelock.
    function grantRole(
        bytes32 role,
        address account
    ) public virtual override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account != governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.grantRole(role, account);
    }

    /// @dev The fixed timelock's DEFAULT_ADMIN_ROLE cannot be revoked.
    function revokeRole(
        bytes32 role,
        address account
    ) public virtual override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account == governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.revokeRole(role, account);
    }

    /// @dev The fixed timelock cannot renounce DEFAULT_ADMIN_ROLE.
    function renounceRole(
        bytes32 role,
        address account
    ) public virtual override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE && account == governanceTimelock) {
            revert GovernanceRoleLocked(account);
        }
        super.renounceRole(role, account);
    }
}

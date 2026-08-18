// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ContributorRegistry
/// @notice Manages Main Protocol contributor/operator permissions and operator attribution.
contract ContributorRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");
    bytes32 public constant CONTRIBUTOR_ROLE = keccak256("CONTRIBUTOR");

    mapping(address operator => address contributor) private _operatorContributors;

    error ZeroAddress();
    error OperatorNotAllowlisted(address operator);
    error ContributorNotAllowlisted(address contributor);

    event OperatorContributorUpdated(
        address indexed operator,
        address indexed previousContributor,
        address indexed newContributor
    );

    /// @param governanceTimelock Address that holds DEFAULT_ADMIN_ROLE.
    /// @param adminMultisig Address that holds the operational ADMIN_ROLE.
    constructor(address governanceTimelock, address adminMultisig) {
        if (governanceTimelock == address(0) || adminMultisig == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock);
        _grantRole(ADMIN_ROLE, adminMultisig);

        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, ADMIN_ROLE);
        _setRoleAdmin(CONTRIBUTOR_ROLE, ADMIN_ROLE);
    }

    /// @notice Returns the contributor that an operator may represent.
    function operatorContributor(address operator) external view returns (address) {
        return _operatorContributors[operator];
    }

    /// @notice Assigns one allowlisted contributor to an allowlisted operator.
    /// @dev Passing address(0) as contributor clears the assignment.
    function setOperatorContributor(
        address operator,
        address contributor
    ) external onlyRole(ADMIN_ROLE) {
        if (operator == address(0)) revert ZeroAddress();

        if (contributor != address(0)) {
            if (!hasRole(OPERATOR_ROLE, operator)) {
                revert OperatorNotAllowlisted(operator);
            }
            if (!hasRole(CONTRIBUTOR_ROLE, contributor)) {
                revert ContributorNotAllowlisted(contributor);
            }
        }

        address previousContributor = _operatorContributors[operator];
        _operatorContributors[operator] = contributor;

        emit OperatorContributorUpdated(operator, previousContributor, contributor);
    }
}

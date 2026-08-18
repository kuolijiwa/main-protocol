// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev Test-only Safe-compatible surface for deployment-script integration tests.
contract MockSafe {
    using Address for address;

    address[] private _owners;
    uint256 private immutable _threshold;

    error NotOwner(address caller);
    constructor(address[] memory owners_, uint256 threshold_) {
        _owners = owners_;
        _threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        bool owner;
        for (uint256 i = 0; i < _owners.length; ++i) {
            if (_owners[i] == msg.sender) {
                owner = true;
                break;
            }
        }
        if (!owner) revert NotOwner(msg.sender);

        return target.functionCall(data);
    }
}

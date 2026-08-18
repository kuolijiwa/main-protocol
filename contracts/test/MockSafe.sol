// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev Test-only Safe-compatible surface for deployment-script integration tests.
contract MockSafe {
    using Address for address;

    // Slot zero mirrors a SafeProxy singleton pointer so deployment validation
    // can exercise singleton pinning without weakening its production checks.
    address private _singleton;
    address[] private _owners;
    uint256 private immutable _threshold;
    address private _testModule;

    bytes32 private constant GUARD_STORAGE_SLOT = keccak256("guard_manager.guard.address");
    bytes32 private constant FALLBACK_HANDLER_STORAGE_SLOT = keccak256(
        "fallback_manager.handler.address"
    );

    error NotOwner(address caller);
    constructor(address[] memory owners_, uint256 threshold_) {
        _singleton = address(this);
        _owners = owners_;
        _threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function getModulesPaginated(
        address start,
        uint256
    ) external view returns (address[] memory array, address next) {
        if (_testModule == address(0)) {
            array = new address[](0);
            return (array, start);
        }
        array = new address[](1);
        array[0] = _testModule;
        next = start;
    }

    function setTestModule(address module) external {
        _testModule = module;
    }

    function setTestGuard(address guard) external {
        bytes32 slot = GUARD_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            sstore(slot, guard)
        }
    }

    function setTestFallbackHandler(address handler) external {
        bytes32 slot = FALLBACK_HANDLER_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            sstore(slot, handler)
        }
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

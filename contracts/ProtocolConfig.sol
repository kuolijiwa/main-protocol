// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ProtocolConfig
/// @notice Shared immutable and governance-controlled configuration for Main Protocol V1.
contract ProtocolConfig is AccessControl, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

    uint16 public constant MAX_FEE_BPS = 10_000;

    address public immutable paymentToken;
    uint16 public feeBps;
    address public treasury;
    uint64 public challengeWindow;
    address public gatewaySigner;

    error ZeroAddress();
    error InvalidFeeBps(uint256 feeBps);
    error InvalidChallengeWindow();

    event FeeBpsUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event ChallengeWindowUpdated(uint64 previousWindow, uint64 newWindow);
    event GatewaySignerUpdated(address indexed previousSigner, address indexed newSigner);

    constructor(
        address paymentToken_,
        uint16 feeBps_,
        address treasury_,
        uint64 challengeWindow_,
        address gatewaySigner_,
        address governanceTimelock,
        address adminMultisig
    ) {
        if (
            paymentToken_ == address(0) ||
            treasury_ == address(0) ||
            gatewaySigner_ == address(0) ||
            governanceTimelock == address(0) ||
            adminMultisig == address(0)
        ) {
            revert ZeroAddress();
        }
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFeeBps(feeBps_);
        if (challengeWindow_ == 0) revert InvalidChallengeWindow();

        paymentToken = paymentToken_;
        feeBps = feeBps_;
        treasury = treasury_;
        challengeWindow = challengeWindow_;
        gatewaySigner = gatewaySigner_;

        _grantRole(DEFAULT_ADMIN_ROLE, governanceTimelock);
        _grantRole(ADMIN_ROLE, adminMultisig);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /// @notice Updates the fee applied to future purchases.
    function setFeeBps(uint16 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFeeBps(newFeeBps);

        uint16 previousFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeBpsUpdated(previousFeeBps, newFeeBps);
    }

    /// @notice Updates the recipient of later treasury withdrawals.
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();

        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury);
    }

    /// @notice Updates the review window snapshotted by future Dataset registrations.
    function setChallengeWindow(uint64 newChallengeWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newChallengeWindow == 0) revert InvalidChallengeWindow();

        uint64 previousWindow = challengeWindow;
        challengeWindow = newChallengeWindow;
        emit ChallengeWindowUpdated(previousWindow, newChallengeWindow);
    }

    /// @notice Updates the public identity used for Gateway-signed responses.
    function setGatewaySigner(address newGatewaySigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newGatewaySigner == address(0)) revert ZeroAddress();

        address previousSigner = gatewaySigner;
        gatewaySigner = newGatewaySigner;
        emit GatewaySignerUpdated(previousSigner, newGatewaySigner);
    }

    /// @notice Immediately pauses protected Main Protocol operations.
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes protected Main Protocol operations.
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRevenueSplitter {
    function accrue(uint256 datasetId, uint256 gross) external;

    function claim(uint256 datasetId, uint256 weight, bytes32[] calldata proof) external;

    function claimable(
        uint256 datasetId,
        address who,
        uint256 weight
    ) external view returns (uint256);

    function withdrawTreasury() external returns (uint256 amount);

    function rescueToken(address token, address recipient, uint256 amount) external;
}

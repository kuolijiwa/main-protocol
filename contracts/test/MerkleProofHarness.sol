// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @dev Test-only verifier for the protocol's documented Dataset weight vector.
contract MerkleProofHarness {
    function verify(
        address account,
        uint256 weight,
        bytes32[] calldata proof,
        bytes32 root
    ) external pure returns (bool) {
        bytes32 node = keccak256(abi.encode(account, weight));
        return MerkleProof.verifyCalldata(proof, root, node);
    }
}

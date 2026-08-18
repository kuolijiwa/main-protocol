// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IMarketplace} from "../interfaces/IMarketplace.sol";

contract ReentrantERC20 is ERC20 {
    address public marketplace;
    uint256 public datasetId;
    uint256 public expectedPrice;
    bool public attackEnabled;
    bool public reentryBlocked;

    constructor() ERC20("Reentrant Token", "REENTRANT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureAttack(
        address marketplace_,
        uint256 datasetId_,
        uint256 expectedPrice_
    ) external {
        marketplace = marketplace_;
        datasetId = datasetId_;
        expectedPrice = expectedPrice_;
        attackEnabled = true;
        reentryBlocked = false;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (attackEnabled) {
            attackEnabled = false;
            try IMarketplace(marketplace).buyCopy(datasetId, expectedPrice, type(uint256).max) {
                reentryBlocked = false;
            } catch {
                reentryBlocked = true;
            }
        }
        return super.transferFrom(from, to, value);
    }
}

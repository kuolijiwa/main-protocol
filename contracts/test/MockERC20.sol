// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    address public feeSender;
    uint16 public transferFeeBps;
    mapping(address account => bool blocked) public blocked;

    error MockTokenBlocked(address account);

    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setOutboundFee(address sender, uint16 feeBps) external {
        feeSender = sender;
        transferFeeBps = feeBps;
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (msg.sender == feeSender && transferFeeBps != 0) {
            uint256 fee = (value * transferFeeBps) / 10_000;
            _transfer(msg.sender, to, value - fee);
            _burn(msg.sender, fee);
            return true;
        }
        return super.transfer(to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && blocked[from]) revert MockTokenBlocked(from);
        if (to != address(0) && blocked[to]) revert MockTokenBlocked(to);
        super._update(from, to, value);
    }
}

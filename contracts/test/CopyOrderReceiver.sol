// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDatasetRegistry} from "../interfaces/IDatasetRegistry.sol";
import {IMarketplace} from "../interfaces/IMarketplace.sol";

contract CopyOrderReceiver is ERC1155Holder {
    IERC20 public immutable paymentToken;
    IMarketplace public immutable marketplace;
    IDatasetRegistry public immutable datasetRegistry;

    uint256 public buyingDatasetId;
    uint64 public copiesSoldObservedDuringMint;

    constructor(address paymentToken_, address marketplace_, address datasetRegistry_) {
        paymentToken = IERC20(paymentToken_);
        marketplace = IMarketplace(marketplace_);
        datasetRegistry = IDatasetRegistry(datasetRegistry_);
    }

    function buyCopy(uint256 datasetId, uint256 price) external {
        buyingDatasetId = datasetId;
        paymentToken.approve(address(marketplace), price);
        marketplace.buyCopy(datasetId, price, type(uint256).max);
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public override returns (bytes4) {
        copiesSoldObservedDuringMint = datasetRegistry.getDataset(buyingDatasetId).copiesSold;
        return this.onERC1155Received.selector;
    }
}

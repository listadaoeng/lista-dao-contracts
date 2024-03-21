// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ISnBnbStakeManager } from "../snbnb/interfaces/ISnBnbStakeManager.sol";

contract SlisBnbOracle is Initializable {

  AggregatorV3Interface internal priceFeed;
  // @dev Stake Manager Address
  address internal constant stakeManagerAddr = 0x1adB950d8bB3dA4bE104211D5AB038628e477fE6;
  // @dev new price feed
  address internal constant bnbPriceFeedAddr = 0x55328A2dF78C5E379a3FeE693F47E6d4279C2193;

  function initialize(address aggregatorAddress) external initializer {
    priceFeed = AggregatorV3Interface(aggregatorAddress);
  }

  /**
   * Returns the latest price
   */
  function peek() public view returns (bytes32, bool) {
    (
    /*uint80 roundID*/,
      int price,
    /*uint startedAt*/,
      uint timeStamp,
    /*uint80 answeredInRound*/
    ) = AggregatorV3Interface(bnbPriceFeedAddr).latestRoundData();

    require(block.timestamp - timeStamp < 300, "BnbOracle/timestamp-too-old");

    if (price < 0) {
      return (0, false);
    }
    return (bytes32(uint(price) * (10**10) * ISnBnbStakeManager(stakeManagerAddr).convertBnbToSnBnb(1 ether)), true);
  }
}

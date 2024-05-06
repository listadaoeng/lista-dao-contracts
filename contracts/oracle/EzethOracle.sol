// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract EzethOracle is Initializable {

    AggregatorV3Interface internal priceFeed;
    AggregatorV3Interface internal ezethEthPriceFeed;
    address public _admin;
    //bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    function initialize(address ethUsdAddr,address ezethEthAddr) external initializer {
        priceFeed = AggregatorV3Interface(ethUsdAddr);
        ezethEthPriceFeed = AggregatorV3Interface(ezethEthAddr);
        //_admin = admin;
    }

/*    function updateAddress(address ethUsdAddr,address ezethEthAddr) external {
        //require(msg.sender == _admin, "EzethOracle: not admin");
        priceFeed = AggregatorV3Interface(ethUsdAddr);
        ezethEthPriceFeed = AggregatorV3Interface(ezethEthAddr);
    }*/

    /**
      * Returns the latest price
      */
    function peek() public view returns (bytes32, bool) {
        (
        /*uint80 roundID*/,
            int price1,
        /*uint startedAt*/,
            uint timeStamp1,
        /*uint80 answeredInRound*/
        ) = priceFeed.latestRoundData();

        require(block.timestamp - timeStamp1 < 300, "EthUsdOracle/timestamp-too-old");

        return (bytes32(uint(price1) * (10**10)), true);
    }
}
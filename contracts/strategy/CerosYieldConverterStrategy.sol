//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../masterVault/interfaces/IMasterVault.sol";
import "../ceros/interfaces/IBinancePool.sol";
import "../ceros/interfaces/ICertToken.sol";
import "../ceros/interfaces/ICerosRouter.sol";
import "./BaseStrategy.sol";

contract CerosYieldConverterStrategy is BaseStrategy {

    ICerosRouter private _ceRouter;
    ICertToken private _certToken;
    IBinancePool private _binancePool; 
    IMasterVault public vault;

    event BinancePoolChanged(address binancePool);
    event CeRouterChanged(address ceRouter);

    /// @dev initialize function - Constructor for Upgradable contract, can be only called once during deployment
    /// @param destination Address of the ceros router contract
    /// @param feeRecipient Address of the fee recipient
    /// @param underlyingToken Address of the underlying token(wMatic)
    /// @param certToekn Address of aBNBc token
    /// @param masterVault Address of the masterVault contract
    /// @param binancePool Address of binancePool contract
    function initialize(
        address destination,
        address feeRecipient,
        address underlyingToken,
        address certToekn,
        address masterVault,
        address binancePool
    ) public initializer {
        __BaseStrategy_init(destination, feeRecipient, underlyingToken);
        _ceRouter = ICerosRouter(destination);
        _certToken = ICertToken(certToekn);
        _binancePool = IBinancePool(binancePool);
        vault = IMasterVault(masterVault);
        underlying.approve(address(destination), type(uint256).max);
        underlying.approve(address(vault), type(uint256).max);
        _certToken.approve(binancePool, type(uint256).max);
    }

    /**
     * Modifiers
     */
    modifier onlyVault() {
        require(msg.sender == address(vault), "!vault");
        _;
    }

    /// @dev deposits the given amount of underlying tokens into ceros
    function deposit() external payable onlyVault returns(uint256 value) {
        // require(amount <= underlying.balanceOf(address(this)), "insufficient balance");
        uint256 amount = msg.value;
        require(amount <= address(this).balance, "insufficient balance");
        return _deposit(amount);
    }

    /// @dev deposits all the available underlying tokens into ceros
    function depositAll() external payable onlyVault returns(uint256 value) {
        // uint256 amount = underlying.balanceOf(address(this));
        // return _deposit(amount);
        return _deposit(address(this).balance);
    }

    /// @dev internal function to deposit the given amount of underlying tokens into ceros
    /// @param amount amount of underlying tokens
    function _deposit(uint256 amount) internal returns (uint256 value) {
        require(!depositPaused, "deposits are paused");
        require(amount > 0, "invalid amount");
        if (canDeposit(amount)) {
            return _ceRouter.deposit{value: amount}();
        }
    }

    /// @dev withdraws the given amount of underlying tokens from ceros and transfers to masterVault
    /// @param amount amount of underlying tokens
    function withdraw(address recipient, uint256 amount) onlyVault external returns(uint256 value) {
        return _withdraw(recipient, amount);
    }

    /// @dev withdraws everything from ceros and transfers to masterVault
    function panic() external onlyStrategist returns (uint256 value) {
        (,, uint256 debt) = vault.strategyParams(address(this));
        return _withdraw(address(vault), debt);
    }

    /// @dev internal function to withdraw the given amount of underlying tokens from ceros
    ///      and transfers to masterVault
    /// @param amount amount of underlying tokens
    /// @return value - returns the amount of underlying tokens withdrawn from ceros
    function _withdraw(address recipient, uint256 amount) internal returns (uint256 value) {
        require(amount > 0, "invalid amount");
        // uint256 wethBalance = underlying.balanceOf(address(this));
        uint256 ethBalance = address(this).balance;
        if(amount < ethBalance) {
            underlying.transfer(recipient, amount);
            return amount;
        } else {
            value = _ceRouter.withdraw(recipient, amount);
            require(value <= amount, "invalid out amount");
            return amount;
        }
    }

    receive() external payable {}

    function canDeposit(uint256 amount) public view returns(bool) {
        uint256 minimumStake = IBinancePool(_binancePool).getMinimumStake();
        uint256 relayerFee = _binancePool.getRelayerFee();
        return (amount >= minimumStake + relayerFee);
    }

    function assessDepositFee(uint256 amount) public view returns(uint256) {
        return amount - _binancePool.getRelayerFee();
    }

    /// @dev claims yeild from ceros in aBNBc and transfers to feeRecipient
    function harvest() external onlyStrategist {
        _harvestTo(feeRecipient);
    }

    /// @dev internal function to claim yeild from ceros in aBNBc and transfer them to desired address
    function _harvestTo(address to) private returns(uint256 yield) {
        yield = _ceRouter.getYieldFor(address(this));
        if(yield > 0) {
            yield = _ceRouter.claim(to);
        }
        uint256 profit = _ceRouter.getProfitFor(address(this));
        if(profit > 0) {
            yield += profit;
            _ceRouter.claimProfit(to);
        }
    }

    /// @dev only owner can change swap pool address
    /// @param binancePool new swap pool address
    function changeBinancePool(address binancePool) external onlyOwner {
        require(binancePool != address(0));
        _certToken.approve(address(_binancePool), 0);
        _binancePool = IBinancePool(binancePool);
        _certToken.approve(address(_binancePool), type(uint256).max);
        emit BinancePoolChanged(binancePool);
    }

    /// @dev only owner can change ceRouter
    /// @param ceRouter new ceros router address
    function changeCeRouter(address ceRouter) external onlyOwner {
        require(ceRouter != address(0));
        underlying.approve(address(_ceRouter), 0);
        destination = ceRouter;
        _ceRouter = ICerosRouter(ceRouter);
        underlying.approve(address(_ceRouter), type(uint256).max);
        emit CeRouterChanged(ceRouter);
    }
}
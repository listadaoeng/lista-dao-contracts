// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Pot is Initializable, ReentrancyGuardUpgradeable {
    // --- Wrapper ---
    using SafeERC20Upgradeable for IERC20Upgradeable;
    // --- Auth ---
    mapping (address => uint) public wards;
    function rely(address guy) external auth { wards[guy] = 1; }
    function deny(address guy) external auth { wards[guy] = 0; }
    modifier auth {
        require(wards[msg.sender] == 1, "Pot/not-authorized");
        _;
    }

    // --- Data ---
    string public name;
    string public symbol;
    uint8 public decimals;
    uint public totalSupply;  //total savings
    mapping(address => uint) public balanceOf;


    uint256 public dsr;  // the Dai Savings Rate
    uint256 public chi;  // the Rate Accumulator

    //VatLike public vat;  // CDP engine
    //address public vow;  // debt engine
    uint256 public rho;  // time of last drip

    uint256 public live;  // Access Flag

    uint public flashLoanDelay;  // Anti flash loan time  [sec]
    address public HAY;          // The HAY Stable Coin
    uint public exitDelay;       // User unstake delay    [sec]

    mapping(address => uint) public operators;  // Operators of contract
    mapping(address => uint) public rewards;      // Accumulated rewards
    mapping(address => uint) public withdrawn;    // Capital withdrawn
    mapping(address => uint) public chiPaid;      // HAY per share paid
    mapping(address => uint) public unstakeTime;  // Time of Unstake
    mapping(address => uint) public stakeTime;    // Time of Stake

    event OperatorSet(address operator);
    event OperatorUnset(address operator);
    event Join(address indexed user, uint indexed amount);
    event Exit(address indexed user, uint indexed amount);
    event Redeem(address[] indexed user);
    event Replenished(uint reward);

    function initialize(string memory _name, string memory _symbol, address _hayToken, uint _exitDelay, uint _flashLoanDelay) external initializer {
        __ReentrancyGuard_init();
        wards[msg.sender] = 1;
        decimals = 18;
        name = _name;
        symbol = _symbol;
        HAY = _hayToken;
        exitDelay = _exitDelay;
        flashLoanDelay = _flashLoanDelay;

        dsr = ONE;
        chi = ONE;
        rho = block.timestamp;
        live = 1;
    }

    // --- Math ---
    uint256 constant ONE = 10 ** 27;
    function rpow(uint x, uint n, uint base) internal pure returns (uint z) {
        assembly {
            switch x case 0 {switch n case 0 {z := base} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := base } default { z := x }
                let half := div(base, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if lt(xxRound, xx) { revert(0,0) }
                    x := div(xxRound, base)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if lt(zxRound, zx) { revert(0,0) }
                        z := div(zxRound, base)
                    }
                }
            }
        }
    }

    function rmul(uint x, uint y) internal pure returns (uint z) {
        unchecked {
            z = x * y;
            require(y == 0 || z / y == x);
            z = z / ONE;
        }
    }


    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x);
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x);
    }

    function mul(uint x, int y) internal pure returns (int z) {
        unchecked {
            z = int(x) * y;
            require(int(x) >= 0);
            require(y == 0 || z / y == int(x));
        }
    }

    function file(bytes32 what, uint256 data) external auth update(address(0)) {
        require(live == 1, "Pot/not-live");
        if (what == "dsr") dsr = data;
        else revert("Pot/file-unrecognized-param");
    }

    function cage() external auth update(address(0)) {
        live = 0;
        dsr = ONE;
    }

    modifier authOrOperator {
        require(operators[msg.sender] == 1 || wards[msg.sender] == 1, "Jar/not-auth-or-operator");
        _;
    }


    function replenish(uint wad) external authOrOperator update(address(0)) {
        IERC20(HAY).transferFrom(msg.sender, address(this), wad);
        emit Replenished(wad);
    }


    modifier update(address account) {
        drip();
        if (account != address(0)) {
            rewards[account] = earned(account);
            chiPaid[account] = chi;
        }
        _;
    }

    function drip() public returns (uint tmp) {
        require(block.timestamp >= rho, "Pot/invalid-now");
        tmp = rmul(rpow(dsr, block.timestamp - rho, ONE), chi);
        uint delta_chi = tmp - chi;
        uint delta_rho = block.timestamp - rho;
        rho = block.timestamp;
        chi = tmp;
    }


    function earned(address account) public view returns (uint) {
        uint unpaidChi = chi - (chiPaid[account] == 0? ONE : chiPaid[account]);
        return (((balanceOf[account] + rewards[account]) * unpaidChi) / 1e27) + rewards[account];
    }

    function join(uint256 wad) external update(msg.sender) nonReentrant {
        require(live == 1, "Pot/not-live");

        balanceOf[msg.sender] += wad;
        totalSupply += wad;
        stakeTime[msg.sender] = block.timestamp + flashLoanDelay;

        IERC20(HAY).transferFrom(msg.sender, address(this), wad);
        emit Join(msg.sender, wad);
    }

    function exit(uint256 wad) external update(msg.sender) nonReentrant {
        require(live == 1, "Pot/not-live");
        require(block.timestamp > stakeTime[msg.sender], "Pot/flash-loan-delay");
        if (wad > 0) {
            balanceOf[msg.sender] -= wad;
            totalSupply -= wad;
            withdrawn[msg.sender] += wad;
        }
        if (exitDelay <= 0) {
            // Immediate claim
            address[] memory accounts = new address[](1);
            accounts[0] = msg.sender;
            _redeemHelper(accounts);
        } else {
            unstakeTime[msg.sender] = block.timestamp + exitDelay;
        }

        emit Exit(msg.sender, wad);
    }
    function redeemBatch(address[] memory accounts) external nonReentrant {
        // Allow direct and on-behalf redemption
        require(live == 1, "Pot/not-live");
        _redeemHelper(accounts);
    }
    function _redeemHelper(address[] memory accounts) private {
        for (uint i = 0; i < accounts.length; i++) {
            if (block.timestamp < unstakeTime[accounts[i]] && unstakeTime[accounts[i]] != 0 && exitDelay != 0)
                continue;
            uint _amount = rewards[accounts[i]] + withdrawn[accounts[i]];
            if (_amount > 0) {
                rewards[accounts[i]] = 0;
                withdrawn[accounts[i]] = 0;
                IERC20(HAY).transfer(accounts[i], _amount);
            }
        }

        emit Redeem(accounts);
    }


    function addOperator(address _operator) external auth {
        operators[_operator] = 1;
        emit OperatorSet(_operator);
    }

    function removeOperator(address _operator) external auth {
        operators[_operator] = 0;
        emit OperatorUnset(_operator);
    }
}

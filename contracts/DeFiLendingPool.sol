// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract DeFiLendingPool {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant YEAR = 365 days;

    IERC20 public immutable asset;

    uint256 public baseRatePerYear = 0.02e18;
    uint256 public slopeRatePerYear = 0.18e18;
    uint256 public reserveFactor = 0.10e18;
    uint256 public collateralFactor = 0.75e18;

    uint256 public totalSupplyPrincipal;
    uint256 public totalBorrowPrincipal;

    uint256 public supplyIndex = WAD;
    uint256 public borrowIndex = WAD;
    uint256 public lastAccrualTimestamp;

    struct UserPosition {
        uint256 supplyPrincipal;
        uint256 borrowPrincipal;
        uint256 supplyIndexSnapshot;
        uint256 borrowIndexSnapshot;
    }

    mapping(address => UserPosition) public positions;

    event Deposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event InterestAccrued(
        uint256 supplyIndex,
        uint256 borrowIndex,
        uint256 totalSupply,
        uint256 totalBorrow,
        uint256 borrowRatePerYear,
        uint256 supplyRatePerYear
    );

    constructor(IERC20 _asset) {
        asset = _asset;
        lastAccrualTimestamp = block.timestamp;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");

        accrueInterest();
        _accrueUser(msg.sender);

        asset.safeTransferFrom(msg.sender, address(this), amount);

        positions[msg.sender].supplyPrincipal += amount;
        totalSupplyPrincipal += amount;

        emit Deposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        require(amount > 0, "amount=0");

        accrueInterest();
        _accrueUser(msg.sender);

        UserPosition storage user = positions[msg.sender];
        uint256 nextBorrow = user.borrowPrincipal + amount;
        require(_isHealthy(user.supplyPrincipal, nextBorrow), "insufficient collateral");
        require(asset.balanceOf(address(this)) >= amount, "insufficient pool liquidity");

        user.borrowPrincipal = nextBorrow;
        totalBorrowPrincipal += amount;

        asset.safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external returns (uint256 repaid) {
        require(amount > 0, "amount=0");

        accrueInterest();
        _accrueUser(msg.sender);

        UserPosition storage user = positions[msg.sender];
        require(user.borrowPrincipal > 0, "no debt");

        repaid = amount > user.borrowPrincipal ? user.borrowPrincipal : amount;

        asset.safeTransferFrom(msg.sender, address(this), repaid);

        user.borrowPrincipal -= repaid;
        totalBorrowPrincipal -= repaid;

        emit Repaid(msg.sender, repaid);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "amount=0");

        accrueInterest();
        _accrueUser(msg.sender);

        UserPosition storage user = positions[msg.sender];
        require(user.supplyPrincipal >= amount, "insufficient supply");

        uint256 nextSupply = user.supplyPrincipal - amount;
        require(_isHealthy(nextSupply, user.borrowPrincipal), "would become undercollateralized");
        require(asset.balanceOf(address(this)) >= amount, "insufficient pool liquidity");

        user.supplyPrincipal = nextSupply;
        totalSupplyPrincipal -= amount;

        asset.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function accrueInterest() public {
        uint256 dt = block.timestamp - lastAccrualTimestamp;
        if (dt == 0) {
            return;
        }

        (
            uint256 projectedSupply,
            uint256 projectedBorrow,
            uint256 projectedSupplyIndex,
            uint256 projectedBorrowIndex,
            uint256 borrowRate,
            uint256 supplyRate
        ) = previewState();

        totalSupplyPrincipal = projectedSupply;
        totalBorrowPrincipal = projectedBorrow;
        supplyIndex = projectedSupplyIndex;
        borrowIndex = projectedBorrowIndex;
        lastAccrualTimestamp = block.timestamp;

        emit InterestAccrued(
            supplyIndex,
            borrowIndex,
            totalSupplyPrincipal,
            totalBorrowPrincipal,
            borrowRate,
            supplyRate
        );
    }

    function previewState()
        public
        view
        returns (
            uint256 projectedSupply,
            uint256 projectedBorrow,
            uint256 projectedSupplyIndex,
            uint256 projectedBorrowIndex,
            uint256 borrowRate,
            uint256 supplyRate
        )
    {
        uint256 dt = block.timestamp - lastAccrualTimestamp;

        uint256 util = _utilization(totalSupplyPrincipal, totalBorrowPrincipal);
        (borrowRate, supplyRate) = _ratesFromUtilization(util);

        projectedSupply = totalSupplyPrincipal;
        projectedBorrow = totalBorrowPrincipal;
        projectedSupplyIndex = supplyIndex;
        projectedBorrowIndex = borrowIndex;

        if (dt == 0) {
            return (
                projectedSupply,
                projectedBorrow,
                projectedSupplyIndex,
                projectedBorrowIndex,
                borrowRate,
                supplyRate
            );
        }

        uint256 borrowGrowth = WAD + ((borrowRate * dt) / YEAR);
        uint256 supplyGrowth = WAD + ((supplyRate * dt) / YEAR);

        projectedBorrow = _wadMul(projectedBorrow, borrowGrowth);
        projectedSupply = _wadMul(projectedSupply, supplyGrowth);
        projectedBorrowIndex = _wadMul(projectedBorrowIndex, borrowGrowth);
        projectedSupplyIndex = _wadMul(projectedSupplyIndex, supplyGrowth);
    }

    function userAccount(address user)
        external
        view
        returns (uint256 supplied, uint256 borrowed, uint256 availableToBorrow)
    {
        UserPosition memory p = positions[user];

        (, , uint256 projectedSupplyIndex, uint256 projectedBorrowIndex, , ) = previewState();

        supplied = p.supplyPrincipal;
        borrowed = p.borrowPrincipal;

        if (supplied > 0 && p.supplyIndexSnapshot > 0) {
            supplied = (supplied * projectedSupplyIndex) / p.supplyIndexSnapshot;
        }
        if (borrowed > 0 && p.borrowIndexSnapshot > 0) {
            borrowed = (borrowed * projectedBorrowIndex) / p.borrowIndexSnapshot;
        }

        uint256 maxBorrow = _wadMul(supplied, collateralFactor);
        availableToBorrow = maxBorrow > borrowed ? maxBorrow - borrowed : 0;
    }

    function currentRates() external view returns (uint256 borrowRate, uint256 supplyRate, uint256 utilization) {
        utilization = _utilization(totalSupplyPrincipal, totalBorrowPrincipal);
        (borrowRate, supplyRate) = _ratesFromUtilization(utilization);
    }

    function _accrueUser(address user) internal {
        UserPosition storage p = positions[user];

        if (p.supplyIndexSnapshot == 0) {
            p.supplyIndexSnapshot = supplyIndex;
        }
        if (p.borrowIndexSnapshot == 0) {
            p.borrowIndexSnapshot = borrowIndex;
        }

        if (p.supplyPrincipal > 0) {
            p.supplyPrincipal = (p.supplyPrincipal * supplyIndex) / p.supplyIndexSnapshot;
        }
        if (p.borrowPrincipal > 0) {
            p.borrowPrincipal = (p.borrowPrincipal * borrowIndex) / p.borrowIndexSnapshot;
        }

        p.supplyIndexSnapshot = supplyIndex;
        p.borrowIndexSnapshot = borrowIndex;
    }

    function _isHealthy(uint256 supplyAmount, uint256 borrowAmount) internal view returns (bool) {
        if (borrowAmount == 0) {
            return true;
        }

        uint256 maxBorrow = _wadMul(supplyAmount, collateralFactor);
        return borrowAmount <= maxBorrow;
    }

    function _utilization(uint256 supplyAmount, uint256 borrowAmount) internal pure returns (uint256) {
        if (supplyAmount == 0 || borrowAmount == 0) {
            return 0;
        }
        uint256 util = _wadDiv(borrowAmount, supplyAmount);
        return util > WAD ? WAD : util;
    }

    function _ratesFromUtilization(uint256 utilization) internal view returns (uint256 borrowRate, uint256 supplyRate) {
        borrowRate = baseRatePerYear + _wadMul(slopeRatePerYear, utilization);
        supplyRate = _wadMul(_wadMul(borrowRate, utilization), (WAD - reserveFactor));
    }

    function _wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / WAD;
    }

    function _wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * WAD) / b;
    }
}

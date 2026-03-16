const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DeFiLendingPool", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Pool = await ethers.getContractFactory("DeFiLendingPool");
    const pool = await Pool.deploy(await token.getAddress());
    await pool.waitForDeployment();

    const faucetAmount = ethers.parseEther("10000");
    await token.connect(alice).faucet(faucetAmount);
    await token.connect(bob).faucet(faucetAmount);

    await token.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
    await token.connect(bob).approve(await pool.getAddress(), ethers.MaxUint256);
    await token.connect(owner).approve(await pool.getAddress(), ethers.MaxUint256);

    return { token, pool, owner, alice, bob };
  }

  it("increases borrow rate as utilization rises", async function () {
    const { pool, alice } = await deployFixture();

    await pool.connect(alice).deposit(ethers.parseEther("1000"));

    const before = await pool.currentRates();
    await pool.connect(alice).borrow(ethers.parseEther("700"));
    const after = await pool.currentRates();

    expect(after.borrowRate).to.be.greaterThan(before.borrowRate);
    expect(after.utilization).to.be.greaterThan(before.utilization);
  });

  it("accrues borrower interest over time", async function () {
    const { pool, alice, bob } = await deployFixture();

    await pool.connect(alice).deposit(ethers.parseEther("1000"));
    await pool.connect(bob).deposit(ethers.parseEther("200"));
    await pool.connect(bob).borrow(ethers.parseEther("100"));

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    await pool.accrueInterest();
    const account = await pool.userAccount(bob.address);

    expect(account.borrowed).to.be.greaterThan(ethers.parseEther("100"));
  });

  it("rejects unsafe borrow and undercollateralized withdraw", async function () {
    const { pool, alice } = await deployFixture();

    await pool.connect(alice).deposit(ethers.parseEther("100"));

    await expect(pool.connect(alice).borrow(ethers.parseEther("76"))).to.be.revertedWith(
      "insufficient collateral"
    );

    await pool.connect(alice).borrow(ethers.parseEther("70"));
    await expect(pool.connect(alice).withdraw(ethers.parseEther("20"))).to.be.revertedWith(
      "would become undercollateralized"
    );
  });
});

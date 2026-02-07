const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RewardToken", function () {
  async function deployFixture() {
    const [owner, alice, minter, other] = await ethers.getSigners();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    const token = await RewardToken.deploy("RewardToken", "RWT");
    await token.waitForDeployment();

    return { token, owner, alice, minter, other };
  }

  it("owner can setMinter; non-owner cannot", async function () {
    const { token, owner, minter, alice } = await deployFixture();

    await token.connect(owner).setMinter(minter.address);
    expect(await token.minter()).to.equal(minter.address);

    await expect(token.connect(alice).setMinter(alice.address))
      .to.be.reverted; // Ownable revert message can vary across OZ versions
  });

  it("only minter can mint (custom error NotMinter)", async function () {
    const { token, owner, minter, alice, other } = await deployFixture();

    await token.connect(owner).setMinter(minter.address);

    // non-minter -> custom error
    await expect(token.connect(other).mint(alice.address, 1000n))
      .to.be.revertedWithCustomError(token, "NotMinter");

    // minter -> mints, balance updates
    await token.connect(minter).mint(alice.address, 1234n);
    expect(await token.balanceOf(alice.address)).to.equal(1234n);
  });
});

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("KickstarterCrowdfunding", function () {
  const TOKENS_PER_ETH = 1000n;

  async function timeTravel(seconds) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  async function deployFixture() {
    const [deployer, owner, alice, bob, minter] = await ethers.getSigners();

    // Deploy RewardToken
    const RewardToken = await ethers.getContractFactory("RewardToken");
    const token = await RewardToken.deploy("RewardToken", "RWT");
    await token.waitForDeployment();

    // Deploy Crowdfunding
    const Kickstarter = await ethers.getContractFactory("KickstarterCrowdfunding");
    const ks = await Kickstarter.deploy(await token.getAddress());
    await ks.waitForDeployment();

    // Allow crowdfunding contract to mint rewards
    await token.setMinter(await ks.getAddress());

    return { token, ks, deployer, owner, alice, bob, minter };
  }

  it("createCampaign stores campaign and increments campaignCount", async function () {
    const { ks, owner } = await deployFixture();

    const goal = ethers.parseEther("2");
    const duration = 3600;

    const tx = await ks.connect(owner).createCampaign("Test Campaign", goal, duration);
    await tx.wait();

    expect(await ks.campaignCount()).to.equal(1n);

    const c = await ks.campaigns(1n);
    expect(c.title).to.equal("Test Campaign");
    expect(c.owner).to.equal(owner.address);
    expect(c.goal).to.equal(goal);
    expect(c.finalized).to.equal(false);
    expect(c.successful).to.equal(false);
  });

  it("createCampaign reverts on invalid params", async function () {
    const { ks } = await deployFixture();
    await expect(ks.createCampaign("", 1n, 1n)).to.be.revertedWith("TITLE_EMPTY");
    await expect(ks.createCampaign("X", 0n, 1n)).to.be.revertedWith("GOAL_0");
    await expect(ks.createCampaign("X", 1n, 0n)).to.be.revertedWith("DURATION_0");
  });

  it("contribute updates totals, contributions, and pendingRewards", async function () {
    const { ks, owner, alice } = await deployFixture();

    const goal = ethers.parseEther("5");
    await ks.connect(owner).createCampaign("C1", goal, 3600);

    const amount = ethers.parseEther("1");
    await ks.connect(alice).contribute(1n, { value: amount });

    const c = await ks.campaigns(1n);
    expect(c.totalRaised).to.equal(amount);

    expect(await ks.contributions(1n, alice.address)).to.equal(amount);

    // pendingRewards = msg.value * 1000 (token units)
    const expectedRewards = amount * TOKENS_PER_ETH;
    expect(await ks.pendingRewards(1n, alice.address)).to.equal(expectedRewards);
  });

  it("contribute reverts if campaign not found / ended / finalized / value=0", async function () {
    const { ks, owner, alice } = await deployFixture();

    // NotFound
    await expect(ks.connect(alice).contribute(999n, { value: 1n }))
      .to.be.revertedWithCustomError(ks, "NotFound");

    // Create campaign
    await ks.connect(owner).createCampaign("C1", ethers.parseEther("1"), 10);

    // VALUE_0
    await expect(ks.connect(alice).contribute(1n, { value: 0n }))
      .to.be.revertedWith("VALUE_0");

    // Ended
    await timeTravel(11);
    await expect(ks.connect(alice).contribute(1n, { value: 1n }))
      .to.be.revertedWithCustomError(ks, "Ended");
  });

  it("finalizeCampaign reverts if not ended yet; succeeds after deadline", async function () {
    const { ks, owner } = await deployFixture();

    await ks.connect(owner).createCampaign("C1", ethers.parseEther("1"), 100);

    await expect(ks.finalizeCampaign(1n))
      .to.be.revertedWithCustomError(ks, "NotEnded");

    await timeTravel(101);
    await ks.finalizeCampaign(1n);

    const c = await ks.campaigns(1n);
    expect(c.finalized).to.equal(true);
  });

  it("successful campaign pays out owner and allows claimReward", async function () {
    const { ks, token, owner, alice, bob } = await deployFixture();

    // Goal 2 ETH, duration 10s
    const goal = ethers.parseEther("2");
    await ks.connect(owner).createCampaign("C1", goal, 10);

    // Raise 2 ETH total
    await ks.connect(alice).contribute(1n, { value: ethers.parseEther("1") });
    await ks.connect(bob).contribute(1n, { value: ethers.parseEther("1") });

    await timeTravel(11);

    // Track owner ETH balance change (gas makes exact delta messy, so use >)
    const before = await ethers.provider.getBalance(owner.address);
    await ks.finalizeCampaign(1n);
    const after = await ethers.provider.getBalance(owner.address);

    expect(after).to.be.gt(before); // payout happened

    const c = await ks.campaigns(1n);
    expect(c.finalized).to.equal(true);
    expect(c.successful).to.equal(true);

    // Claim reward: alice gets 1000 tokens per ETH
    const expectedAlice = ethers.parseEther("1") * TOKENS_PER_ETH;

    await ks.connect(alice).claimReward(1n);
    expect(await token.balanceOf(alice.address)).to.equal(expectedAlice);

    // second claim should fail (pendingRewards cleared)
    await expect(ks.connect(alice).claimReward(1n))
      .to.be.revertedWithCustomError(ks, "NothingToClaim");
  });

  it("failed campaign allows refunds and blocks claimReward", async function () {
    const { ks, token, owner, alice } = await deployFixture();

    // Goal 5 ETH, raise only 1 ETH
    await ks.connect(owner).createCampaign("C1", ethers.parseEther("5"), 10);
    await ks.connect(alice).contribute(1n, { value: ethers.parseEther("1") });

    await timeTravel(11);
    await ks.finalizeCampaign(1n);

    const c = await ks.campaigns(1n);
    expect(c.finalized).to.equal(true);
    expect(c.successful).to.equal(false);

    // claimReward should revert (NotSuccessful)
    await expect(ks.connect(alice).claimReward(1n))
      .to.be.revertedWithCustomError(ks, "NotSuccessful");

    // refund works and clears contribution + pending rewards
    const contribBefore = await ks.contributions(1n, alice.address);
    expect(contribBefore).to.equal(ethers.parseEther("1"));

    await ks.connect(alice).refund(1n);

    expect(await ks.contributions(1n, alice.address)).to.equal(0n);
    expect(await ks.pendingRewards(1n, alice.address)).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(0n); // no reward on failed campaign

    // refund again should revert
    await expect(ks.connect(alice).refund(1n))
      .to.be.revertedWithCustomError(ks, "NothingToRefund");
  });

  it("refund reverts if campaign not finalized or successful", async function () {
    const { ks, owner, alice } = await deployFixture();

    await ks.connect(owner).createCampaign("C1", ethers.parseEther("1"), 10);
    await ks.connect(alice).contribute(1n, { value: ethers.parseEther("1") });

    // not finalized yet
    await expect(ks.connect(alice).refund(1n))
      .to.be.revertedWithCustomError(ks, "NotEnded");

    await timeTravel(11);
    await ks.finalizeCampaign(1n);

    // campaign is successful -> refund not allowed
    await expect(ks.connect(alice).refund(1n))
      .to.be.revertedWithCustomError(ks, "NotFailed");
  });
});

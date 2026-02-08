import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const FRONTEND_DIR = path.join(process.cwd(), "frontend");
const CONFIG_PATH = path.join(FRONTEND_DIR, "config.json");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const RewardToken = await ethers.getContractFactory("RewardToken");
  const rewardToken = await RewardToken.deploy("CrowdReward", "CRWD");
  await rewardToken.waitForDeployment();
  const rewardTokenAddress = await rewardToken.getAddress();

  console.log("RewardToken deployed:", rewardTokenAddress);

  const KickstarterCrowdfunding = await ethers.getContractFactory("KickstarterCrowdfunding");
  const crowdfunding = await KickstarterCrowdfunding.deploy(rewardTokenAddress);
  await crowdfunding.waitForDeployment();
  const crowdfundingAddress = await crowdfunding.getAddress();

  console.log("KickstarterCrowdfunding deployed:", crowdfundingAddress);

  const tx = await rewardToken.setMinter(crowdfundingAddress);
  await tx.wait();
  console.log("Minter set to:", crowdfundingAddress);

  ensureDir(FRONTEND_DIR);
  const config = {
    network: "sepolia",
    chainId: "0xaa36a7",
    crowdfundingAddress,
    rewardTokenAddress
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log("Saved frontend config:", CONFIG_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

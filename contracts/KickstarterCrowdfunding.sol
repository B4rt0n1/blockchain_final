// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRewardToken {
    function mint(address to, uint256 amount) external;
}

contract KickstarterCrowdfunding is ReentrancyGuard {
    struct Campaign {
        string title;
        address owner;
        uint256 goal;         // wei
        uint256 deadline;     // timestamp
        uint256 totalRaised;  // wei
        bool finalized;
        bool successful;
    }

    // 1 ETH (1e18 wei) => 1000 tokens => wei * 1000 token units (18 decimals)
    uint256 public constant TOKENS_PER_ETH = 1000;

    IRewardToken public immutable rewardToken;

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;

    // contributions[campaignId][user] = wei
    mapping(uint256 => mapping(address => uint256)) public contributions;

    // pendingRewards[campaignId][user] = token units
    mapping(uint256 => mapping(address => uint256)) public pendingRewards;

    event CampaignCreated(uint256 indexed id, address indexed owner, uint256 goal, uint256 deadline, string title);
    event ContributionMade(uint256 indexed id, address indexed contributor, uint256 amountWei);
    event CampaignFinalized(uint256 indexed id, bool successful);
    event RefundIssued(uint256 indexed id, address indexed contributor, uint256 amountWei);
    event RewardClaimed(uint256 indexed id, address indexed contributor, uint256 tokenAmount);

    error NotFound();
    error Ended();
    error NotEnded();
    error AlreadyFinalized();
    error NotFailed();
    error NotSuccessful();
    error NothingToRefund();
    error NothingToClaim();
    error PayoutFailed();

    constructor(address rewardTokenAddress) {
        rewardToken = IRewardToken(rewardTokenAddress);
    }

    function createCampaign(string calldata title, uint256 goalWei, uint256 durationSeconds)
        external
        returns (uint256 id)
    {
        require(bytes(title).length > 0, "TITLE_EMPTY");
        require(goalWei > 0, "GOAL_0");
        require(durationSeconds > 0, "DURATION_0");

        id = ++campaignCount;

        campaigns[id] = Campaign({
            title: title,
            owner: msg.sender,
            goal: goalWei,
            deadline: block.timestamp + durationSeconds,
            totalRaised: 0,
            finalized: false,
            successful: false
        });

        emit CampaignCreated(id, msg.sender, goalWei, block.timestamp + durationSeconds, title);
    }

    function contribute(uint256 id) external payable nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.owner == address(0)) revert NotFound();
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp >= c.deadline) revert Ended();
        require(msg.value > 0, "VALUE_0");

        contributions[id][msg.sender] += msg.value;
        c.totalRaised += msg.value;

        pendingRewards[id][msg.sender] += msg.value * TOKENS_PER_ETH;

        emit ContributionMade(id, msg.sender, msg.value);
    }

    function finalizeCampaign(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.owner == address(0)) revert NotFound();
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp < c.deadline) revert NotEnded();

        c.finalized = true;
        c.successful = (c.totalRaised >= c.goal);

        emit CampaignFinalized(id, c.successful);

        if (c.successful && c.totalRaised > 0) {
            uint256 amount = c.totalRaised;
            c.totalRaised = 0;

            (bool ok, ) = c.owner.call{value: amount}("");
            if (!ok) revert PayoutFailed();
        }
    }

    function refund(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.owner == address(0)) revert NotFound();
        if (!c.finalized) revert NotEnded();
        if (c.successful) revert NotFailed();

        uint256 amount = contributions[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        contributions[id][msg.sender] = 0;
        pendingRewards[id][msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert PayoutFailed();

        emit RefundIssued(id, msg.sender, amount);
    }

    function claimReward(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.owner == address(0)) revert NotFound();
        if (!c.finalized) revert NotEnded();
        if (!c.successful) revert NotSuccessful();

        uint256 reward = pendingRewards[id][msg.sender];
        if (reward == 0) revert NothingToClaim();

        pendingRewards[id][msg.sender] = 0;
        rewardToken.mint(msg.sender, reward);

        emit RewardClaimed(id, msg.sender, reward);
    }
}

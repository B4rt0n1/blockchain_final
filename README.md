
# All-or-Nothing Model Kickstarter DApp

## Project Overview

Campaigns either succeed and release funds to the creator **with token rewards issued to contributors**, or fail and allow contributors to **refund their ETH**.

---

## Core Logic of All-or-Nothing

* If a campaign **reaches its funding goal before the deadline**:

  * The campaign is marked as **successful**
  * All raised test ETH is transferred to the campaign creator
  * Contributors can **claim ERC-20 reward tokens**
* If a campaign **does not reach its goal**:

  * The campaign is marked as **failed**
  * Contributors can **refund their full contribution**
  * No reward tokens can be claimed

---

## System Entities

### Campaign

Represents a crowdfunding campaign.

* `title` – campaign name
* `owner` – creator address
* `goal` – funding target (in wei)
* `deadline` – UNIX timestamp
* `totalRaised` – total contributed ETH
* `finalized` – whether the campaign is finalized
* `successful` – outcome of the campaign

### Contributions

Tracks how much ETH each user contributed to a specific campaign:

```
contributions[campaignId][contributor]
```

### RewardToken

A custom ERC-20 token used as an **internal reward system**:

* Minted only for successful campaigns
* Minting rights restricted to the crowdfunding contract

---

## Reward Model

Rewards are calculated **proportionally** to the contribution:

```
TOKENS_PER_ETH = 1000
reward = contributedETH × 1000
```

Example:

* Contribution: `0.2 ETH`
* Reward: `200 tokens`

Rewards are stored as **pending rewards** and are minted only when claimed.

---

## Application Workflow

### 1. Campaign Creation (Creator)

The creator calls:

```
createCampaign(title, goal, duration)
```

The contract:

* Stores campaign data
* Assigns a unique campaign ID
* Emits a `CampaignCreated` event

---

### 2. Contributing to a Campaign (Backer)

The contributor calls:

```
contribute(campaignId)
```

The contract:

* Verifies the campaign is active and not finalized
* Records the contribution
* Updates the total raised amount
* Calculates and stores pending reward tokens

---

### 3. Campaign Finalization

After the deadline, **any user** can call:

```
finalizeCampaign(campaignId)
```

The contract:

* Checks whether the funding goal was reached
* If successful:

  * Transfers all ETH to the campaign owner
* If failed:

  * Locks funds for refunds

No reward tokens are minted during finalization to avoid gas-expensive loops.

---

### 4. Claiming Rewards (Successful Campaigns)

For successful campaigns, contributors call:

```
claimReward(campaignId)
```

The contract:

* Reads the contributor’s pending reward
* Resets it to zero
* Mints ERC-20 tokens directly to the contributor’s address

Minting is restricted so that **only the crowdfunding contract** can mint tokens.

---

### 5. Refunds (Failed Campaigns)

If a campaign fails, contributors can call:

```
refund(campaignId)
```

The contract:

* Returns the contributor’s ETH
* Resets contribution data
* Clears pending rewards to prevent token abuse

---

## Why Rewards Use `claimReward()` Instead of Automatic Distribution

Automatically minting tokens to all contributors during finalization would require:

* Storing a list of all contributors
* Iterating through them in a loop

This approach is unsafe due to **Ethereum gas limits** and could cause transactions to fail.

Using `claimReward()`:

* Avoids gas-limit issues
* Makes reward claiming optional
* Ensures each user pays gas only for their own transaction


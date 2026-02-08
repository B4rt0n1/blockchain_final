const { ethers } = window.ethers;

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111

const crowdfundingAbi = [
  "function campaignCount() view returns (uint256)",
  "function campaigns(uint256) view returns (string title, address owner, uint256 goal, uint256 deadline, uint256 totalRaised, bool finalized, bool successful)",
  "function contributions(uint256,address) view returns (uint256)",
  "function pendingRewards(uint256,address) view returns (uint256)",
  "function createCampaign(string title, uint256 goalWei, uint256 durationSeconds) returns (uint256)",
  "function contribute(uint256 id) payable",
  "function finalizeCampaign(uint256 id)",
  "function refund(uint256 id)",
  "function claimReward(uint256 id)"
];

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const btnConnect = document.getElementById("btnConnect");
const btnSwitch  = document.getElementById("btnSwitch");
const btnCreate  = document.getElementById("btnCreate");

const netBadge  = document.getElementById("netBadge");
const addrBadge = document.getElementById("addrBadge");
const ethBal    = document.getElementById("ethBal");
const tokenBal  = document.getElementById("tokenBal");
const statusEl  = document.getElementById("status");
const listEl    = document.getElementById("campaignList");

const cTitle = document.getElementById("cTitle");
const cGoal  = document.getElementById("cGoal");
const cDur   = document.getElementById("cDur");

let provider, signer, userAddress;
let cfg, crowdfunding, rewardToken;

function setStatus(msg) {
  statusEl.textContent = `Status: ${msg}`;
}

async function loadConfig() {
  const res = await fetch("./config.json");
  if (!res.ok) throw new Error("config.json not found. Create frontend/config.json (or run deploy script).");
  cfg = await res.json();
}

async function getChainIdHex() {
  return await window.ethereum.request({ method: "eth_chainId" });
}

async function ensureSepolia() {
  const chainId = await getChainIdHex();
  netBadge.textContent = `Network chainId: ${chainId}`;

  if (chainId !== SEPOLIA_CHAIN_ID) {
    setStatus("Wrong network. Please switch to Sepolia.");
    return false;
  }
  return true;
}

async function connect() {
  if (!window.ethereum) {
    alert("MetaMask not found. Install MetaMask extension.");
    return;
  }

  setStatus("Connecting MetaMask...");
  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  userAddress = await signer.getAddress();

  addrBadge.textContent = `Wallet: ${userAddress.slice(0,6)}...${userAddress.slice(-4)}`;

  const ok = await ensureSepolia();
  if (!ok) return;

  crowdfunding = new ethers.Contract(cfg.crowdfundingAddress, crowdfundingAbi, signer);
  rewardToken  = new ethers.Contract(cfg.rewardTokenAddress, erc20Abi, signer);

  await refreshBalances();
  await renderCampaigns();
  setStatus("Connected");
}

async function switchToSepolia() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }]
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: SEPOLIA_CHAIN_ID,
          chainName: "Sepolia Testnet",
          nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.sepolia.org"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"]
        }]
      });
    } else {
      console.error(e);
      alert("Cannot switch network. Check MetaMask.");
    }
  }
}

async function refreshBalances() {
  if (!provider || !userAddress) return;

  const bal = await provider.getBalance(userAddress);
  ethBal.textContent = `${ethers.formatEther(bal)} ETH`;

  if (rewardToken) {
    const [dec, sym, tbal] = await Promise.all([
      rewardToken.decimals(),
      rewardToken.symbol(),
      rewardToken.balanceOf(userAddress)
    ]);
    tokenBal.textContent = `${ethers.formatUnits(tbal, dec)} ${sym}`;
  }
}

function formatDeadline(ts) {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString();
}

function campaignStatus(c) {
  const now = Date.now() / 1000;

  if (!c.finalized) {
    if (Number(c.deadline) > now) return "Active";
    return "Ended (needs finalize)";
  }
  return c.successful ? "Successful" : "Failed";
}

async function renderCampaigns() {
  listEl.innerHTML = "";
  if (!crowdfunding) return;

  const count = await crowdfunding.campaignCount();

  if (Number(count) === 0) {
    listEl.innerHTML = `<div class="hint">Пока кампаний нет. Создай первую.</div>`;
    return;
  }

  for (let id = 1; id <= Number(count); id++) {
    const c = await crowdfunding.campaigns(id);

    const goalEth = ethers.formatEther(c.goal);
    const raisedEth = ethers.formatEther(c.totalRaised);
    const st = campaignStatus(c);

    const myContribWei = await crowdfunding.contributions(id, userAddress);
    const myContribEth = ethers.formatEther(myContribWei);

    const pending = await crowdfunding.pendingRewards(id, userAddress);

    const item = document.createElement("div");
    item.className = "item";

    item.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">#${id} — ${c.title}</div>
          <div class="item__meta">Owner: ${c.owner}</div>
          <div class="item__meta">Goal: ${goalEth} ETH | Raised: ${raisedEth} ETH</div>
          <div class="item__meta">Deadline: ${formatDeadline(c.deadline)}</div>
          <div class="item__meta">Status: <b>${st}</b></div>
          <div class="item__meta">Your contribution: ${myContribEth} ETH</div>
          <div class="item__meta">Pending reward (token units): ${pending.toString()}</div>
        </div>
      </div>

      <div class="item__actions">
        <input id="amt-${id}" class="small" type="number" step="0.0001" placeholder="ETH amount" style="width:160px" />
        <button class="btn btn--primary small" data-act="contribute" data-id="${id}">Contribute</button>
        <button class="btn btn--ghost small" data-act="finalize" data-id="${id}">Finalize</button>
        <button class="btn btn--ghost small" data-act="claim" data-id="${id}">Claim Reward</button>
        <button class="btn btn--ghost small" data-act="refund" data-id="${id}">Refund</button>
      </div>
    `;

    listEl.appendChild(item);
  }

  // bind buttons
  listEl.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", async () => {
      const act = b.dataset.act;
      const id = Number(b.dataset.id);

      try {
        if (!(await ensureSepolia())) return;

        if (act === "contribute") {
          const input = document.getElementById(`amt-${id}`);
          const ethAmount = input.value;
          if (!ethAmount || Number(ethAmount) <= 0) return alert("Введите сумму ETH > 0");

          setStatus(`Contributing to #${id}...`);
          const tx = await crowdfunding.contribute(id, { value: ethers.parseEther(ethAmount) });
          setStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
          setStatus(`Contribution confirmed`);

        } else if (act === "finalize") {
          setStatus(`Finalizing #${id}...`);
          const tx = await crowdfunding.finalizeCampaign(id);
          setStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
          setStatus(`Finalize confirmed`);

        } else if (act === "claim") {
          setStatus(`Claiming reward for #${id}...`);
          const tx = await crowdfunding.claimReward(id);
          setStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
          setStatus(`Claim confirmed`);

        } else if (act === "refund") {
          setStatus(`Refunding for #${id}...`);
          const tx = await crowdfunding.refund(id);
          setStatus(`Tx sent: ${tx.hash}`);
          await tx.wait();
          setStatus(`Refund confirmed`);
        }

        await refreshBalances();
        await renderCampaigns();

      } catch (e) {
        console.error(e);
        setStatus(`Error: ${e?.shortMessage || e?.message || "unknown"}`);
      }
    });
  });
}

async function createCampaign() {
  if (!crowdfunding) return alert("Connect MetaMask first");
  if (!(await ensureSepolia())) return;

  const title = cTitle.value.trim();
  const goal = cGoal.value;
  const dur  = cDur.value;

  if (!title) return alert("Title пустой");
  if (!goal || Number(goal) <= 0) return alert("Goal должен быть > 0");
  if (!dur  || Number(dur) <= 0) return alert("Duration должен быть > 0");

  try {
    setStatus("Creating campaign...");
    const goalWei = ethers.parseEther(goal);
    const tx = await crowdfunding.createCampaign(title, goalWei, Number(dur));
    setStatus(`Tx sent: ${tx.hash}`);
    await tx.wait();
    setStatus("Campaign created");

    cTitle.value = "";
    cGoal.value = "";
    cDur.value = "";

    await renderCampaigns();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.shortMessage || e?.message || "unknown"}`);
  }
}

btnConnect.addEventListener("click", connect);
btnSwitch.addEventListener("click", switchToSepolia);
btnCreate.addEventListener("click", createCampaign);

window.addEventListener("load", async () => {
  try {
    await loadConfig();
    setStatus("Config loaded. Connect MetaMask.");
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", async () => {
        setStatus("Account changed. Reconnect...");
        await connect();
      });
      window.ethereum.on("chainChanged", async () => {
        setStatus("Network changed. Refreshing...");
        await connect();
      });
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message);
  }
});

import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import poolAbi from "./abis/DeFiLendingPool.json";
import tokenAbi from "./abis/MockToken.json";
import contractConfig from "./contractConfig.json";
import "./style.css";

const app = document.querySelector("#app");

const state = {
  provider: null,
  signer: null,
  account: null,
  pool: null,
  token: null,
};

const fmt = (value) => Number(formatEther(value)).toFixed(4);
const pct = (value) => `${(Number(formatEther(value)) * 100).toFixed(2)}%`;

function renderShell() {
  app.innerHTML = `
    <main class="page">
      <section class="hero">
        <div>
          <p class="eyebrow">Task 3</p>
          <p class="subtitle">Deposit mock USD, borrow against collateral, and watch utilization drive the live interest rates.</p>
        </div>
        <button id="connectButton" class="primary">Connect Wallet</button>
      </section>

      <section class="grid" id="statusGrid">
        <article class="card">
          <h2>Pool</h2>
          <div class="stats" id="poolStats"></div>
        </article>
        <article class="card">
          <h2>Your Position</h2>
          <div class="stats" id="accountStats"></div>
        </article>
      </section>

      <section class="actions">
        <article class="card action-card">
          <h2>Actions</h2>
          <div class="toolbar">
            <button id="faucetButton">Mint Test Tokens</button>
            <button id="refreshButton">Refresh</button>
          </div>
          <div class="forms">
            <form data-action="deposit">
              <label>Deposit</label>
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount in mUSD" required />
              <button type="submit">Supply</button>
            </form>
            <form data-action="borrow">
              <label>Borrow</label>
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount in mUSD" required />
              <button type="submit">Borrow</button>
            </form>
            <form data-action="repay">
              <label>Repay</label>
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount in mUSD" required />
              <button type="submit">Repay</button>
            </form>
            <form data-action="withdraw">
              <label>Withdraw</label>
              <input name="amount" type="number" min="0" step="0.01" placeholder="Amount in mUSD" required />
              <button type="submit">Withdraw</button>
            </form>
          </div>
          <p id="message" class="message">Connect MetaMask to begin.</p>
        </article>
      </section>
    </main>
  `;

  document.querySelector("#connectButton").addEventListener("click", connectWallet);
  document.querySelector("#faucetButton").addEventListener("click", requestFaucet);
  document.querySelector("#refreshButton").addEventListener("click", refresh);
  document.querySelectorAll("form[data-action]").forEach((form) => {
    form.addEventListener("submit", handleSubmit);
  });
}

function setMessage(text, isError = false) {
  const message = document.querySelector("#message");
  message.textContent = text;
  message.dataset.error = isError ? "true" : "false";
}

async function connectWallet() {
  if (!window.ethereum) {
    setMessage("MetaMask is required for this demo.", true);
    return;
  }

  try {
    state.provider = new BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();

    const network = await state.provider.getNetwork();
    if (Number(network.chainId) !== contractConfig.chainId) {
      setMessage(`Switch MetaMask to chain ${contractConfig.chainId}.`, true);
      return;
    }

    state.pool = new Contract(contractConfig.poolAddress, poolAbi, state.signer);
    state.token = new Contract(contractConfig.tokenAddress, tokenAbi, state.signer);

    document.querySelector("#connectButton").textContent = `${state.account.slice(0, 6)}...${state.account.slice(-4)}`;
    setMessage("Wallet connected.");
    await refresh();
  } catch (error) {
    setMessage(error.shortMessage || error.message, true);
  }
}

async function requestFaucet() {
  if (!state.token) {
    setMessage("Connect your wallet first.", true);
    return;
  }

  try {
    const tx = await state.token.faucet(parseEther("1000"));
    setMessage("Minting 1000 mUSD...");
    await tx.wait();
    await refresh();
    setMessage("Minted 1000 mUSD.");
  } catch (error) {
    setMessage(error.shortMessage || error.message, true);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!state.pool || !state.token) {
    setMessage("Connect your wallet first.", true);
    return;
  }

  const form = event.currentTarget;
  const action = form.dataset.action;
  const amountValue = form.elements.amount.value;

  if (!amountValue || Number(amountValue) <= 0) {
    setMessage("Enter a positive amount.", true);
    return;
  }

  const amount = parseEther(amountValue);

  try {
    if (action === "deposit" || action === "repay") {
      const approval = await state.token.approve(contractConfig.poolAddress, amount);
      setMessage("Approving token transfer...");
      await approval.wait();
    }

    let tx;
    if (action === "deposit") tx = await state.pool.deposit(amount);
    if (action === "borrow") tx = await state.pool.borrow(amount);
    if (action === "repay") tx = await state.pool.repay(amount);
    if (action === "withdraw") tx = await state.pool.withdraw(amount);

    setMessage(`${action} transaction submitted...`);
    await tx.wait();
    form.reset();
    await refresh();
    setMessage(`${action} successful.`);
  } catch (error) {
    setMessage(error.shortMessage || error.message, true);
  }
}

async function refresh() {
  const poolStats = document.querySelector("#poolStats");
  const accountStats = document.querySelector("#accountStats");

  if (!state.pool || !state.token || !state.account) {
    poolStats.innerHTML = `<p>Deploy locally, import the Hardhat account into MetaMask, then connect.</p>`;
    accountStats.innerHTML = `<p>No wallet connected.</p>`;
    return;
  }

  const [totalSupply, totalBorrow, rates, account, walletBalance] = await Promise.all([
    state.pool.totalSupplyPrincipal(),
    state.pool.totalBorrowPrincipal(),
    state.pool.currentRates(),
    state.pool.userAccount(state.account),
    state.token.balanceOf(state.account),
  ]);

  poolStats.innerHTML = `
    <div><span>Total supplied</span><strong>${fmt(totalSupply)} mUSD</strong></div>
    <div><span>Total borrowed</span><strong>${fmt(totalBorrow)} mUSD</strong></div>
    <div><span>Utilization</span><strong>${pct(rates.utilization)}</strong></div>
    <div><span>Borrow APR</span><strong>${pct(rates.borrowRate)}</strong></div>
    <div><span>Supply APR</span><strong>${pct(rates.supplyRate)}</strong></div>
  `;

  accountStats.innerHTML = `
    <div><span>Wallet balance</span><strong>${fmt(walletBalance)} mUSD</strong></div>
    <div><span>Supplied</span><strong>${fmt(account.supplied)} mUSD</strong></div>
    <div><span>Borrowed</span><strong>${fmt(account.borrowed)} mUSD</strong></div>
    <div><span>Available to borrow</span><strong>${fmt(account.availableToBorrow)} mUSD</strong></div>
  `;
}

renderShell();
refresh();
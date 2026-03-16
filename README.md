# DeFi Lending and Borrowing DApp

This project contains:

- A Hardhat smart-contract project for a utilization-based DeFi lending pool.
- A mock ERC-20 token used as the pool asset on a local test blockchain.
- A frontend dApp that connects with MetaMask and interacts with the deployed pool.

## Features

- Deposit and withdraw mock tokens.
- Borrow against supplied collateral.
- Repay outstanding debt.
- Dynamic supply and borrow rates driven by pool utilization.
- Local deployment flow that writes ABI and contract addresses into the frontend.

## Run locally

Install dependencies:

```bash
npm install
npm --prefix frontend install
```

Start the local blockchain:

```bash
npm run node
```

Deploy contracts in a second terminal:

```bash
npm run deploy:local
```

Start the frontend in a third terminal:

```bash
npm run frontend
```

## MetaMask setup

- Add the local Hardhat network: RPC URL `http://127.0.0.1:8545`, chain ID `31337`, currency symbol `ETH`.
- Import one of the funded Hardhat private keys printed by `npm run node`.
- Use the faucet button in the frontend to mint mock tokens.
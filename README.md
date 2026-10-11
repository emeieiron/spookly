# Pippo

USDC cheques shared as links. An issuer escrows USDC in a cheque and shares a link; whoever holds the link can pay any USDC address — on Monad, or on other networks via Circle CCTP with the Forwarding Service — without an app, wallet or gas. Fees come from the issuer's ERC-4337 deposit.

## Run

```bash
pnpm install
cp .env.example .env.local   # ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY (testnet only)
pnpm contracts:test          # forks Monad testnet
pnpm contracts:build         # regenerates lib/abi.ts
pnpm contracts:deploy        # writes lib/deployment.json
pnpm smoke                   # real Monad testnet -> Base Sepolia payment
pnpm dev
```

Local fork: run `anvil --fork-url https://testnet-rpc.monad.xyz`, deploy with `MONAD_RPC_URL=http://127.0.0.1:8545`, start `pnpm dev:fork` (a minimal bundler), and run the app with `NEXT_PUBLIC_MONAD_RPC_URL`/`MONAD_RPC_URL` pointing at anvil and `BUNDLER_RPC_URL=http://localhost:4337`.

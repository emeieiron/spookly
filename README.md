# Pippo — Spendable links

**Put USDC in a link. Whoever holds the link can pay any USDC address straight from it, on Monad or nine other networks, with no app, no wallet and no gas.**

Pippo turns a USDC payment into a _cheque_: an amount set aside on Monad, dated, capped and cancellable, and shared as an ordinary link or QR code. The person holding the link scans a payment code, taps **Pay**, and the money arrives at the payee in seconds. They never set up a wallet, buy gas or "claim" anything first.

`Monad testnet` · `ERC-4337 (EntryPoint v0.7)` · `Circle CCTP V2 + Forwarding Service` · `Passkeys (WebAuthn PRF)` · `Privy`

---

## Contents

- [Why](#why)
- [What it does](#what-it-does)
- [How it works](#how-it-works)
  - [Architecture](#architecture)
  - [A cheque is a key, not a wallet](#a-cheque-is-a-key-not-a-wallet)
  - [The cheque book: an ERC-4337 account per issuer](#the-cheque-book-an-erc-4337-account-per-issuer)
  - [Writing a cheque in one transaction](#writing-a-cheque-in-one-transaction)
  - [Spending a link](#spending-a-link)
  - [Paying across networks with CCTP](#paying-across-networks-with-cctp)
  - [Passkey-backed links: one passkey, many keys](#passkey-backed-links-one-passkey-many-keys)
  - [Issuer accounts and Monad-safe transactions](#issuer-accounts-and-monad-safe-transactions)
  - [Payment history across ten chains with Envio](#payment-history-across-ten-chains-with-envio)
- [Security model](#security-model)
- [Supported networks](#supported-networks)
- [Deployment](#deployment)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Limitations](#limitations)

---

## Why

Sending stablecoins to someone who isn't a crypto user usually means a _claim link_. Before the money is usable, the recipient has to create a wallet or passkey, claim the funds into it, and then send them on again. Someone also has to pay for gas, and if the payee is on a different network the money is stuck where it landed. Whatever isn't spent sits in a wallet that may never be opened again.

Pippo removes the claiming step entirely. **The link itself pays.**

| | Typical claim link | Pippo spendable link |
|---|---|---|
| Before it's usable | Set up a wallet or passkey to claim it | Nothing to set up. The link already pays |
| Paying someone | Claim it, then send it again from the new wallet | Scan their payment code, tap Pay |
| Payee on another network | Stuck on the network it was sent on | Delivered on 10 networks through Circle CCTP |
| Gas | Someone funds or sponsors the new wallet | Paid from the issuer's capped fee allowance |
| Money left over | Sits in a wallet that may never be opened again | Cancel any time; it returns in one transaction |
| If the link leaks | Whoever claims first takes everything | Capped, dated and cancellable until spent |

## What it does

**For the issuer** (signs in with Google, email or a wallet):

1. **Write.** Type an amount and choose how long the cheque lasts (1, 7 or 30 days). One transaction escrows the USDC, tops up the fee allowance and writes the cheque, so it can't bounce.
2. **Share.** Copy the link, share it from the phone's share sheet, or show its QR code.
3. **Manage.** Watch each cheque's remaining balance, cancel it at any time to get unspent USDC and fees back, and send or receive USDC from the built-in wallet.
4. **Restore anywhere.** With a passkey enabled, every link is backed up on-chain in encrypted form and reopens on any device the passkey syncs to.

**For the person holding the link** (no account, no app):

1. Open the link. It goes straight to the camera and shows the cheque's balance and expiry.
2. Scan a USDC payment QR code, or enter an address and pick its network.
3. Check the amount and fee, then tap **Pay**. Progress is shown live until the payee has the funds: about 10 seconds on Monad, and about 15–30 seconds on other networks.

## How it works

### Architecture

```mermaid
flowchart TB
    subgraph Issuer["Issuer's browser"]
        W[Privy embedded wallet]
        V[(Passkey vault<br/>non-extractable AES key)]
    end
    subgraph Holder["Link holder's browser"]
        K[Cheque key<br/>from the URL fragment]
    end
    subgraph Monad["Monad testnet"]
        F[ChequeBookFactory]
        B[ChequeBook<br/>ERC-4337 account]
        EP[EntryPoint v0.7]
        U[(USDC)]
        TM[CCTP TokenMessengerV2]
    end
    P["Pippo bundler proxy<br/>(server route)"]
    A[Alchemy bundler]
    C[Circle Iris attestation<br/>+ Forwarding Service]
    D[Payee on Base, Arbitrum,<br/>Optimism, … 9 networks]
    M[Payee on Monad]

    W -- "createAndWrite / fundAndWrite<br/>(permit + sealed key)" --> F
    F -- deploys & writes --> B
    W -- "fundAndWrite / cancel" --> B
    V -. seals key .-> W
    K -- "signed UserOperation<br/>pay / payCrossChain" --> P --> A --> EP --> B
    B -- transfer --> U --> M
    B -- "depositForBurnWithHook" --> TM --> C -- "mint, gas paid by Circle" --> D
    X[(Envio indexer<br/>Monad + 9 networks)]
    B -. "writes, payments, burns" .-> X
    D -. "MessageReceived mints" .-> X
    X -. "payment history, live stats" .-> W
```

There is no Pippo backend holding funds or keys. The only server code is a narrow relay that forwards cheque payments to a bundler while keeping the bundler's API key private.

### A cheque is a key, not a wallet

When an issuer writes a cheque, their browser generates a fresh, one-off secp256k1 key. The key's **address** is registered on-chain as the cheque's identifier, together with its amount, expiry and fee budget. The **key** goes into the link:

```
https://<host>/c#<cheque book address>.<cheque key>      (both base64url-encoded)
```

Everything after `#` is the URL fragment, which browsers never send to a server. The spending key travels only from the issuer's device to the holder's device, through whatever channel the issuer chooses. Pippo's server never sees it.

The cheque key is deliberately weak. It can't hold funds or call arbitrary contracts. The only thing it can do is authorize a payment from its own cheque, up to its remaining balance, before its expiry and within its own fee budget.

### The cheque book: an ERC-4337 account per issuer

Each issuer gets one **ChequeBook**, a minimal ERC-4337 smart account that holds the escrowed USDC for all their cheques. Payments from a link arrive as UserOperations, and the book's `validateUserOp` enforces the cheque rules before any gas is spent:

- **Only payments.** The call data must be `pay(signer, recipient, amount)` or `payCrossChain(signer, domain, recipient, amount, maxFee)`, with no `initCode` and no paymaster.
- **The right key.** The operation must be signed (EIP-191 over the `userOpHash`) by the key of the cheque named in the first argument.
- **Per-cheque nonces.** The upper 192 bits of the nonce (the nonce key) must equal the cheque's address. Each cheque gets its own replay-protected sequence, so many cheques can be spent in parallel and a signature can never be replayed against another cheque.
- **Expiry without timestamps.** ERC-7562 forbids reading `block.timestamp` during validation, so the expiry is returned as `validUntil` and enforced by the EntryPoint.
- **Fee fencing.** Each cheque carries its own `gasLeft` budget. The operation's maximum cost, `(verificationGasLimit + callGasLimit + preVerificationGas) × maxFeePerGas`, must fit within it, and is charged against it. Operations that would certainly fail (an inactive cheque, a zero amount, more than what's left) are rejected during validation, so a link holder can't drain the fee budget with failing requests.

Gas for every payment comes from the book's EntryPoint deposit, never from the holder. The book keeps two accounting totals:
- `reserved`: the USDC escrowed by live cheques. Whatever exceeds it is the issuer's `available()` balance.
- `committedGas`: the fee budget still owed to live cheques. Any deposit above it belongs to the issuer and is returned when a cheque is cancelled.

| Function | Who can call it | What it does |
|---|---|---|
| `fundAndWrite` | Issuer | Tops up the fee deposit, pulls only the USDC shortfall (via permit), writes the cheque |
| `write` | Issuer or factory | Registers a cheque against already-available USDC |
| `cancel` | Issuer | Ends a cheque, refunds unspent USDC and any spare fee deposit |
| `pay` | EntryPoint (cheque key) | Transfers USDC to an address on Monad |
| `payCrossChain` | EntryPoint (cheque key) | Burns USDC through CCTP for delivery on another network |
| `list` | Anyone | Returns every cheque with its state and sealed key |

A cheque address can be written only once, so a cancelled link can never become spendable again.

### Writing a cheque in one transaction

The issuer never sees an "approve" step or a separate funding step:

- **First cheque.** `ChequeBookFactory.createAndWrite` does everything at once: deploys the issuer's book, pulls the USDC with an **EIP-2612 permit** signature, deposits the fee allowance (sent as `msg.value`), and writes the cheque.
- **Later cheques.** `ChequeBook.fundAndWrite` pulls only the shortfall between the cheque amount and the book's available balance. It tops up the fee deposit only when the spare deposit is below the per-cheque allowance (0.3 MON).
- **Front-run permits.** A permit someone else already submitted doesn't break the write; the contract falls back to the allowance it created.
- **Key saved first.** The cheque key is stored on the issuer's device before the transaction is sent, so a confirmed cheque can never end up without its link.

### Spending a link

```mermaid
sequenceDiagram
    autonumber
    participant H as Holder's browser
    participant R as Bundler proxy
    participant B as Bundler
    participant E as EntryPoint
    participant CB as ChequeBook
    participant I as Circle Iris

    H->>H: Read book + key from the URL fragment
    H->>CB: Read cheque (remaining, expiry, fee budget)
    H->>H: Scan payment QR (EIP-681 or address)
    H->>CB: Simulate the payment from the EntryPoint
    H->>R: eth_estimateUserOperationGas
    H->>H: Check max cost against the cheque's fee budget, sign with the cheque key
    H->>R: eth_sendUserOperation
    R->>R: Allowlist: method, EntryPoint, pay/payCrossChain only, book made by our factory
    R->>B: Forward
    B->>E: handleOps
    E->>CB: validateUserOp (key, nonce key, amount, fee budget, validUntil)
    E->>CB: pay / payCrossChain
    H->>E: Watch UserOperationEvent logs
    opt Cross-network
        H->>I: Poll message status until Circle's forward is confirmed
    end
```

- **Payment codes.** The scanner understands plain addresses and EIP-681 requests (`ethereum:<token>@<chainId>/transfer?address=…&uint256=…`), including scientific-notation amounts. It warns when a code asks for a token other than USDC, and asks the payer to choose a network when the code's chain isn't supported.
- **Checks before signing.** The payment is simulated from the EntryPoint, and its maximum cost is checked against both the cheque's fee budget and the book's deposit. Problems show up as plain-language messages instead of failed transactions.
- **Fees.** The UserOperation is built with viem's account-abstraction tools. Its fee includes a 50% base-fee buffer and a priority fee 20% above the bundler's quote, so it lands promptly.
- **Bundler proxy.** The proxy relays only bundler methods, only for EntryPoint v0.7, and only `pay` or `payCrossChain` operations from cheque books the factory created. It confirms the last point on-chain with `bookOf(owner) == sender`. The bundler API key is useless to anyone trying to relay anything else. Bundler errors such as AA21, AA22 and AA24 are turned into readable messages.
- **Confirmation.** The app reads the EntryPoint's `UserOperationEvent` logs directly, in 100-block windows to respect the public RPC limit. Confirmation doesn't depend on the bundler. A payment in progress survives page reloads.

### Paying across networks with CCTP

When the payee is on another network, `payCrossChain` calls Circle's **TokenMessengerV2** `depositForBurnWithHook`:

| Parameter | Value |
|---|---|
| Finality | Standard (`minFinalityThreshold = 2000`). Monad attests in about a block, and standard transfers from Monad carry no protocol fee |
| Hook data | `"cctp-forward"`, which invokes Circle's **Forwarding Service**. Circle submits the mint on the destination chain, so the payee needs no gas and no relayer is involved |
| `destinationCaller` | Zero, so the forwarder can complete the mint |
| `maxFee` | The forwarding fee quoted by Circle's Iris API (`/v2/burn/USDC/fees/15/<domain>?forward=true`, median quote) |

The cheque burns `amount + fee`, so **the payee receives exactly the amount requested**. The holder sees the fee before paying. After the burn, the app polls Iris (`/v2/messages/15?transactionHash=…`) for the attestation and the forward state, then links to the mint transaction on the destination explorer.

Verified on testnet: a cheque key paid **0.50 USDC** from Monad to an address on **Base Sepolia** with a 0.063284 USDC forwarding fee. Burn to mint took **about 15 seconds**, and the holder paid **0 MON**.
- Burn on Monad: [`0x4630…7a3`](https://testnet.monadexplorer.com/tx/0x46309070f65d48d8574d28098e5f37458fa24d6becaa999ddd9a2738d0fa27a3)
- Mint on Base Sepolia: [`0xa412…446`](https://sepolia.basescan.org/tx/0xa4120e50e6ee672e427dcdf3e2348102bc190b8ce509aed21f8fe924b8fc5446)

### Passkey-backed links: one passkey, many keys

A link's key normally exists only on the device that wrote it. Pippo uses the **WebAuthn PRF extension** (through Category Labs' Mera library) so that one passkey protects every link:

1. **Derive.** The passkey evaluates PRF with an app-specific salt, `SHA-256("pippo.v1.cheque-links")`. This produces a 32-byte secret that is identical on every device the passkey syncs to and unrelated to any other app.
2. **Split.** HKDF-SHA256 splits the secret into two keys that never sign anything:
   - an **AES-GCM-256 sealing key**, imported as a _non-extractable_ `CryptoKey` and kept in the browser's IndexedDB, so writing cheques needs no further prompts;
   - a **64-bit key id** that tells one passkey from another.

   The PRF output is zeroed straight after derivation.
3. **Seal.** Each new cheque key is encrypted, `version (1) | key id (8) | nonce (12) | ciphertext + tag (48)` (69 bytes), and stored on-chain alongside the cheque in the same write transaction. The contract treats it as opaque bytes, capped at 128. Every seal is decrypted and checked before the transaction is sent, so a faulty seal never reaches the chain.
4. **Restore.** On a new device, one passkey prompt rederives the vault and opens **every** live cheque sealed with that key id. Each decrypted key must control its cheque's address before it's accepted. Restored keys are cached locally, so the prompt isn't repeated.

The backup handles failures safely:

| Situation | Behaviour |
|---|---|
| Wrong passkey chosen | Refused, because its key id matches none of the book's seals |
| Prompt cancelled or timed out | Clear message, with the option to try again or create a new passkey |
| Passkey lost | Create a new one for future cheques. Links locked to the old one can still be cancelled for a full refund |
| Browser without PRF support | Detected before a passkey is created, so no unusable passkey is left behind |
| Corrupted local key or stored vault | Discarded and recovered from the on-chain seal |
| Sign-out | The vault and every key that has an on-chain backup are wiped from the device. Keys without a backup are kept so no link is lost |

Passkeys are bound to the site's domain, and new passkeys are named with their creation date so they can be told apart in the browser's picker.

### Issuer accounts and Monad-safe transactions

Optional bounded issuer gas sponsorship and wallet authenticator MFA are documented in [Privy testnet setup](docs/privy-testnet.md). Sponsorship stays on Monad testnet and uses server-only configuration.

- **Privy sign-in.** Google, email or an existing wallet. Email and social sign-ins create an embedded wallet with no seed phrase. Wallet pop-ups are disabled, and the app's own buttons are the confirmation.
- **Gas checks for Monad.** Monad charges gas by the gas _limit_. It also includes a transaction that can afford its gas but not its value, then reverts it, so the gas is lost. Every issuer transaction is therefore estimated as if funded, using a balance state override because Monad refuses to estimate a short balance. The value plus `gasLimit × maxFeePerGas` is checked against the real balance before anything is signed.
- **Live balances.** Wallet and cheque balances refresh every 10 seconds and whenever the tab regains focus.
- **Wallet screens.** The issuer can receive USDC and MON, and send USDC to any address on Monad or, through the same CCTP and forwarding route, to any of the nine other networks.

### Payment history across ten chains with Envio

The contracts hold each cheque's current state, but not its history. An **Envio HyperIndex** indexer adds the history: it follows the cheque books on Monad and Circle's CCTP MessageTransmitterV2 on all nine destination networks in a single indexer.

- **Cheque books.** The factory's `BookCreated` event registers each new ChequeBook as a dynamic contract. Its `ChequeWritten`, `ChequeCancelled`, `Paid` and `PaidCrossChain` events become `Book`, `Cheque` and `Payment` entities.
- **Deliveries, proven on the destination chain.** Every CCTP mint emits `MessageReceived` carrying the original burn message. That message names the paying cheque book as `messageSender`, the payee, the amount burned and the fee Circle actually took. A cross-network payment is marked delivered when its mint is indexed on the destination chain, with the payee's exact received amount and the mint transaction, without relying on Circle's API.
- **Linking burns to mints, in either order.** HyperIndex processes chains independently, so a mint on Base can be indexed before its burn on Monad. Each side waits under a shared key (paying book, destination domain, payee, amount burned), and whichever arrives second completes the payment.
- **Live totals.** A `Stats` entity counts cheques written, USDC paid out and cross-network deliveries. The landing page shows these, regenerated at most once a minute.

In the app, each cheque's page lists its payments: amount, payee, network, and whether the payment was paid, is on its way, or was delivered, each linked to the right explorer. Monad and six of the destination testnets sync through HyperSync. Unichain, Linea and World Chain Sepolia sync over RPC.

The indexer is optional. Without `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` the app works the same, without the payment list and live stats.

## Security model

| Threat | Mitigation |
|---|---|
| A link leaks | It can only spend its own capped escrow before its expiry, and the issuer can cancel it instantly |
| Holder tries to overspend | `spend` checks the remaining balance, and validation rejects it before any fee is charged |
| Holder floods failing operations to burn fees | Validation rejects operations that would fail, and each cheque's fee budget is capped separately |
| Signature replay | The nonce key is bound to the cheque's address; each cheque has its own sequence |
| Cancelled link reused | A cheque address can be registered only once |
| Server compromise | Keys live in URL fragments and never reach the server. The relay forwards only `pay`/`payCrossChain` for factory-made books |
| Sealed keys are public on-chain | AES-GCM under a key that only the issuer's passkey can rederive. Each opened key must match its cheque's address |
| Issuer funds | Only the issuer can write, fund or cancel. A cheque key can't move anything outside its own cheque |

## Supported networks

| Network (testnet) | Chain ID | CCTP domain | Route |
|---|---|---|---|
| Monad | 10143 | 15 | Direct USDC transfer |
| Base Sepolia | 84532 | 6 | CCTP + Forwarding Service |
| Arbitrum Sepolia | 421614 | 3 | CCTP + Forwarding Service |
| OP Sepolia | 11155420 | 2 | CCTP + Forwarding Service |
| Polygon Amoy | 80002 | 7 | CCTP + Forwarding Service |
| Avalanche Fuji | 43113 | 1 | CCTP + Forwarding Service |
| Unichain Sepolia | 1301 | 10 | CCTP + Forwarding Service |
| Linea Sepolia | 59141 | 11 | CCTP + Forwarding Service |
| World Chain Sepolia | 4801 | 14 | CCTP + Forwarding Service |
| Ethereum Sepolia | 11155111 | 0 | CCTP + Forwarding Service |

## Deployment

Monad testnet (chain 10143):

| Contract | Address |
|---|---|
| ChequeBookFactory | [`0xe51e48f765440c9c4187a11c78b17a810232d4f8`](https://testnet.monadexplorer.com/address/0xe51e48f765440c9c4187a11c78b17a810232d4f8) |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |

Each issuer's ChequeBook is deployed by the factory on their first cheque and can be looked up with `bookOf(issuer)`.

## Tech stack

| Layer | Technology |
|---|---|
| Contracts | Solidity 0.8.30, Foundry, OpenZeppelin, eth-infinitism account-abstraction v0.7 |
| Chain | Monad testnet, ERC-4337 EntryPoint v0.7, Alchemy bundler |
| Cross-chain | Circle CCTP V2, Forwarding Service, Iris API |
| App | Next.js 16 (App Router), React 19, viem (incl. account abstraction) |
| UI | Tailwind CSS v4, shadcn/ui on Base UI, React view transitions |
| Accounts | Privy (Google, email, external wallets, embedded wallets) |
| Passkeys | WebAuthn PRF through Mera, Web Crypto (HKDF, AES-GCM), IndexedDB |
| Indexing | Envio HyperIndex v3 and HyperSync, multichain with dynamic contracts, GraphQL |

## Running locally

**Prerequisites:** Node.js 22+, pnpm, and [Foundry](https://getfoundry.sh) for the contracts.

```bash
pnpm install
cp .env.example .env.local
pnpm dev                       # http://localhost:3000
```

| Variable | Needed for | Description |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | App | Privy app id for issuer sign-in |
| `ALCHEMY_API_KEY` | Payments | Server-side key for the Monad testnet bundler. Alternatively set `BUNDLER_RPC_URL` to any EntryPoint v0.7 bundler |
| `MONAD_RPC_URL`, `NEXT_PUBLIC_MONAD_RPC_URL` | Optional | RPC overrides. The default is Monad's public testnet RPC |
| `DEPLOYER_PRIVATE_KEY` | Deploy, smoke test | A testnet-only key holding MON (and USDC for the smoke test) |
| `NEXT_PUBLIC_ENVIO_GRAPHQL_URL` | Optional | The indexer's GraphQL endpoint, for payment history and live stats |

Test funds: [Circle USDC faucet](https://faucet.circle.com) and the [Monad faucet](https://faucet.monad.xyz).

**Contracts:**

```bash
pnpm contracts:test      # Foundry tests against a fork of Monad testnet
pnpm contracts:build     # compile and regenerate the app's ABI bindings
pnpm contracts:deploy    # deploy the factory and record its address for the app
```

**Indexer (optional):** needs Docker and a free [Envio API token](https://envio.dev/app/api-tokens) for HyperSync.

```bash
pnpm indexer:install
echo "ENVIO_API_TOKEN=<your token>" > indexer/.env
pnpm indexer:dev                                   # GraphQL on http://localhost:8080/v1/graphql
```

Then set `NEXT_PUBLIC_ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql` for the app. To host it, deploy the `indexer` folder on Envio's hosted service, with `indexer` as the root directory and `config.yaml` as the config file. Then point the app's variable at the hosted endpoint.

**Fully local fork:** run `anvil --fork-url https://testnet-rpc.monad.xyz`, deploy with `MONAD_RPC_URL=http://127.0.0.1:8545`, start the bundled minimal bundler with `pnpm dev:fork`, then run the app with `NEXT_PUBLIC_MONAD_RPC_URL` and `MONAD_RPC_URL` pointing at anvil and `BUNDLER_RPC_URL=http://localhost:4337`.

## Testing

| Command | What it covers |
|---|---|
| `pnpm contracts:test` | 14 Foundry tests on a Monad testnet fork: one-transaction writes, shortfall-only funding, sealed-key storage, payments on Monad and burns for other networks, per-cheque nonces, wrong-key and overspend rejection before fees are charged, cross-cheque nonce misuse, cancellation refunds (keeping fees other cheques still need), expiry, and issuer-only guards |
| `pnpm test` | Passkey vault: deterministic derivation, sealing and opening, wrong passkey, tampered nonce or ciphertext, seals moved to another cheque, malformed seals, restoring many links in one pass, corrupted local keys, and sign-out cleanup |
| `pnpm --dir indexer test` | Indexer: decoding a real CCTP burn message, burn and mint keys agreeing across chains, non-matching payments, domain mapping |
| `pnpm smoke` | End to end on real Monad testnet: writes a cheque, pays 0.5 USDC to Base Sepolia through the bundler, and waits for Circle's forwarder to deliver |
| `pnpm typecheck`, `pnpm lint` | TypeScript and ESLint |

## Limitations

- **Testnet only.** Test USDC has no value.
- **Monad is the only source chain.** Cheques are written and escrowed on Monad and pay out to ten networks.
- **Older links aren't backed up.** Links written before a passkey is set up stay on the device that wrote them. Those cheques can still be cancelled for a refund.
- **Passkeys are tied to the site's domain.** Links backed up on one domain can't be restored from another.
- **Fixed fee allowance.** Each cheque reserves 0.3 MON for gas, and whatever it doesn't use is refunded on cancel.

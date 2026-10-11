import { readFileSync, writeFileSync } from "node:fs"
import { createPublicClient, createWalletClient, http, defineChain } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3"
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"

if (!process.env.DEPLOYER_PRIVATE_KEY)
  throw new Error("Set a testnet-only DEPLOYER_PRIVATE_KEY in .env.local")
const rpc = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"
const chain = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
})
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
const client = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ chain, account, transport: http() })
const artifact = JSON.parse(
  readFileSync("contracts/out/ChequeBook.sol/ChequeBookFactory.json", "utf8")
)

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [ENTRY_POINT, USDC, TOKEN_MESSENGER],
})
const receipt = await client.waitForTransactionReceipt({ hash })
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error(`Deployment failed: ${hash}`)
writeFileSync(
  "lib/deployment.json",
  JSON.stringify(
    {
      chainId: 10143,
      factory: receipt.contractAddress,
      blockNumber: receipt.blockNumber.toString(),
      transactionHash: hash,
    },
    null,
    2
  ) + "\n"
)
console.log(`ChequeBookFactory ${receipt.contractAddress}`)

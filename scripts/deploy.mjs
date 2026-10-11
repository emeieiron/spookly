import { readFileSync, writeFileSync } from "node:fs"
import { createPublicClient, createWalletClient, http, defineChain } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { appNetwork } from "../config/network.mjs"

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
const USDC = appNetwork.payouts[0].usdc
const TOKEN_MESSENGER = appNetwork.tokenMessenger
const rpc = process.env.MONAD_RPC_URL ?? appNetwork.rpc
const chain = defineChain({
  id: appNetwork.chainId,
  name: appNetwork.chainName,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
})
const client = createPublicClient({ chain, transport: http() })
if ((await client.getChainId()) !== chain.id)
  throw new Error("RPC chain does not match NEXT_PUBLIC_PIPPO_NETWORK")
for (const address of [ENTRY_POINT, USDC, TOKEN_MESSENGER])
  if (!(await client.getCode({ address })))
    throw new Error(`Required contract missing: ${address}`)
console.log(
  `Deployment target: ${appNetwork.name}, chain ${chain.id}, USDC ${USDC}`
)
if (!process.argv.includes("--broadcast")) {
  console.log(
    "Checks passed. Add --broadcast to deploy and save this network's factory record."
  )
  process.exit(0)
}
if (!process.env.DEPLOYER_PRIVATE_KEY)
  throw new Error("Set DEPLOYER_PRIVATE_KEY for the selected network")
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
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
  `config/deployments/${appNetwork.name}.json`,
  JSON.stringify(
    {
      chainId: chain.id,
      factory: receipt.contractAddress,
      blockNumber: receipt.blockNumber.toString(),
      transactionHash: hash,
    },
    null,
    2
  ) + "\n"
)
console.log(`ChequeBookFactory ${receipt.contractAddress}`)

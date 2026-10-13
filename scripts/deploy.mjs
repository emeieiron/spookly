import { readFileSync, writeFileSync } from "node:fs"
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  http,
  defineChain,
  parseEther,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { appNetwork, deployment } from "../config/network.mjs"

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
  throw new Error("RPC chain does not match NEXT_PUBLIC_SPOOKLY_NETWORK")
for (const address of [ENTRY_POINT, USDC, TOKEN_MESSENGER])
  if (!(await client.getCode({ address })))
    throw new Error(`Required contract missing: ${address}`)
console.log(
  `Deployment target: ${appNetwork.name}, chain ${chain.id}, USDC ${USDC}`
)
const recordFlag = process.argv.indexOf("--record")
if (recordFlag !== -1) {
  const hash = process.argv[recordFlag + 1]
  if (!/^0x[\da-f]{64}$/i.test(hash ?? ""))
    throw new Error("Set --record to a deployment transaction hash")
  await recordDeployment(hash)
  process.exit(0)
}
if (
  !process.argv.includes("--broadcast") &&
  !process.argv.includes("--estimate")
) {
  console.log(
    "Checks passed. Add --broadcast to deploy and save this network's factory record."
  )
  process.exit(0)
}
if (
  deployment.factory &&
  !process.argv.includes("--estimate") &&
  !process.argv.includes("--replace-factory")
)
  throw new Error(
    "A factory is configured. Replacing it requires --replace-factory and an explicit gas fee limit."
  )
if (!process.env.DEPLOYER_PRIVATE_KEY)
  throw new Error("Set DEPLOYER_PRIVATE_KEY for the selected network")
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
const wallet = createWalletClient({ chain, account, transport: http() })
const artifact = JSON.parse(
  readFileSync("contracts/out/SpookBook.sol/SpookBookFactory.json", "utf8")
)

const args = [ENTRY_POINT, USDC, TOKEN_MESSENGER]
const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args,
})
const [estimatedGas, fees, balance] = await Promise.all([
  client.estimateGas({ account: account.address, data }),
  client.estimateFeesPerGas(),
  client.getBalance({ address: account.address }),
])
const gas = (estimatedGas * 12n) / 10n
const maximumFee = gas * fees.maxFeePerGas
const feeFlag = process.argv.indexOf("--max-fee")
if (feeFlag === -1 || !process.argv[feeFlag + 1])
  throw new Error("Set --max-fee in MON before broadcasting a deployment")
const cap = parseEther(process.argv[feeFlag + 1])
if (cap <= 0n || maximumFee > cap)
  throw new Error(
    `Deployment requires up to ${formatEther(maximumFee)} MON, above the configured fee limit`
  )
if (balance < maximumFee)
  throw new Error("The deployer does not have enough MON")
console.log(
  `Deployer ${account.address}; maximum gas fee ${formatEther(maximumFee)} MON`
)
if (process.argv.includes("--estimate")) process.exit(0)
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args,
  gas,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
})
console.log(`Deployment submitted: ${hash}`)
await recordDeployment(hash)

async function recordDeployment(hash) {
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`Deployment failed: ${hash}`)
  const artifact = JSON.parse(
    readFileSync("contracts/out/SpookBook.sol/SpookBookFactory.json", "utf8")
  )
  const expectedData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [ENTRY_POINT, USDC, TOKEN_MESSENGER],
  })
  const transaction = await client.getTransaction({ hash })
  if (
    transaction.to ||
    transaction.value !== 0n ||
    transaction.input.toLowerCase() !== expectedData.toLowerCase()
  )
    throw new Error(
      "The transaction does not deploy this network's configured factory"
    )
  if (
    deployment.factory &&
    !process.argv.includes("--replace-factory") &&
    deployment.factory.toLowerCase() !== receipt.contractAddress.toLowerCase()
  )
    throw new Error("A different factory is already recorded for this network")
  const values = await Promise.all(
    ["entryPoint", "usdc", "messenger"].map((functionName) =>
      client.readContract({
        address: receipt.contractAddress,
        abi: artifact.abi,
        functionName,
      })
    )
  )
  if (
    values.some(
      (value, i) =>
        value.toLowerCase() !==
        [ENTRY_POINT, USDC, TOKEN_MESSENGER][i].toLowerCase()
    )
  )
    throw new Error("The deployed factory has unexpected contract dependencies")
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
  console.log(`SpookBookFactory ${receipt.contractAddress}`)
}

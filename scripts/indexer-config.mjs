import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { createPublicClient, http } from "viem"
import { appNetwork, deployment } from "../config/network.mjs"

if (!deployment.factory || deployment.blockNumber == null)
  throw new Error(
    `Deploy a factory on ${appNetwork.name} before starting its indexer`
  )
const template = readFileSync("indexer/config.yaml", "utf8")
let config
if (appNetwork.name === "testnet")
  config = template
    .replace(/start_block: \d+/, `start_block: ${deployment.blockNumber}`)
    .replace(
      /address: "0xe51e48f765440c9c4187a11c78b17a810232d4f8"/,
      `address: "${deployment.factory}"`
    )
else {
  // Start destination indexing at the current blocks when first configuring the deployment.
  // Persist them so subsequent restarts cannot skip deliveries already in flight.
  const startsFile = "config/deployments/mainnet-indexer.json"
  let starts
  try {
    starts = JSON.parse(readFileSync(startsFile, "utf8"))
  } catch {
    const {
      mainnet,
      base,
      arbitrum,
      optimism,
      polygon,
      avalanche,
      unichain,
      linea,
      worldchain,
    } = await import("viem/chains")
    const chains = [
      base,
      arbitrum,
      optimism,
      polygon,
      avalanche,
      unichain,
      linea,
      worldchain,
      mainnet,
    ]
    starts = Object.fromEntries(
      await Promise.all(
        chains.map(async (chain) => [
          chain.id,
          Number(
            await createPublicClient({
              chain,
              transport: http(),
            }).getBlockNumber()
          ),
        ])
      )
    )
    writeFileSync(startsFile, JSON.stringify(starts, null, 2) + "\n")
  }
  const contracts = template.slice(
    template.indexOf("contracts:"),
    template.indexOf("# Start blocks")
  )
  const chains = appNetwork.payouts.map((n) =>
    n.chainId === appNetwork.chainId
      ? `  - id: ${n.chainId}\n    start_block: ${deployment.blockNumber}\n    contracts:\n      - name: ChequeBookFactory\n        address: "${deployment.factory}"\n      - name: ChequeBook`
      : `  - id: ${n.chainId}\n    start_block: ${starts[n.chainId]}\n    contracts:\n      - name: MessageTransmitter\n        address: "${appNetwork.messageTransmitter}"`
  )
  config = `name: pippo-mainnet\ndescription: Pippo mainnet cheques and CCTP deliveries\nrollback_on_reorg: true\naddress_format: lowercase\n\n${contracts}\nchains:\n${chains.join("\n")}\n`
}
const filename = `config.generated.${appNetwork.name}.yaml`
writeFileSync(`indexer/${filename}`, config)
const command = process.argv[2]
if (command) {
  if (!["dev", "codegen", "start"].includes(command))
    throw new Error("Use dev, codegen or start")
  const result = spawnSync(
    "node",
    ["node_modules/envio/bin.mjs", command, "--config", filename],
    {
      cwd: "indexer",
      stdio: "inherit",
      env: { ...process.env, ENVIO_CONFIG: resolve("indexer", filename) },
    }
  )
  process.exit(result.status ?? 1)
}
console.log(`Generated indexer/${filename}`)

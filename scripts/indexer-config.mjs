import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { createPublicClient, http } from "viem"
import { appNetwork, deployment } from "../config/network.mjs"

if (!deployment.factory || deployment.blockNumber == null)
  throw new Error(
    `Deploy a factory on ${appNetwork.name} before starting its indexer`
  )
// Hosted Envio builds only the indexer directory, so it carries the network facts its handlers need.
const profiles = JSON.parse(
  readFileSync(new URL("../config/networks.json", import.meta.url), "utf8")
)
mkdirSync("indexer/src", { recursive: true })
writeFileSync(
  "indexer/src/networks.json",
  JSON.stringify(
    Object.fromEntries(
      Object.entries(profiles).map(([name, p]) => [
        name,
        {
          chainId: p.chainId,
          tokenMessenger: p.tokenMessenger,
          payouts: p.payouts.map(({ chainId, domain }) => ({
            chainId,
            domain,
          })),
        },
      ])
    ),
    null,
    2
  ) + "\n"
)
const template = readFileSync("indexer/config.yaml", "utf8")
let config
if (appNetwork.name === "testnet")
  config = template
    .replace(/start_block: \d+/, `start_block: ${deployment.blockNumber}`)
    .replace(
      /(name: SpookBookFactory\n\s+address: ")[^"]+(")/,
      `$1${deployment.factory}$2`
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
    template.indexOf("\nchains:")
  )
  const chains = appNetwork.payouts.map((n) =>
    n.chainId === appNetwork.chainId
      ? `  - id: ${n.chainId}\n    start_block: ${deployment.blockNumber}\n    contracts:\n      - name: SpookBookFactory\n        address: "${deployment.factory}"\n      - name: SpookBook`
      : `  - id: ${n.chainId}\n    start_block: ${starts[n.chainId]}\n    contracts:\n      - name: MessageTransmitter\n        address: "${appNetwork.messageTransmitter}"`
  )
  config = `name: spookly-mainnet\ndescription: Spookly mainnet spooks and CCTP deliveries\nrollback_on_reorg: true\naddress_format: lowercase\n\n${contracts}\nchains:\n${chains.join("\n")}\n`
}
const filename = `config.generated.${appNetwork.name}.yaml`
writeFileSync(`indexer/${filename}`, config)
const command = process.argv[2]
if (command) {
  if (!["dev", "codegen", "start"].includes(command))
    throw new Error("Use dev, codegen or start")
  let runCommand = command
  if (appNetwork.name === "mainnet" && command === "dev") {
    const local = "indexer/.env.mainnet.local"
    if (!existsSync(local))
      writeFileSync(
        local,
        [
          "ENVIO_PG_HOST=localhost",
          "ENVIO_PG_PORT=5434",
          "ENVIO_PG_DATABASE=envio-dev",
          `ENVIO_PG_PASSWORD=${randomBytes(24).toString("hex")}`,
          "ENVIO_INDEXER_PORT=9899",
          "HASURA_GRAPHQL_ENDPOINT=http://localhost:8081/v1/metadata",
          `HASURA_GRAPHQL_ADMIN_SECRET=${randomBytes(24).toString("hex")}`,
          "",
        ].join("\n"),
        { mode: 0o600 }
      )
    if (existsSync("indexer/.env")) process.loadEnvFile("indexer/.env")
    process.loadEnvFile(local)
    if (
      process.env.ENVIO_PG_PORT !== "5434" ||
      process.env.HASURA_GRAPHQL_ENDPOINT !==
        "http://localhost:8081/v1/metadata"
    )
      throw new Error(
        "Mainnet development must use its isolated database and Hasura ports"
      )
    const docker = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        local,
        "-f",
        "indexer/compose.mainnet.yaml",
        "up",
        "-d",
      ],
      { stdio: "inherit" }
    )
    if (docker.status !== 0) process.exit(docker.status ?? 1)
    const codegen = spawnSync(
      "node",
      ["node_modules/envio/bin.mjs", "codegen", "--config", filename],
      { cwd: "indexer", stdio: "inherit" }
    )
    if (codegen.status !== 0) process.exit(codegen.status ?? 1)
    runCommand = "start"
  }
  const result = spawnSync(
    "node",
    ["node_modules/envio/bin.mjs", runCommand, "--config", filename],
    {
      cwd: "indexer",
      stdio: "inherit",
      env: { ...process.env, ENVIO_CONFIG: resolve("indexer", filename) },
    }
  )
  process.exit(result.status ?? 1)
}
console.log(`Generated indexer/${filename}`)

import profiles from "./networks.json" with { type: "json" }
import mainnet from "./deployments/mainnet.json" with { type: "json" }
import testnet from "./deployments/testnet.json" with { type: "json" }

// One build-time environment, shared by the app and developer tooling.
export function selectNetwork(value = "mainnet") {
  if (value !== "mainnet" && value !== "testnet")
    throw new Error("NEXT_PUBLIC_PIPPO_NETWORK must be mainnet or testnet")
  return profiles[value]
}
export const appNetwork = selectNetwork(process.env.NEXT_PUBLIC_PIPPO_NETWORK)
export const deployment = appNetwork.name === "mainnet" ? mainnet : testnet
if (deployment.chainId !== appNetwork.chainId)
  throw new Error(
    "The factory deployment does not match the configured network"
  )
if (deployment.factory && !/^0x[\da-f]{40}$/i.test(deployment.factory))
  throw new Error("Invalid factory deployment address")

// Mainnet requires an explicitly selected EntryPoint 0.7 bundler. No testnet fallback.
export function bundlerEndpoint(env = process.env) {
  return (
    env.BUNDLER_RPC_URL ||
    (appNetwork.name === "testnet" && env.ALCHEMY_API_KEY
      ? `https://monad-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
      : null)
  )
}

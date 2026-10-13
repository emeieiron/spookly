// Presentation only: this catalog never determines which networks the app supports.
export const CHAIN_CATALOG = {
  abstract: { name: "Abstract", aliases: ["abs"] },
  adi: { name: "ADI", aliases: [] },
  aleo: { name: "Aleo", aliases: [] },
  aptos: { name: "Aptos", aliases: [] },
  arbitrum: { name: "Arbitrum", aliases: ["arb", "42161", "421614"] },
  avalanche: { name: "Avalanche", aliases: ["avax", "43114", "43113"] },
  base: { name: "Base", aliases: ["8453", "84532"] },
  berachain: { name: "Berachain", aliases: ["bera"] },
  bsc: { name: "BNB Chain", aliases: ["bnb", "binance-smart-chain", "56"] },
  bitcoin: { name: "Bitcoin", aliases: ["btc"] },
  "bitcoin-cash": { name: "Bitcoin Cash", aliases: ["bch"] },
  cardano: { name: "Cardano", aliases: [] },
  dash: { name: "Dash", aliases: [] },
  dogecoin: { name: "Dogecoin", aliases: ["doge"] },
  ethereum: { name: "Ethereum", aliases: ["eth", "1", "11155111"] },
  fogo: { name: "Fogo", aliases: [] },
  gnosis: { name: "Gnosis", aliases: ["100"] },
  hyperliquid: { name: "Hypercore", aliases: ["hypercore"] },
  linea: { name: "Linea", aliases: ["59144", "59141"] },
  litecoin: { name: "Litecoin", aliases: ["ltc"] },
  monad: { name: "Monad", aliases: ["143", "10143"] },
  movement: { name: "Movement", aliases: [] },
  near: { name: "NEAR", aliases: ["near-protocol"] },
  optimism: { name: "Optimism", aliases: ["op", "10", "11155420"] },
  plasma: { name: "Plasma", aliases: [] },
  polygon: { name: "Polygon", aliases: ["pol", "137", "80002"] },
  robinhood: { name: "Robinhood", aliases: ["hood"] },
  scroll: { name: "Scroll", aliases: ["534352"] },
  solana: { name: "Solana", aliases: ["sol"] },
  starknet: { name: "Starknet", aliases: [] },
  stellar: { name: "Stellar", aliases: [] },
  sui: { name: "Sui", aliases: [] },
  ton: { name: "TON", aliases: [] },
  tron: { name: "TRON", aliases: [] },
  unichain: { name: "Unichain", aliases: ["130", "1301"] },
  world: { name: "World Chain", aliases: ["worldchain", "480", "4801"] },
  xlayer: { name: "X Layer", aliases: ["x-layer"] },
  xrp: { name: "XRP Ledger", aliases: [] },
  zcash: { name: "Zcash", aliases: ["zec"] },
} as const

const chains = new Map(
  Object.entries(CHAIN_CATALOG).flatMap(([id, entry]) =>
    [id, ...entry.aliases].map(
      (alias) =>
        [
          alias,
          {
            name: entry.name,
            icon: `/chains/${id}.svg`,
          },
        ] as const
    )
  )
)

export function chainMetadata(chain: string | number) {
  const key = String(chain).toLowerCase()
  return (
    chains.get(key) ?? {
      name: key.charAt(0).toUpperCase() + key.slice(1),
      icon: null,
    }
  )
}

export const chainLabel = (chain: string | number) => chainMetadata(chain).name

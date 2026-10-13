# Chain logos

Locally served, self-contained SVGs from `@web3icons/core` 4.0.58
([Web3Icons](https://github.com/0xa3k5/web3icons)), under the included MIT license.
Only the 39 logos used by Pippo's Aurora sources and payout networks are included;
the full icon library is not a runtime dependency. Whitespace and the unused root
class were removed. Background variants keep logos visible on both light and dark
surfaces. Native coin artwork is used for ADI, Aleo, Bitcoin Cash, Dash, Dogecoin,
Fogo, and Zcash; Hyperliquid artwork is shared by Hypercore.

Names, Aurora aliases, and mainnet/testnet chain IDs live in `lib/chain-catalog.ts`.
Use `ChainName` for visible chain names and `chainLabel` for plain-text labels.
Images are decorative beside text, reserve a fixed 20px square, and remain vector
assets at every pixel density. Next.js serves SVGs directly without raster resizing.
Unknown chains render their name with a neutral network icon.

To add a chain, vendor its SVG here, retain its source/license attribution, and add
one catalog entry. The catalog is presentation metadata; it does not enable chains
or alter the app's developer-selected network.

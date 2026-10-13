# Asset logos

Locally served SVGs from `@web3icons/core` 4.0.58
([Web3Icons](https://github.com/0xa3k5/web3icons)), under the included MIT license.
Background variants remain visible on light and dark surfaces. Whitespace and the
unused root class were removed. Native and network-branded tokens reuse artwork
from `public/chains`; WETH shares Ethereum artwork while retaining its exact symbol.

`lib/asset-catalog.ts` maps exact symbols, case-insensitively, to local images.
`AssetName` keeps the original symbol visible beside a decorative 20px image.
Uncatalogued symbols use a neutral coin icon. Do not strip prefixes or suffixes
to guess logos for wrapped, bridged, or similarly named assets.

This is presentation metadata, not an asset registry or verification signal.
Aurora asset IDs still determine selection, quotes, and payments. New assets must
retain their exact identity even when their branding is shared.

import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Address,
} from "viem"
import { ENTRY_POINT } from "../chain"
import { isDelegated } from "../monad-reserve"
import { type SponsorRequest } from "../sponsorship"

// Privy's observed Monad testnet Kernel delegation. Existing wallets use their
// actual delegate; this models the provider's initial delegation for new EOAs.
export const PRIVY_TESTNET_DELEGATE: Address =
  "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28"
const executionAbi = parseAbi([
  "function execute(bytes32 mode, bytes calls) payable",
])

export function sponsorExecution(
  wallet: Address,
  code: `0x${string}` | undefined,
  calls: SponsorRequest["body"]["params"]["calls"]
) {
  const data = encodeFunctionData({
    abi: executionAbi,
    functionName: "execute",
    args: [
      "0x0100000000000000000000000000000000000000000000000000000000000000",
      encodeAbiParameters(
        [
          {
            type: "tuple[]",
            components: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "callData", type: "bytes" },
            ],
          },
        ],
        [
          calls.map((call) => ({
            target: call.to,
            value: BigInt(call.value),
            callData: call.data,
          })),
        ]
      ),
    ],
  })
  return {
    account: ENTRY_POINT,
    to: wallet,
    data,
    // Preserve actual balances and delegation so Monad's reserve rule and
    // ERC-1271 permit behavior are exercised. Never estimate as a funded EOA.
    ...(!isDelegated(code)
      ? {
          stateOverride: [
            {
              address: wallet,
              code: concat(["0xef0100", PRIVY_TESTNET_DELEGATE]),
            },
          ],
        }
      : {}),
  }
}

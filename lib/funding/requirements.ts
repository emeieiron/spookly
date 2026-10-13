import { parseEther } from "viem"
import { FEE_ALLOWANCE } from "../spook-book"
import { MONAD_DELEGATED_RESERVE } from "../monad-reserve"
import type { FundingTarget } from "./model"

// Reserve for issuer transaction gas; unused MON stays in the wallet.
export const CREATION_GAS_RESERVE = parseEther("1")
export function creationGasReserve(maxFeePerGas: bigint, hasBook: boolean) {
  // Creating a book deploys its contract. Further Spooks need much less gas.
  return (maxFeePerGas * (hasBook ? 700_000n : 5_000_000n) * 12n) / 10n
}
export function fundingTargets(
  amount: bigint,
  usdc: bigint,
  mon: bigint,
  available = 0n,
  spareGas = 0n,
  gasReserve = CREATION_GAS_RESERVE,
  delegated = false
): FundingTarget[] {
  const targets: FundingTarget[] = []
  const missingUsdc = amount - available - usdc
  const value = FEE_ALLOWANCE > spareGas ? FEE_ALLOWANCE - spareGas : 0n
  const neededMon =
    value +
    gasReserve +
    (delegated && value > 0n ? MONAD_DELEGATED_RESERVE : 0n)
  if (missingUsdc > 0n)
    targets.push({ symbol: "USDC", amount: missingUsdc.toString() })
  if (neededMon > mon)
    targets.push({ symbol: "MON", amount: (neededMon - mon).toString() })
  return targets
}

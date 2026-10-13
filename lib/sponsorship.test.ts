import assert from "node:assert/strict"
import { test } from "node:test"
import {
  encodeFunctionData,
  getAddress,
  recoverMessageAddress,
  toHex,
  zeroHash,
  type Address,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { spookBookAbi, factoryAbi } from "./abi"
import { FACTORY, USDC, erc20Abi } from "./chain"
import {
  allowedSponsorCall,
  parseSponsorTransaction,
  sponsorApproval,
} from "./server/sponsor-policy"
import { sponsorProofMessage, sponsorRequest } from "./sponsorship"

const owner = privateKeyToAccount(toHex(1n, { size: 32 }))
const other = privateKeyToAccount(toHex(2n, { size: 32 }))
const book = getAddress("0x1111111111111111111111111111111111111111")
const permit = { deadline: 0n, v: 0, r: zeroHash, s: zeroHash }
const transfer = () =>
  parseSponsorTransaction({
    from: owner.address,
    to: USDC,
    value: "0x0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [other.address, 1_000_000n],
    }),
  })

test("sponsorship accepts only bounded values and explicit transaction fields", () => {
  assert.throws(() => parseSponsorTransaction({ ...transfer(), chainId: 143 }))
  assert.throws(() =>
    parseSponsorTransaction({
      ...transfer(),
      value: toHex(300_000_000_000_000_001n),
    })
  )
  assert.throws(() => parseSponsorTransaction({ ...transfer(), data: "0x" }))
  assert.throws(() =>
    parseSponsorTransaction({ ...transfer(), from: other.address.slice(2) })
  )
})

test("sponsorship cannot be used for arbitrary contracts, approvals or native transfers", () => {
  assert.equal(allowedSponsorCall(transfer(), null), true)
  assert.equal(
    allowedSponsorCall({ ...transfer(), to: other.address }, null),
    false
  )
  assert.equal(allowedSponsorCall({ ...transfer(), value: "0x1" }, null), false)
  assert.equal(
    allowedSponsorCall({ ...transfer(), data: `${transfer().data}00` }, null),
    false
  )
  assert.equal(
    allowedSponsorCall(
      {
        ...transfer(),
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [other.address, 1n],
        }),
      },
      null
    ),
    false
  )
})

test("only the issuer's factory book can receive sponsored management calls", () => {
  const tx = parseSponsorTransaction({
    ...transfer(),
    to: book,
    data: encodeFunctionData({
      abi: spookBookAbi,
      functionName: "cancel",
      args: [other.address],
    }),
  })
  assert.equal(allowedSponsorCall(tx, book), true)
  assert.equal(allowedSponsorCall(tx, owner.address), false)
  assert.equal(allowedSponsorCall({ ...tx, value: "0x1" }, book), false)
})

test("a spook's batch approves only its exact USDC pull", () => {
  const tx = parseSponsorTransaction({
    ...transfer(),
    to: FACTORY as Address,
    data: encodeFunctionData({
      abi: factoryAbi,
      functionName: "createAndSpook",
      args: [other.address, 2_000_000n, 9999999999n, 1n, permit, "0x"],
    }),
  })
  assert.equal(allowedSponsorCall(tx, null), true)
  assert.equal(allowedSponsorCall(tx, book), false)
  const request = sponsorRequest(
    "app",
    "wallet",
    "request",
    tx,
    Date.now() + 1000,
    sponsorApproval(tx)
  )
  assert.equal(request.body.caip2, "eip155:10143")
  assert.equal(request.body.method, "wallet_sendCalls")
  assert.equal(request.body.params.calls.length, 2)
  assert.deepEqual(request.body.params.calls[0], {
    to: USDC,
    value: "0x0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [tx.to, 2_000_000n],
    }),
  })
  const fund = parseSponsorTransaction({
    ...transfer(),
    to: book,
    data: encodeFunctionData({
      abi: spookBookAbi,
      functionName: "fundAndSpook",
      args: [
        other.address,
        2_000_000n,
        9999999999n,
        1n,
        500_000n,
        permit,
        "0x",
      ],
    }),
  })
  assert.equal(sponsorApproval(fund), 500_000n)
})

test("wallet authorization is bound to the complete request, approval, expiry and network", async () => {
  const request = sponsorRequest(
    "app",
    "wallet",
    "request",
    transfer(),
    Date.now() + 1000
  )
  const signature = await owner.signMessage({
    message: sponsorProofMessage(request),
  })
  assert.equal(
    await recoverMessageAddress({
      message: sponsorProofMessage(request),
      signature,
    }),
    owner.address
  )
  const changed = structuredClone(request)
  changed.body.params.calls[0].to = other.address
  assert.notEqual(
    await recoverMessageAddress({
      message: sponsorProofMessage(changed),
      signature,
    }),
    owner.address
  )
  changed.headers["privy-request-expiry"] = "1"
  assert.notEqual(
    await recoverMessageAddress({
      message: sponsorProofMessage(changed),
      signature,
    }),
    owner.address
  )
})

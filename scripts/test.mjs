import { readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"

const tests = readdirSync("lib").filter((name) => name.endsWith(".test.ts"))
for (const network of ["testnet", "mainnet"]) {
  // Sponsorship is testnet-only; mainnet exercises funding and network isolation.
  const selected =
    network === "testnet"
      ? tests
      : tests.filter(
          (name) =>
            !name.startsWith("sponsor") && name !== "issuer-write.test.ts"
        )
  console.log(`Testing ${network}`)
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...selected.map((name) => `lib/${name}`)],
    {
      stdio: "inherit",
      env: { ...process.env, NEXT_PUBLIC_PIPPO_NETWORK: network },
    }
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}

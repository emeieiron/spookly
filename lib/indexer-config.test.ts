import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const profiles = JSON.parse(readFileSync("config/networks.json", "utf8"))

for (const network of ["mainnet", "testnet"]) {
  test(`${network} indexer config contains one chain list and its configured Spook factory`, () => {
    const directory = mkdtempSync(join(tmpdir(), "spookly-indexer-"))
    try {
      mkdirSync(join(directory, "indexer"))
      mkdirSync(join(directory, "config/deployments"), { recursive: true })
      copyFileSync(
        "indexer/config.yaml",
        join(directory, "indexer/config.yaml")
      )
      copyFileSync(
        "config/deployments/mainnet-indexer.json",
        join(directory, "config/deployments/mainnet-indexer.json")
      )
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/indexer-config.mjs")],
        {
          cwd: directory,
          env: { ...process.env, NEXT_PUBLIC_SPOOKLY_NETWORK: network },
          encoding: "utf8",
        }
      )
      assert.equal(result.status, 0, result.stderr)
      const output = readFileSync(
        join(directory, `indexer/config.generated.${network}.yaml`),
        "utf8"
      )
      assert.equal([...output.matchAll(/^chains:/gm)].length, 1)
      const ids = [...output.matchAll(/^  - id: (\d+)/gm)].map((match) =>
        Number(match[1])
      )
      assert.deepEqual(
        ids.sort((a, b) => a - b),
        profiles[network].payouts
          .map((p: { chainId: number }) => p.chainId)
          .sort((a: number, b: number) => a - b)
      )
      const deployment = JSON.parse(
        readFileSync(`config/deployments/${network}.json`, "utf8")
      )
      assert.ok(output.includes(`address: "${deployment.factory}"`))
      assert.ok(output.includes("SpookCreated(address indexed signer"))
      assert.ok(output.includes("SpookCancelled(address indexed signer"))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

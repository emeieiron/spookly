import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"

const container = `pippo-sponsor-test-${randomUUID()}`
const started = spawnSync(
  "docker",
  ["run", "--rm", "-d", "--name", container, "redis:7-alpine"],
  { stdio: "inherit" }
)
if (started.status !== 0) process.exit(started.status ?? 1)
let status = 1
try {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "lib/sponsor-store.integration.test.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SPONSOR_REDIS_TEST_CONTAINER: container,
        NEXT_PUBLIC_PIPPO_NETWORK: "testnet",
      },
    }
  )
  status = result.status ?? 1
} finally {
  spawnSync("docker", ["stop", container], { stdio: "inherit" })
}
process.exit(status)

import assert from "node:assert/strict"
import { test } from "node:test"
import { passkeyRpId, route } from "./hosts"

const app = "app.spookly.xyz"
const site = "spookly.xyz"

test("the app host serves app pages from its root", () => {
  assert.deepEqual(route(app, "/"), { rewrite: "/app" })
  assert.deepEqual(route(app, "/send"), { rewrite: "/app/send" })
  assert.deepEqual(route(app, "/spooks/0xabc"), {
    rewrite: "/app/spooks/0xabc",
  })
  assert.equal(route(app, "/spook"), null)
  assert.equal(route(app, "/sender"), null)
})

test("the app host drops a leftover /app prefix", () => {
  assert.deepEqual(route(app, "/app"), { redirect: "https://app.spookly.xyz/" })
  assert.deepEqual(route(app, "/app/history"), {
    redirect: "https://app.spookly.xyz/history",
  })
})

test("the site sends app pages and spook links to the app host", () => {
  for (const host of [site, `www.${site}`]) {
    assert.deepEqual(route(host, "/app"), {
      redirect: "https://app.spookly.xyz/",
    })
    assert.deepEqual(route(host, "/app/spooks/0xabc"), {
      redirect: "https://app.spookly.xyz/spooks/0xabc",
    })
    assert.deepEqual(route(host, "/spook"), {
      redirect: "https://app.spookly.xyz/spook",
    })
    assert.equal(route(host, "/"), null)
    assert.equal(route(host, "/application"), null)
  }
})

test("hosts without an app subdomain keep the app under /app", () => {
  const preview = "spookly-abc-mcxross.vercel.app"
  assert.equal(route(preview, "/"), null)
  assert.equal(route(preview, "/app"), null)
  assert.deepEqual(route(preview, "/receive"), { rewrite: "/app/receive" })
})

test("one passkey covers the site and the app subdomain", () => {
  assert.equal(passkeyRpId(app), site)
  assert.equal(passkeyRpId(site), site)
  assert.equal(passkeyRpId(`www.${site}`), site)
  assert.equal(passkeyRpId("localhost"), "localhost")
  assert.equal(passkeyRpId("notspookly.xyz"), "notspookly.xyz")
})

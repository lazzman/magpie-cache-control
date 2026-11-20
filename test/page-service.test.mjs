import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { startPageService } from "../lib/page-service.js"

async function fixture(context, responder, { timeout } = {}) {
  const requests = []
  const gateway = createServer((incoming, response) => {
    requests.push({ method: incoming.method, path: incoming.url, headers: incoming.headers })
    responder(incoming, response)
  })
  gateway.listen(0, "127.0.0.1")
  await once(gateway, "listening")
  const service = await startPageService({ port: 0, gatewayAddress: "127.0.0.1:" + gateway.address().port, timeout })
  context.after(async () => {
    service.closeAllConnections()
    gateway.closeAllConnections()
    await Promise.all([new Promise((resolve) => service.close(resolve)), new Promise((resolve) => gateway.close(resolve))])
  })
  const base = "http://127.0.0.1:" + service.address().port
  return { base, requests, read: (extra = {}) => fetch(base + "/api/model-providers", { headers: { "X-Magpie-Cache-Control": "models", Origin: "null" }, ...extra }) }
}

test("Page service reads only the local model list and returns unique provider IDs without model or credential data", async (context) => {
  const app = await fixture(context, (_, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ data: [
      { id: "alpha/one", owned_by: "alpha", secret: "never-expose" },
      { id: "group/alias", owned_by: "alpha" },
      { id: "unprefixed-model", owned_by: "beta" },
    ], has_more: false }))
  })
  const response = await app.read()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { providerIds: ["alpha", "beta"], modelCount: 3 })
  assert.equal(response.headers.get("access-control-allow-origin"), "null")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(app.requests.length, 1)
  assert.equal(app.requests[0].method, "GET")
  assert.equal(app.requests[0].path, "/v1/models")
  assert.equal(app.requests[0].headers.authorization, undefined)
  assert.equal(app.requests[0].headers.cookie, undefined)
})

test("Malformed, incomplete and unauthorized model responses are errors, not empty provider ranges", async (context) => {
  let body = { data: [] }
  let status = 200
  const app = await fixture(context, (_, response) => {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body))
  })
  assert.deepEqual(await (await app.read()).json(), { providerIds: [], modelCount: 0 })
  for (const invalid of [{}, { data: {} }, { data: [{ id: "alpha/one" }] }, { data: [null] }, { data: [], has_more: true }]) {
    body = invalid
    const response = await app.read()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: "models-unavailable" })
  }
  status = 401
  assert.equal((await app.read()).status, 503)
})

test("A stalled gateway read times out without blocking the page service", async (context) => {
  const app = await fixture(context, () => {}, { timeout: 40 })
  assert.equal((await app.read()).status, 503)
  assert.equal((await fetch(app.base + "/style.css")).status, 200)
})

test("The service refuses cross-site reads, DNS rebinding, arbitrary routes and write methods", async (context) => {
  const app = await fixture(context, (_, response) => response.end('{"data":[]}'))
  assert.equal((await app.read({ method: "POST" })).status, 405)
  assert.equal((await app.read({ headers: { Origin: "https://example.com", "X-Magpie-Cache-Control": "models" } })).status, 403)
  assert.equal((await fetch(app.base + "/api/model-providers")).status, 403)
  assert.equal((await fetch(app.base + "/v1/chat/completions")).status, 404)
  assert.equal((await fetch(app.base + "/package.json")).status, 404)
  const status = await new Promise((resolve, reject) => {
    const incoming = request(app.base + "/api/model-providers", { headers: { Host: "example.com", "X-Magpie-Cache-Control": "models" } }, (response) => { response.resume(); resolve(response.statusCode) })
    incoming.on("error", reject)
    incoming.end()
  })
  assert.equal(status, 403)
  assert.equal(app.requests.length, 0)
})

test("Service HTML reuses the native bridge and permits its own read-only connection for opaque frames", async (context) => {
  const app = await fixture(context, (_, response) => response.end('{"data":[]}'))
  const bridge = "https://magpie.example/path/_magpie/plugin/native-token/_magpie/bridge.js"
  const response = await fetch(app.base + "/index.html?bridge=" + encodeURIComponent(bridge))
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /name="cache-control-model-service" content="1"/)
  assert.ok(html.includes('src="' + bridge + '"'))
  assert.match(response.headers.get("content-security-policy"), /sandbox allow-scripts/)
  assert.ok(response.headers.get("content-security-policy").includes("connect-src 'self' " + app.base))
  assert.equal((await fetch(app.base + "/index.html?bridge=" + encodeURIComponent("https://example.com/other.js"))).status, 400)
  assert.equal((await fetch(app.base + "/index.html?bridge=" + encodeURIComponent("https://example.com/path;script-src/_magpie/plugin/native-token/_magpie/bridge.js"))).status, 400)
  assert.equal((await fetch(app.base + "/index.html")).status, 400)
  const preflight = await fetch(app.base + "/api/model-providers", { method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-magpie-cache-control" } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET")
})

test("The backend cannot be configured as a remote or arbitrary-URL proxy", async () => {
  for (const address of ["https://example.com", "example.com:80", "http://127.0.0.1:3425/other", "http://key@127.0.0.1:3425"]) {
    await assert.rejects(startPageService({ port: 0, gatewayAddress: address }))
  }
})

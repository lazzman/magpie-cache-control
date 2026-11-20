import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import * as plugin from "../cache-control.middleware.js"
import { contractCases } from "./contracts.js"

for (const entry of contractCases(plugin)) test(entry.name, entry.run)

test("Logs describe measures and distinguish missing usage from reported zero", (ctx) => {
  const messages = []
  ctx.mock.method(console, "log", (message) => messages.push(JSON.parse(message)))
  const context = { protocol: "responses", options: { mode: "bust", log: true }, state: {}, provider: { id: "vendor" }, reject: assert.fail }
  const request = { instructions: "secret prompt", input: "secret question", prompt_cache_key: "secret key" }
  plugin.onRequest(request, context)
  plugin.onProvider(request, context)
  assert.equal(messages[0].phase, "provider")
  assert.equal(messages[0].salted, true)
  assert.equal(messages[0].outcome, "unknown")
  plugin.onResponse({ usage: { input_tokens_details: { cached_tokens: 0 } } }, context)
  assert.equal(messages.at(-1).outcome, "reported-zero")
  plugin.onEvent({ response: { usage: { input_tokens_details: { cached_tokens: 12 } } } }, context)
  assert.equal(messages.at(-1).outcome, "hit")
  const count = messages.length
  plugin.onEvent({ response: { usage: { input_tokens_details: { cached_tokens: 12 } } } }, context)
  assert.equal(messages.length, count)
  assert.doesNotMatch(JSON.stringify(messages), /secret|magpie-cache-control:/)
})

test("Responses percentage diagnostics use the upstream inclusive input total", (ctx) => {
  const entries = []
  ctx.mock.method(console, "log", (entry) => entries.push(JSON.parse(entry)))
  const context = { protocol: "responses", options: { mode: "bust", log: true, rotation: { strategy: "percent", percent: 5 } }, state: {}, provider: { id: "vendor" }, reject: assert.fail }
  const body = { input: "x".repeat(200) }
  plugin.onRequest(body, context)
  plugin.onProvider(body, context)
  plugin.onEvent({ response: { usage: { input_tokens_details: { cached_tokens: 932 } } } }, context)
  assert.equal(entries.at(-1).cacheHitPercent, null)
  plugin.onEvent({ response: { usage: { input_tokens: 305745, input_tokens_details: { cached_tokens: 932 } } } }, context)
  assert.equal(entries.at(-1).rotation.percent, 5)
  assert.equal(entries.at(-1).rotation.prefixTextUnits, 10)
  assert.equal(entries.at(-1).cacheHitPercent, 100 * 932 / 305745)
})

test("Package entry and defaults match the installable middleware", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const example = JSON.parse(await readFile(new URL("../options.example.json", import.meta.url), "utf8"))
  assert.deepEqual(example, manifest.magpie.options)
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.exports, undefined)
  assert.deepEqual(Object.keys(plugin).sort(), ["onEvent", "onProvider", "onRequest", "onResponse"])
  await readFile(new URL("../" + manifest.magpie.middleware, import.meta.url))
})

test("A skipped provider policy is explicitly reported even with diagnostics off, without private request data", (testContext) => {
  const messages = []
  testContext.mock.method(console, "log", (message) => messages.push(JSON.parse(message)))
  const context = { protocol: "responses", options: { mode: "passthrough", providers: { alpha: { mode: "bust", log: false, rotation: { strategy: "turns", turns: 10 } } } }, state: {}, provider: { id: "alpha" }, reject: assert.fail }
  const request = { input: "private user input", previous_response_id: "private reference" }
  assert.equal(plugin.onRequest(structuredClone(request), context), undefined)
  assert.equal(plugin.onProvider(structuredClone(request), context), undefined)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].phase, "provider-skipped")
  assert.equal(messages[0].provider, "alpha")
  assert.equal(messages[0].policyScope, "provider")
  assert.equal(messages[0].rotation.strategy, "turns")
  assert.equal(messages[0].salted, false)
  assert.doesNotMatch(JSON.stringify(messages), /private|magpie-cache-control:/)
})

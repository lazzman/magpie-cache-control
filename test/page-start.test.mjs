import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const source = await readFile(new URL("../page/start.js", import.meta.url), "utf8")

async function boot({ service = "", host = "127.0.0.1", onService = false, options = {}, bridgeMissing = false } = {}) {
  const elements = new Map(["status", "retryButton", "modelService"].map((id) => [id, { content: "", hidden: true, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback } }]))
  elements.get("modelService").content = onService ? "1" : ""
  const redirects = []
  const scripts = []
  let reloaded = false
  const context = vm.createContext({
    document: { getElementById: (id) => elements.get(id), createElement: () => ({ addEventListener() {} }), head: { append: (script) => scripts.push(script.src) } },
    magpie: bridgeMissing ? undefined : { ready: Promise.resolve(), theme: { lang: "zh" }, service, options: { get: async () => options } },
    navigator: { language: "zh" }, URL,
    location: { hostname: host, href: "https://" + host + "/prefix/_magpie/plugin/native-token/index.html", replace: (url) => redirects.push(url), reload() { reloaded = true } },
    setTimeout() {},
  })
  vm.runInContext(source, context)
  await new Promise((resolve) => setImmediate(resolve))
  return { redirects, scripts, elements, reloaded: () => reloaded }
}

test("Web bootstrap uses Magpie's same-host service proxy and retains the native bridge URL", async () => {
  const view = await boot({ host: "magpie.example", service: "https://magpie.example/prefix/_magpie/plugin/native-token/_magpie/service/" })
  const url = new URL(view.redirects[0])
  assert.equal(url.origin, "https://magpie.example")
  assert.equal(url.pathname, "/prefix/_magpie/plugin/native-token/_magpie/service/index.html")
  assert.equal(url.searchParams.get("bridge"), "https://magpie.example/prefix/_magpie/plugin/native-token/_magpie/bridge.js")
  assert.deepEqual(view.scripts, [])
})

test("Desktop bootstrap connects to its own local service and honors the saved port", async () => {
  const view = await boot({ host: "wails.localhost", options: { pageServicePort: 3491 } })
  assert.equal(new URL(view.redirects[0]).origin, "http://127.0.0.1:3491")
})

test("An older remote host without a service proxy shows a reconnect error rather than using the viewer's localhost", async () => {
  const view = await boot({ host: "magpie.example" })
  assert.deepEqual(view.redirects, [])
  assert.equal(view.elements.get("retryButton").hidden, false)
  view.elements.get("retryButton").listeners.click()
  assert.equal(view.reloaded(), true)
})

test("Once on the service page the app loads without another navigation", async () => {
  const view = await boot({ onService: true })
  assert.deepEqual(view.scripts, ["app.js"])
  assert.deepEqual(view.redirects, [])
})

test("A bridge script that failed to load leaves a working reconnect action", async () => {
  const view = await boot({ bridgeMissing: true, onService: true })
  assert.deepEqual(view.redirects, [])
  assert.deepEqual(view.scripts, [])
  assert.equal(view.elements.get("retryButton").hidden, false)
  assert.match(view.elements.get("status").textContent, /重新启用插件/)
})

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const source = await readFile(new URL("../page/start.js", import.meta.url), "utf8")

async function boot({ service = "", host = "127.0.0.1", onService = false, options = {}, bridgeMissing = false, nativeParent = false, onCall } = {}) {
  const elements = new Map(["status", "retryButton", "modelService"].map((id) => [id, { content: "", hidden: true, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback } }]))
  elements.get("modelService").content = onService ? "1" : ""
  const redirects = []
  const scripts = []
  let reloaded = false
  const listeners = new Map()
  const messages = []
  const pending = new Map()
  let timerId = 0
  const root = { dataset: {}, style: { setProperty(name, value) { this[name] = value } } }
  const parentWindow = { postMessage(message, target) {
    messages.push({ message, target })
    Promise.resolve().then(async () => {
      if (onCall) return onCall(message, (result, error) => listeners.get("message")?.({ source: parentWindow, data: { magpie: 1, id: message.id, result, error } }))
      const result = message.method === "hello" ? { lang: "zh", dark: true, tokens: { bg: "#121212" } } : message.method === "options.get" ? options : message.method === "options.set" ? message.params.options : [{ id: "alpha" }]
      listeners.get("message")?.({ source: parentWindow, data: { magpie: 1, id: message.id, result } })
    })
  } }
  const context = vm.createContext({
    document: { documentElement: root, getElementById: (id) => elements.get(id), createElement: () => ({ addEventListener() {} }), head: { append: (script) => scripts.push(script.src) } },
    magpie: bridgeMissing ? undefined : { ready: Promise.resolve(), theme: { lang: "zh" }, service, options: { get: async () => options } },
    navigator: { language: "zh" }, URL,
    location: { hostname: host, href: "https://" + host + "/prefix/_magpie/plugin/native-token/index.html", replace: (url) => redirects.push(url), reload() { reloaded = true } },
    setTimeout(callback) { pending.set(++timerId, callback); return timerId },
    clearTimeout(id) { pending.delete(id) },
    addEventListener(name, callback) { listeners.set(name, callback) },
  })
  context.parent = nativeParent ? parentWindow : context
  vm.runInContext(source, context)
  await new Promise((resolve) => setImmediate(resolve))
  return { redirects, scripts, elements, context, root, messages, parentWindow, pending, listeners, reloaded: () => reloaded }
}

test("Web bootstrap uses Magpie's same-host service proxy and keeps the old query for an already running service", async () => {
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

test("A standalone service page shows a reconnect action rather than JSON or a pending handshake", async () => {
  const view = await boot({ bridgeMissing: true, onService: true })
  assert.deepEqual(view.redirects, [])
  assert.deepEqual(view.scripts, [])
  assert.equal(view.elements.get("retryButton").hidden, false)
  assert.match(view.elements.get("status").textContent, /重新启用插件/)
})

test("The service page handshakes with Magpie and exposes only theme, declared reads and its own options", async () => {
  const view = await boot({ bridgeMissing: true, onService: true, nativeParent: true, options: { mode: "passthrough" } })
  assert.deepEqual(view.scripts, ["app.js"])
  assert.equal(view.messages[0].message.method, "hello")
  assert.equal(view.root.dataset.theme, "dark")
  assert.equal(view.root.style["--magpie-bg"], "#121212")
  assert.equal((await view.context.magpie.options.get()).mode, "passthrough")
  assert.equal((await view.context.magpie.read("providers:list"))[0].id, "alpha")
  assert.equal(view.messages.at(-1).message.params.name, "providers:list")
  assert.equal((await view.context.magpie.options.set({ mode: "passthrough" })).mode, "passthrough")
  let translated
  view.context.magpie.onTheme((theme) => { translated = theme.lang })
  view.listeners.get("message")({ source: view.parentWindow, data: { magpie: 1, event: "theme", data: { lang: "en", dark: false } } })
  assert.equal(translated, "en")
  assert.equal(view.root.lang, "en")
  assert.equal(view.pending.size, 0)
})

test("The page bridge ignores forged responses and propagates native permission errors", async () => {
  const view = await boot({ bridgeMissing: true, onService: true, nativeParent: true, onCall(message, reply) {
    if (message.method === "hello") reply({ lang: "en" })
    else reply(undefined, "Permission refused by Magpie")
  } })
  let changed = false
  view.context.magpie.onTheme(() => { changed = true })
  view.listeners.get("message")({ source: {}, data: { magpie: 1, event: "theme", data: { lang: "fake" } } })
  assert.equal(changed, false)
  await assert.rejects(view.context.magpie.read("models:list"), /Permission refused by Magpie/)
})

test("A host that never answers the service handshake times out with recovery instructions", async () => {
  const view = await boot({ bridgeMissing: true, onService: true, nativeParent: true, onCall() {} })
  assert.deepEqual(view.scripts, [])
  for (const callback of [...view.pending.values()]) callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(view.elements.get("retryButton").hidden, false)
  assert.match(view.elements.get("status").textContent, /Magpie 侧栏/)
})

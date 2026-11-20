import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const script = await readFile(new URL("../page/app.js", import.meta.url), "utf8")
const html = await readFile(new URL("../page/index.html", import.meta.url), "utf8")

class Element {
  constructor() {
    this.value = ""
    this.checked = false
    this.hidden = false
    this.disabled = false
    this.textContent = ""
    this.dataset = {}
    this.style = {}
    this.attributes = {}
    this.listeners = new Map()
    this.children = []
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback)
  }

  async emit(name) {
    await this.listeners.get(name)?.({ preventDefault() {} })
  }

  replaceChildren(...children) {
    this.children = children
  }

  setAttribute(name, value) { this.attributes[name] = value }
  removeAttribute(name) { delete this.attributes[name] }
  focus() { this.focused = true }
  insertAdjacentElement(position, element) { this.adjacent = element }
}

async function page({ options = { mode: "bust", log: true }, get, set, language = "zh", ready, providers = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }], read, models } = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]))
  const radios = ["bust", "disable-explicit", "passthrough"].map((value) => Object.assign(new Element(), { value }))
  const calls = []
  let saved = structuredClone(options)
  let onTheme
  const document = {
    documentElement: {},
    getElementById: (id) => elements.get(id),
    createElement: () => new Element(),
    querySelector(selector) {
      if (selector.endsWith(":checked")) return radios.find((radio) => radio.checked)
      const value = /value="([^"]+)"/.exec(selector)?.[1]
      const selected = radios.find((radio) => radio.value === value)
      if (selected) for (const radio of radios) radio.checked = radio === selected
      return selected
    },
  }
  const bridge = {
    ready: ready || Promise.resolve({ lang: language }),
    onTheme(callback) { onTheme = callback },
    read: read || (async (name) => { assert.equal(name, "providers:list"); return providers }),
    options: {
      get: get || (async () => structuredClone(saved)),
      set: async (next) => {
        calls.push(structuredClone(next))
        const result = set ? await set(next) : next
        saved = structuredClone(result)
        return saved
      },
    },
  }
  const modelCalls = []
  if (models) elements.get("modelService").content = "1"
  const context = vm.createContext({ document, navigator: { language }, magpie: bridge, console: { error() {} }, URL, location: { href: "http://127.0.0.1:3489/index.html?bridge=host" }, fetch: async (url, init) => {
    modelCalls.push({ url: String(url), init })
    return models(url, init)
  } })
  vm.runInContext(script, context)
  await new Promise((resolve) => setImmediate(resolve))
  return {
    elements, calls, radios, context, modelCalls,
    element: (id) => elements.get(id),
    theme: (value) => onTheme(value),
    async change(id, value) {
      const element = elements.get(id)
      if (typeof value === "boolean") element.checked = value
      else element.value = value
      await elements.get("settings").emit("change")
    },
    async mode(value) {
      for (const radio of radios) radio.checked = radio.value === value
      await elements.get("settings").emit("change")
    },
    save: () => elements.get("saveButton").emit("click"),
    async scope(id) {
      elements.get("providerScope").value = id
      await elements.get("providerScope").emit("change")
    },
  }
}

test("Native page is declared, bundled, and loads only local external scripts", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(manifest.magpie.page.file, "page/index.html")
  assert.equal(manifest.magpie.page.titles.zh, "缓存控制")
  assert.deepEqual(manifest.magpie.permissions, ["providers:list"])
  assert.ok(manifest.files.includes("page"))
  assert.equal(manifest.main, "./page-service.js")
  assert.deepEqual(manifest.magpie.page.service, { port: 3489, option: "pageServicePort" })
  assert.ok(manifest.files.includes("lib"))
  assert.ok(manifest.files.includes("page-service.js"))
  assert.match(html, /<script src="_magpie\/bridge.js"><\/script>/)
  assert.match(html, /<script src="start.js" defer><\/script>/)
  assert.doesNotMatch(html, /<script(?!\s+src=)|\son\w+=|<form\b|https?:\/\//)
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length)
  assert.match(html, /前 N 轮允许缓存，之后每次请求扰动/)
  assert.doesNotMatch(html, /同一分桶内|每 N 个用户轮次/)
})

test("Page loads saved options without writing on open", async () => {
  const view = await page({ options: { mode: "disable-explicit", log: false, cachedContent: "drop", openaiExplicitProviders: ["native"] } })
  assert.equal(view.radios.find((radio) => radio.checked).value, "disable-explicit")
  assert.equal(view.element("logEnabled").checked, false)
  assert.equal(view.element("cachedContent").value, "drop")
  assert.equal(view.element("dropNotice").hidden, false)
  assert.equal(view.element("providerIdsField").hidden, false)
  assert.equal(view.element("providerIds").value, "native")
  assert.equal(view.element("settings").disabled, false)
  assert.equal(view.element("saveButton").disabled, true)
  assert.equal(view.calls.length, 0)
})

test("Page defaults agree with the middleware defaults", async () => {
  const view = await page({ options: null })
  const example = JSON.parse(await readFile(new URL("../options.example.json", import.meta.url), "utf8"))
  assert.equal(view.radios.find((radio) => radio.checked).value, example.mode)
  assert.equal(view.element("logEnabled").checked, example.log)
  assert.equal(view.element("logEnabled").disabled, true)
  assert.equal(view.element("cachedContent").disabled, true)
  assert.equal(view.element("saveButton").disabled, true)
  assert.equal(view.calls.length, 0)
})

test("Save writes options and rotation, normalizes provider IDs and waits for host acknowledgement", async () => {
  let resolveSave
  const view = await page({ set: (options) => new Promise((resolve) => { resolveSave = () => resolve(options) }) })
  await view.mode("disable-explicit")
  await view.change("cachedContent", "drop")
  await view.change("logEnabled", false)
  await view.change("openaiExplicitEnabled", true)
  await view.change("providerIds", " native, second\nnative ")
  const saving = view.save()
  assert.equal(view.element("status").textContent, "正在保存…")
  assert.equal(view.element("settings").disabled, true)
  assert.equal(view.element("saveButton").disabled, true)
  await view.save()
  assert.equal(view.calls.length, 1)
  resolveSave()
  await saving
  assert.deepEqual(view.calls[0], { mode: "disable-explicit", log: false, cachedContent: "drop", openaiExplicitProviders: ["native", "second"], rotation: { strategy: "request", turns: 10, tokens: 8000, style: "marker" }, providers: {} })
  assert.equal(view.element("status").textContent, "已保存")
  assert.equal(view.element("settings").disabled, false)
  assert.equal(view.element("saveButton").disabled, true)
})

test("Blank provider IDs do not persist an enabled explicit override", async () => {
  const view = await page()
  await view.change("openaiExplicitEnabled", true)
  await view.change("providerIds", " , \n")
  await view.save()
  assert.equal(view.calls.length, 0)
  assert.equal(view.element("status").dataset.state, "invalidProvider")
  assert.equal(view.element("openaiExplicitEnabled").checked, true)
})

test("Disabling OpenAI explicit mode clears provider overrides on save", async () => {
  const view = await page({ options: { mode: "bust", openaiExplicitProviders: ["native"] } })
  await view.change("openaiExplicitEnabled", false)
  assert.equal(view.element("providerIdsField").hidden, true)
  await view.save()
  assert.deepEqual(view.calls[0].openaiExplicitProviders, [])
})

test("Passthrough disables inapplicable fields without losing existing preferences", async () => {
  const view = await page({ options: { mode: "bust", log: true, cachedContent: "drop", openaiExplicitProviders: ["native"] } })
  await view.mode("passthrough")
  for (const id of ["cachedContent", "openaiExplicitEnabled", "providerIds", "logEnabled"]) assert.equal(view.element(id).disabled, true)
  await view.save()
  assert.deepEqual(view.calls[0], { mode: "passthrough", log: true, cachedContent: "drop", openaiExplicitProviders: ["native"], rotation: { strategy: "request", turns: 10, tokens: 8000, style: "marker" }, providers: {} })
  await view.mode("bust")
  assert.equal(view.element("logEnabled").disabled, false)
  assert.equal(view.element("cachedContent").value, "drop")
})

test("Save failures preserve edits and allow retry", async () => {
  let fail = true
  const view = await page({ set: async (options) => {
    if (fail) throw new Error("host refused")
    return options
  } })
  await view.change("logEnabled", false)
  await view.save()
  assert.equal(view.element("status").dataset.state, "saveError")
  assert.equal(view.element("saveButton").disabled, false)
  assert.equal(view.element("logEnabled").checked, false)
  fail = false
  await view.save()
  assert.equal(view.element("status").dataset.state, "saved")
})

test("Read failures keep controls locked until a successful reload", async () => {
  let fail = true
  const view = await page({ get: async () => {
    if (fail) throw new Error("host refused")
    return { mode: "passthrough" }
  } })
  assert.equal(view.element("settings").disabled, true)
  assert.equal(view.element("retryButton").hidden, false)
  fail = false
  await view.element("retryButton").emit("click")
  assert.equal(view.element("settings").disabled, false)
  assert.equal(view.element("retryButton").hidden, true)
  assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
})

test("Language changes preserve unsaved values and translate status", async () => {
  const view = await page({ language: "en" })
  assert.equal(view.element("title").textContent, "Prompt cache control")
  assert.equal(view.element("saveButton").textContent, "Save settings")
  await view.change("cachedContent", "drop")
  view.theme({ lang: "zh-TW", dark: true })
  assert.equal(view.element("title").textContent, "提示词缓存控制")
  assert.equal(view.element("cachedContent").value, "drop")
  await view.save()
  view.theme({ lang: "en", dark: false })
  assert.equal(view.element("status").textContent, "Saved")
})

test("Initial cache allowance is editable, saved and loaded without enabling a paused OpenAI override", async () => {
  const view = await page({ options: { mode: "bust", openaiExplicitProviders: ["native"], rotation: { strategy: "turns", turns: 3 } } })
  assert.equal(view.element("rotationFields").hidden, false)
  assert.equal(view.element("rotationTurnsField").hidden, false)
  assert.equal(view.element("rotationTurns").value, 3)
  assert.equal(view.element("openaiExplicitEnabled").disabled, true)
  assert.equal(view.element("rotationNotice").hidden, false)
  assert.match(view.element("rotationNotice").textContent, /每次请求/)
  await view.change("rotationTurns", "5")
  await view.save()
  assert.deepEqual(view.calls[0].rotation, { strategy: "turns", turns: 5, tokens: 8000, style: "marker" })
  assert.deepEqual(view.calls[0].openaiExplicitProviders, ["native"])
  await view.change("rotationStrategy", "request")
  assert.equal(view.element("openaiExplicitEnabled").disabled, true)
  await view.mode("disable-explicit")
  assert.equal(view.element("openaiExplicitEnabled").disabled, false)
})

test("Token schedule validates whole positive thresholds and preserves edits on failure", async () => {
  const view = await page()
  await view.change("rotationStrategy", "tokens")
  assert.equal(view.element("rotationTokensField").hidden, false)
  assert.equal(view.element("rotationTurnsField").hidden, true)
  for (const value of ["", "0", "-1", "2.5", "1000000001"]) {
    await view.change("rotationTokens", value)
    await view.save()
    assert.equal(view.element("status").dataset.state, "invalidTokens")
    assert.equal(view.calls.length, 0)
  }
  await view.change("rotationTokens", "12000")
  await view.save()
  assert.deepEqual(view.calls[0].rotation, { strategy: "tokens", turns: 10, tokens: 12000, style: "marker" })
})

test("Off keeps scheduled preferences but can be saved even with an invalid threshold draft", async () => {
  const view = await page()
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "0")
  await view.mode("passthrough")
  await view.save()
  assert.equal(view.calls[0].mode, "passthrough")
  assert.equal(view.element("rotationFields").hidden, true)
  assert.equal(view.element("rotationStrategy").disabled, true)
  assert.deepEqual(view.calls[0].rotation, { strategy: "turns", turns: 10, tokens: 8000, style: "marker" })
})

test("Text style is saved and reloaded while native override stays paused in text mode", async () => {
  const view = await page({ options: { mode: "bust", openaiExplicitProviders: ["native"], rotation: { strategy: "turns", turns: 10, style: "whitespace" } } })
  assert.equal(view.element("rotationStyle").value, "whitespace")
  assert.equal(view.element("rotationStyle").disabled, false)
  assert.equal(view.element("openaiExplicitEnabled").disabled, true)
  await view.change("rotationStyle", "punctuation")
  await view.save()
  assert.deepEqual(view.calls[0].rotation, { strategy: "turns", turns: 10, tokens: 8000, style: "punctuation" })
  assert.deepEqual(view.calls[0].openaiExplicitProviders, ["native"])
  await view.mode("passthrough")
  assert.equal(view.element("rotationStyle").disabled, true)
})

test("Style validation blocks invalid values, while legacy options retain the full marker default", async () => {
  const view = await page()
  assert.equal(view.element("rotationStyle").value, "marker")
  await view.change("rotationStyle", "native")
  await view.save()
  assert.equal(view.element("status").dataset.state, "invalidStyle")
  assert.equal(view.calls.length, 0)
  await view.change("rotationStyle", "whitespace")
  await view.save()
  assert.equal(view.calls[0].rotation.style, "whitespace")
  assert.match(view.element("rotationStyleHint").textContent, /所有样式都进入模型上下文/)
})

test("Magpie provider names and ids are listed, with every fresh provider off and no writes on selection", async () => {
  const view = await page({ options: {} })
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), ["", "alpha", "beta"])
  assert.match(view.element("providerScope").children[1].textContent, /Alpha.*alpha/)
  for (const id of ["alpha", "beta", ""]) {
    await view.scope(id)
    assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
    assert.equal(view.element("rotationStyle").disabled, true)
  }
  assert.equal(view.calls.length, 0)
})

test("Disabled Magpie providers are hidden even with independent policies, which remain saved", async () => {
  const view = await page({ options: { providers: { closed: { mode: "bust" }, explicitOff: { mode: "passthrough" } } }, providers: [
    { id: "closed", name: "Closed", off: true },
    { id: "alpha", name: "Alpha", off: false },
    { id: "explicitOff", name: "Cache policy off" },
    { id: "disabled", disabled: true },
    { id: "notEnabled", enabled: false },
  ] })
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), ["", "alpha", "explicitOff"])
  assert.match(view.element("providerScope").children[2].textContent, /^\[已配置\]/)
  await view.scope("alpha")
  await view.mode("bust")
  await view.save()
  assert.equal(view.calls[0].providers.closed.mode, "bust")
  assert.equal(view.calls[0].providers.explicitOff.mode, "passthrough")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "closed"), false)
})

test("Provider labels distinguish configured policies from drafts through localization, save and removal", async () => {
  const view = await page({ options: { providers: { alpha: { mode: "passthrough" } } } })
  const label = (id) => view.element("providerScope").children.find((option) => option.value === id).textContent
  assert.match(label("alpha"), /^\[已配置\] Alpha · alpha$/)
  assert.equal(label("beta"), "Beta · beta")
  await view.scope("alpha")
  await view.mode("bust")
  assert.match(label("alpha"), /^\[已配置 · 未保存\]/)
  await view.scope("beta")
  await view.mode("bust")
  assert.match(label("beta"), /^\[未保存\]/)
  view.theme({ lang: "en" })
  assert.match(label("alpha"), /^\[Configured · Unsaved\]/)
  assert.match(label("beta"), /^\[Unsaved\]/)
  assert.equal(view.calls.length, 0)
  await view.save()
  assert.match(label("alpha"), /^\[Configured\]/)
  assert.match(label("beta"), /^\[Configured\]/)
  await view.element("providerReset").emit("click")
  assert.equal(label("beta"), "Beta · beta")
  assert.match(label("alpha"), /^\[Configured\]/)
  await view.save()
  assert.equal(Object.hasOwn(view.calls[1].providers, "beta"), false)
})

test("Refreshing a disabled selection returns to default without losing drafts or reintroducing the provider on errors", async () => {
  let closed = false
  let fail = false
  const view = await page({ options: { providers: { alpha: { mode: "bust" } } }, read: async () => {
    if (fail) throw new Error("Unavailable")
    return { providers: [{ id: "alpha", name: "Alpha", off: closed }, { id: "beta", name: "Beta" }] }
  } })
  await view.scope("alpha")
  await view.change("rotationStyle", "punctuation")
  closed = true
  await view.element("providerReload").emit("click")
  assert.equal(view.element("providerScope").value, "")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "alpha"), false)
  assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
  assert.equal(view.element("saveButton").disabled, false)
  fail = true
  await view.element("providerReload").emit("click")
  view.theme({ lang: "en" })
  assert.equal(view.element("providerScope").children.some((option) => option.value === "alpha"), false)
  fail = false
  closed = false
  await view.element("providerReload").emit("click")
  assert.match(view.element("providerScope").children.find((option) => option.value === "alpha").textContent, /^\[Configured · Unsaved\]/)
  await view.scope("alpha")
  assert.equal(view.element("rotationStyle").value, "punctuation")
  await view.save()
  assert.equal(view.calls[0].providers.alpha.rotation.style, "punctuation")
})

test("An invalid draft for a newly disabled provider stays intact and cannot focus an unrelated policy", async () => {
  let closed = false
  const view = await page({ options: {}, read: async () => [{ id: "alpha", off: closed }] })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "0")
  closed = true
  await view.element("providerReload").emit("click")
  await view.save()
  assert.equal(view.calls.length, 0)
  assert.equal(view.element("providerScope").value, "")
  assert.equal(view.element("status").dataset.state, "inactiveDraft")
  assert.equal(view.element("fieldError").hidden, true)
  closed = false
  await view.element("providerReload").emit("click")
  await view.scope("alpha")
  assert.equal(view.element("rotationTurns").value, "0")
  await view.change("rotationTurns", "10")
  await view.save()
  assert.equal(view.calls[0].providers.alpha.rotation.turns, 10)
})

test("Different provider drafts survive switching and are saved together without enabling the default", async () => {
  const view = await page({ options: {} })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "10")
  await view.change("rotationStyle", "punctuation")
  await view.scope("beta")
  assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
  await view.mode("bust")
  await view.change("rotationStrategy", "tokens")
  await view.change("rotationTokens", "16000")
  await view.change("rotationStyle", "whitespace")
  await view.scope("alpha")
  assert.equal(view.element("rotationTurns").value, "10")
  assert.equal(view.element("rotationStyle").value, "punctuation")
  await view.save()
  const saved = view.calls[0]
  assert.equal(saved.mode, "passthrough")
  assert.equal(saved.providers.alpha.mode, "bust")
  assert.deepEqual(saved.providers.alpha.rotation, { strategy: "turns", turns: 10, tokens: 8000, style: "punctuation" })
  assert.deepEqual(saved.providers.beta.rotation, { strategy: "tokens", turns: 10, tokens: 16000, style: "whitespace" })
  const reopened = await page({ options: saved })
  await reopened.scope("beta")
  assert.equal(reopened.element("rotationTokens").value, 16000)
  assert.equal(reopened.element("rotationStyle").value, "whitespace")
  await reopened.scope("")
  assert.equal(reopened.radios.find((radio) => radio.checked).value, "passthrough")
})

test("Removing a provider override only removes that provider and stages the change until save", async () => {
  const view = await page({ options: { providers: { alpha: { mode: "bust" }, beta: { mode: "passthrough" } } } })
  await view.scope("alpha")
  assert.equal(view.element("providerReset").disabled, false)
  await view.element("providerReset").emit("click")
  assert.equal(view.calls.length, 0)
  assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
  await view.save()
  assert.equal(Object.hasOwn(view.calls[0].providers, "alpha"), false)
  assert.equal(view.calls[0].providers.beta.mode, "passthrough")
})

test("Invalid drafts in another provider are surfaced without losing that provider or the current draft", async () => {
  const view = await page({ options: {} })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "0")
  await view.scope("beta")
  await view.mode("bust")
  await view.change("rotationStyle", "punctuation")
  await view.save()
  assert.equal(view.calls.length, 0)
  assert.equal(view.element("providerScope").value, "alpha")
  assert.equal(view.element("rotationTurns").value, "0")
  assert.equal(view.element("status").dataset.state, "invalidTurns")
  await view.change("rotationTurns", "5")
  await view.save()
  assert.equal(view.calls[0].providers.alpha.rotation.turns, 5)
  assert.equal(view.calls[0].providers.beta.rotation.style, "punctuation")
})

test("Provider list read failures retain configured ids and a refresh preserves unsaved drafts", async () => {
  let fail = true
  const view = await page({ options: { providers: { old: { mode: "bust" } } }, read: async () => {
    if (fail) throw new Error("read unavailable")
    return { providers: [{ id: "new", name: "New provider" }] }
  } })
  assert.equal(view.element("settings").disabled, false)
  assert.equal(view.element("providerListStatus").dataset.state, "providerListError")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "old"), true)
  await view.scope("old")
  await view.change("rotationStyle", "punctuation")
  fail = false
  await view.element("providerReload").emit("click")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "new"), true)
  assert.equal(view.element("rotationStyle").value, "punctuation")
  await view.save()
  assert.equal(view.calls[0].providers.old.rotation.style, "punctuation")
})

test("Saved defaults remain compatible and an explicit provider off overrides them", async () => {
  const view = await page({ options: { mode: "bust", providers: { beta: { mode: "passthrough" } } } })
  await view.scope("alpha")
  assert.equal(view.radios.find((radio) => radio.checked).value, "bust")
  await view.scope("beta")
  assert.equal(view.radios.find((radio) => radio.checked).value, "passthrough")
  assert.equal(view.calls.length, 0)
})

test("Literal special provider ids and display names do not become HTML or object prototypes", async () => {
  const view = await page({ options: {}, providers: [{ id: "__proto__", name: "<img src=x onerror=alert(1)>" }] })
  assert.match(view.element("providerScope").children[1].textContent, /<img/)
  await view.scope("__proto__")
  await view.mode("bust")
  await view.save()
  assert.equal(Object.hasOwn(view.calls[0].providers, "__proto__"), true)
  assert.equal(view.calls[0].providers.__proto__.mode, "bust")
})

test("Percentage can be saved and reloaded for a single supplier", async () => {
  const view = await page({ options: {} })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "percent")
  assert.equal(view.element("rotationPercentField").hidden, false)
  assert.equal(Number(view.element("rotationPercent").value), 5)
  await view.change("rotationPercent", "101")
  await view.save()
  assert.equal(view.element("status").dataset.state, "invalidPercent")
  assert.equal(view.calls.length, 0)
  await view.change("rotationPercent", "5.5")
  await view.save()
  const saved = view.calls[0]
  assert.equal(saved.mode, "passthrough")
  assert.equal(saved.providers.alpha.rotation.percent, 5.5)
  const reopened = await page({ options: saved })
  await reopened.scope("alpha")
  assert.equal(reopened.element("rotationStrategy").value, "percent")
  assert.equal(Number(reopened.element("rotationPercent").value), 5.5)
})

test("Switching language preserves the selected provider and its unsaved threshold", async () => {
  const view = await page({ options: {} })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "6")
  view.theme({ lang: "en" })
  assert.equal(view.element("providerScope").value, "alpha")
  assert.match(view.element("providerScope").children[0].textContent, /Default policy/)
  assert.equal(view.element("rotationTurns").value, "6")
  await view.save()
  assert.equal(view.calls[0].providers.alpha.rotation.turns, 6)
})

test("Policy preview updates on typing and distinguishes estimated prefix from actual hits", async () => {
  const view = await page({ options: {} })
  assert.equal(view.element("policyPreview").hidden, true)
  await view.mode("bust")
  await view.change("rotationStrategy", "percent")
  view.element("rotationPercent").value = "5.5"
  await view.element("settings").emit("input")
  assert.match(view.element("previewSummary").textContent, /5.5%/)
  assert.equal(view.element("prefixSegment").style.width, "5.5%")
  assert.match(view.element("tailLegend").textContent, /94.5%/)
  assert.match(view.element("previewHint").textContent, /不是实际缓存命中率/)
  assert.equal(view.element("status").dataset.state, "unsaved")
  assert.equal(view.element("saveScopeHint").hidden, false)
  view.theme({ lang: "en" })
  assert.match(view.element("previewSummary").textContent, /5.5%/)
  assert.match(view.element("previewHint").textContent, /not the actual cache hit rate/)
  await view.change("rotationPercent", "100")
  assert.match(view.element("previewSummary").textContent, /unchanged/)
  await view.change("rotationPercent", "0")
  assert.match(view.element("previewSummary").textContent, /first editable/)
  await view.change("rotationPercent", "101")
  assert.equal(view.element("percentPreview").hidden, true)
  assert.equal(view.calls.length, 0)
})

test("Allowance preview keeps the fixed N+1 boundary and follows provider drafts", async () => {
  const view = await page({ options: {} })
  await view.scope("alpha")
  assert.equal(view.element("scopeState").textContent, "继承默认")
  assert.equal(view.element("providerReset").hidden, true)
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "10")
  assert.match(view.element("previewSummary").textContent, /前 10.*第 11 轮/)
  assert.equal(view.element("scopeState").textContent, "独立策略")
  await view.scope("beta")
  assert.equal(view.element("policyPreview").hidden, true)
  await view.scope("alpha")
  assert.match(view.element("previewSummary").textContent, /第 11 轮/)
  assert.equal(view.calls.length, 0)
})

test("Invalid advanced fields expand and focus the field; editing clears accessible errors", async () => {
  const view = await page({ options: {} })
  await view.mode("disable-explicit")
  await view.change("openaiExplicitEnabled", true)
  await view.change("providerIds", "bad id!")
  await view.save()
  assert.equal(view.element("advancedSettings").open, true)
  assert.equal(view.element("providerIds").focused, true)
  assert.equal(view.element("providerIds").attributes["aria-invalid"], "true")
  assert.equal(view.element("fieldError").hidden, false)
  assert.equal(view.element("providerIds").adjacent, view.element("fieldError"))
  assert.equal(view.calls.length, 0)
  await view.change("providerIds", "native")
  assert.equal(view.element("fieldError").hidden, true)
  assert.equal(view.element("providerIds").attributes["aria-invalid"], undefined)
  await view.save()
  assert.equal(view.element("saveScopeHint").hidden, true)
  assert.equal(view.element("saveButton").dataset.busy, "false")
})

test("Real id/name-only provider data is filtered by model ownership without losing hidden policies", async () => {
  const view = await page({ options: { pageServicePort: 3490, providers: { kiro: { mode: "bust" }, alpha: { mode: "passthrough" } } }, providers: [
    { id: "alpha", name: "Alpha" }, { id: "kiro", name: "Kiro" },
  ], models: async () => ({ ok: true, json: async () => ({ providerIds: ["alpha", "routing-owner"], modelCount: 2 }) }) })
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), ["", "alpha"])
  assert.match(view.element("providerScope").children[1].textContent, /^\[已配置\]/)
  assert.equal(view.element("modelListStatus").dataset.state, "modelListActive")
  assert.match(view.modelCalls[0].url, /^http:\/\/127\.0\.0\.1:3489\/api\/model-providers$/)
  assert.equal(view.modelCalls[0].init.headers["X-Magpie-Cache-Control"], "models")
  assert.equal(view.modelCalls[0].init.credentials, "omit")
  assert.equal(view.calls.length, 0)
  await view.scope("alpha")
  await view.mode("bust")
  await view.save()
  assert.equal(view.calls[0].providers.kiro.mode, "bust")
  assert.equal(view.calls[0].pageServicePort, 3490)
})

test("Model list failure preserves the last successful range and restores a hidden draft when models return", async () => {
  let ids = ["alpha", "beta"]
  let fail = false
  const view = await page({ options: {}, models: async () => {
    if (fail) throw new Error("Service unavailable")
    return { ok: true, json: async () => ({ providerIds: ids }) }
  } })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStyle", "punctuation")
  ids = ["beta"]
  await view.element("providerReload").emit("click")
  assert.equal(view.element("providerScope").value, "")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "alpha"), false)
  fail = true
  await view.element("providerReload").emit("click")
  assert.equal(view.element("modelListStatus").dataset.state, "modelListStale")
  assert.equal(view.element("providerScope").children.some((option) => option.value === "alpha"), false)
  view.theme({ lang: "en" })
  assert.match(view.element("modelListStatus").textContent, /last successful/)
  fail = false
  ids = ["alpha", "beta"]
  await view.element("providerReload").emit("click")
  await view.scope("alpha")
  assert.equal(view.element("rotationStyle").value, "punctuation")
  assert.equal(view.calls.length, 0)
})

test("Explicitly disabled providers stay hidden even if a model still names them as its owner", async () => {
  const view = await page({ options: {}, providers: [{ id: "alpha", off: true }, { id: "beta" }], models: async () => ({ ok: true, json: async () => ({ providerIds: ["alpha", "beta"] }) }) })
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), ["", "beta"])
  assert.equal(view.calls.length, 0)
})

test("A confirmed empty model list hides providers, while a failed or malformed list preserves them", async () => {
  let response = { ok: false }
  const view = await page({ options: {}, models: async () => response })
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), ["", "alpha", "beta"])
  assert.equal(view.element("modelListStatus").dataset.state, "modelListError")
  response = { ok: true, json: async () => ({ providerIds: [null] }) }
  await view.element("providerReload").emit("click")
  assert.equal(view.element("modelListStatus").dataset.state, "modelListError")
  assert.equal(view.element("providerScope").children.length, 3)
  response = { ok: true, json: async () => ({ providerIds: [] }) }
  await view.element("providerReload").emit("click")
  assert.deepEqual(view.element("providerScope").children.map((option) => option.value), [""])
  assert.equal(view.element("modelListStatus").dataset.state, "modelListEmpty")
  assert.equal(view.calls.length, 0)
})

test("Invalid drafts hidden by the model filter do not focus another provider or get silently discarded", async () => {
  let ids = ["alpha", "beta"]
  const view = await page({ options: {}, models: async () => ({ ok: true, json: async () => ({ providerIds: ids }) }) })
  await view.scope("alpha")
  await view.mode("bust")
  await view.change("rotationStrategy", "turns")
  await view.change("rotationTurns", "0")
  ids = ["beta"]
  await view.element("providerReload").emit("click")
  await view.save()
  assert.equal(view.element("status").dataset.state, "modelDraftUnavailable")
  assert.equal(view.element("providerScope").value, "")
  assert.equal(view.calls.length, 0)
  ids = ["alpha", "beta"]
  await view.element("providerReload").emit("click")
  await view.scope("alpha")
  assert.equal(view.element("rotationTurns").value, "0")
  await view.change("rotationTurns", "10")
  await view.save()
  assert.equal(view.calls[0].providers.alpha.rotation.turns, 10)
})

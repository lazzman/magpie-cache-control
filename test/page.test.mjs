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
}

async function page({ options = { mode: "bust", log: true }, get, set, language = "zh", ready, providers = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }], read } = {}) {
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
  const context = vm.createContext({ document, navigator: { language }, magpie: bridge, console: { error() {} } })
  vm.runInContext(script, context)
  await new Promise((resolve) => setImmediate(resolve))
  return {
    elements, calls, radios, context,
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
  assert.equal(manifest.main, undefined)
  assert.match(html, /<script src="_magpie\/bridge.js"><\/script>/)
  assert.match(html, /<script src="app.js" defer><\/script>/)
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

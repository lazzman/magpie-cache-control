const DEFAULTS = { mode: "passthrough", log: false, cachedContent: "reject", openaiExplicitProviders: [], rotation: { strategy: "request", turns: 10, tokens: 8000, style: "marker" } }

const LABELS = {
  zh: {
    providerScopeLabel: "配置范围", scopeDefault: "默认策略（未单独配置的供应商）", scopeInherited: "此供应商尚无单独配置，当前继承默认策略。编辑并保存后将使用独立策略。", scopeIndependent: "此供应商使用独立策略；其他供应商不受此处修改影响。", scopeDefaultNotice: "默认关闭；未单独配置的供应商使用这里的默认策略。已有手动保存的默认策略会保留。", providerReload: "刷新供应商列表", providerReset: "移除单独配置", providerListLoading: "正在读取 Magpie 供应商…", providerListError: "无法读取供应商列表，可重试；默认策略和已有供应商配置仍可编辑。", unsaved: "有未保存修改",
    providerStageHint: "单独策略在路由后执行。Magpie 在此阶段不能拒绝请求；无法安全应用时将原样发送并记录 provider-skipped 警告，请在日志中确认策略是否实际应用。",
    eyebrow: "网关策略", title: "提示词缓存控制", modeTitle: "请求策略", modeIntro: "选择如何处理各供应商请求中的提示词缓存。",
    bustTitle: "按策略扰动缓存", bustDescription: "立即逐请求扰动，或先允许前 N 轮 / 估算 Token 缓存，超过后逐请求扰动后续消息。",
    rotationStrategyLabel: "开始逐请求扰动的时机", rotationRequestOption: "立即：每次请求", rotationTurnsOption: "前 N 轮允许缓存，之后每次请求扰动", rotationTokensOption: "前 N 估算 Token 允许缓存，超过后每次请求扰动",
    rotationTurnsLabel: "允许缓存的前多少个用户轮次", rotationTokensLabel: "允许缓存的估算历史 Token 上限",
    rotationNotice: "阈值内原样保留；超过后，每次请求都在固定的后续消息起点加入新标记，早期缓存前缀不变。不是每 N 轮循环一次。需要完整历史；显式缓存与原缓存键保留，OpenAI explicit-only 专项暂停。",
    rotationTokenHint: "Token 是估算值，并按首次越过阈值的整个用户轮处理；该轮中阈值前的部分文本也可能不再命中缓存。",
    rotationStyleLabel: "文本扰动形式", rotationMarkerOption: "完整随机标记（默认，模型可见）", rotationPunctuationOption: "随机标点串（模型可见）", rotationWhitespaceOption: "空格 / Tab（实验，可能被清理）",
    rotationStyleHint: "所有样式都进入模型上下文，不保证无语义影响或零命中。空白不保证节省 Token；需要现有非空、未签名的首个文本块，否则报错而不创建纯空白块。文本扰动模式不会额外开启 OpenAI 专有关闭参数。", invalidStyle: "请选择有效的文本扰动形式",
    invalidRotation: "请选择有效的轮换节奏", invalidTurns: "用户轮数必须为 1 到 1000000 的整数", invalidTokens: "估算 Token 阈值必须为 1 到 1000000000 的整数",
    disableTitle: "只关闭显式缓存", disableDescription: "移除请求中的缓存标记，不改系统提示词；不影响自动缓存。",
    passTitle: "关闭（默认）", passDescription: "原样转发，不修改请求、不采集缓存统计，也不输出诊断日志。",
    protocolsTitle: "协议适配范围", protocolsNative: "Magpie 当前协议：Anthropic Messages、Chat Completions、Responses、Gemini；DeepSeek、Qwen、OpenRouter 等兼容接口使用 Chat 适配。",
    protocolsExtended: "扩展格式：Bedrock Converse、Cohere v2、Ollama Chat / Generate、Vertex Gemini。需要宿主能够传入对应原生协议；此插件不会创建新网关路由。",
    geminiTitle: "Gemini 缓存引用", geminiIntro: "引用可能代替整段上下文，网关无法自动取回其内容。",
    cachedContentLabel: "遇到缓存引用时", rejectOption: "拒绝请求并保留上下文", dropOption: "确认上下文已展开后删除引用",
    dropNotice: "删除引用不会恢复其中的上下文。请确认请求已经包含完整对话、提示词和工具定义。",
    openaiTitle: "OpenAI Responses 专项", openaiIntro: "仅用于“只关闭显式缓存”模式且供应商已确认支持；文本扰动模式会暂停此专项。旧模型和兼容接口可能不支持。",
    openaiToggle: "为指定供应商使用 explicit 缓存模式", providerIdsLabel: "Magpie 供应商 ID",
    providerIdsHint: "填写精确的 provider.id，用逗号或换行分隔。仅对 Responses 请求生效。",
    diagnosticsTitle: "诊断", diagnosticsIntro: "日志仅记录采取的措施和可观察到的缓存 token 数；缺少统计不等于零命中。",
    logToggle: "在 Magpie 日志中记录措施和可用的缓存统计",
    footerCopy: "随机标记不能保证零缓存命中，也可能增加费用和延迟。保存后从下一次请求生效。",
    saveButton: "保存设置", retryButton: "重新读取设置", loading: "正在读取设置…", saving: "正在保存…", saved: "已保存",
    loadError: "读取设置失败，请重试", saveError: "保存失败，请重试", invalidMode: "请选择有效的缓存模式",
    invalidCachedContent: "请选择有效的 Gemini 缓存策略", invalidProvider: "供应商 ID 必须是逗号或换行分隔的名称",
  },
  en: {
    providerScopeLabel: "Policy scope", scopeDefault: "Default policy (unconfigured providers)", scopeInherited: "No separate policy yet. This provider inherits the default; editing and saving creates an independent policy.", scopeIndependent: "This provider has an independent policy. Changes here do not affect other providers.", scopeDefaultNotice: "Off by default. Unconfigured providers use this policy. Previously saved default settings are preserved.", providerReload: "Refresh providers", providerReset: "Remove separate policy", providerListLoading: "Loading Magpie providers…", providerListError: "Could not load providers; retry. Default and existing provider policies can still be edited.", unsaved: "Unsaved changes",
    providerStageHint: "Separate policies run after routing, when Magpie cannot reject the request. If a policy cannot be safely applied, the request is forwarded unchanged and a provider-skipped warning is logged. Check logs to confirm application.",
    eyebrow: "Gateway policy", title: "Prompt cache control", modeTitle: "Request policy", modeIntro: "Choose how prompt caching is handled across provider requests.",
    bustTitle: "Perturb cache by policy", bustDescription: "Perturb every request immediately, or allow the first N turns / estimated tokens to cache and perturb the later history on every subsequent request.",
    rotationStrategyLabel: "When to start per-request perturbation", rotationRequestOption: "Immediately: every request", rotationTurnsOption: "Cache the first N turns; then perturb every request", rotationTokensOption: "Cache up to N estimated tokens; then perturb every request",
    rotationTurnsLabel: "Initial user turns allowed to cache", rotationTokensLabel: "Initial estimated history-token allowance",
    rotationNotice: "Within the allowance requests remain unchanged. Beyond it, every request gets a fresh marker at the same later-history boundary, preserving the early prefix. This does not repeat every N turns. Full history is required. Existing cache controls and cache keys are preserved; the OpenAI explicit-only override is paused.",
    rotationTokenHint: "Token counts are estimates. Perturbation starts at the user turn that first crosses the limit, so some earlier text in that turn may also stop hitting cache.",
    rotationStyleLabel: "Text perturbation style", rotationMarkerOption: "Full random marker (default, model-visible)", rotationPunctuationOption: "Random punctuation (model-visible)", rotationWhitespaceOption: "Spaces / tabs (experimental, may be stripped)",
    rotationStyleHint: "All styles enter model context; no promise of unchanged meaning or zero hits. Whitespace may not save tokens and needs an existing nonempty unsigned first text block; otherwise the request is rejected rather than creating a whitespace-only block. Text mode does not activate the OpenAI-specific override.", invalidStyle: "Choose a valid text perturbation style",
    invalidRotation: "Choose a valid rotation schedule", invalidTurns: "User turns must be an integer from 1 to 1000000", invalidTokens: "Estimated tokens must be an integer from 1 to 1000000000",
    disableTitle: "Disable explicit caching only", disableDescription: "Remove cache markers without changing the system prompt. Automatic caching is unaffected.",
    passTitle: "Off (default)", passDescription: "Pass requests through without changes, cache statistics or diagnostic logs.",
    protocolsTitle: "Protocol coverage", protocolsNative: "Current Magpie protocols: Anthropic Messages, Chat Completions, Responses and Gemini. Compatible DeepSeek, Qwen and OpenRouter endpoints use the Chat adapter.",
    protocolsExtended: "Additional formats: Bedrock Converse, Cohere v2, Ollama Chat / Generate and Vertex Gemini. The host must supply the native protocol; this plugin does not create gateway routes.",
    geminiTitle: "Gemini cache references", geminiIntro: "A reference may replace the entire context; the gateway cannot retrieve it.",
    cachedContentLabel: "When a cache reference is found", rejectOption: "Reject request and preserve context", dropOption: "Drop the reference when context is expanded",
    dropNotice: "Dropping a reference cannot restore its context. Confirm that the request already includes its full history, prompts and tool definitions.",
    openaiTitle: "OpenAI Responses only", openaiIntro: "Only used in Disable explicit caching mode with confirmed compatible providers; paused in text mode. Older models and compatible APIs may not support it.",
    openaiToggle: "Use explicit cache mode for selected providers", providerIdsLabel: "Magpie provider IDs",
    providerIdsHint: "Enter exact provider.id values separated by commas or new lines. Only Responses requests are affected.",
    diagnosticsTitle: "Diagnostics", diagnosticsIntro: "Logs report applied measures and observable cache tokens. Missing usage does not mean zero hits.",
    logToggle: "Log measures and available cache statistics in Magpie",
    footerCopy: "A nonce cannot guarantee zero cache hits and may increase cost or latency. Changes apply to the next request.",
    saveButton: "Save settings", retryButton: "Reload settings", loading: "Loading settings…", saving: "Saving…", saved: "Saved",
    loadError: "Could not load settings; try again", saveError: "Could not save; try again", invalidMode: "Choose a valid cache mode",
    invalidCachedContent: "Choose a valid Gemini cache policy", invalidProvider: "Enter provider IDs separated by commas or new lines",
  },
}

const $ = (id) => document.getElementById(id)
const settings = $("settings")
const status = $("status")
const saveButton = $("saveButton")
const retryButton = $("retryButton")
const cachedContent = $("cachedContent")
const openaiEnabled = $("openaiExplicitEnabled")
const providerField = $("providerIdsField")
const providerIds = $("providerIds")
const logEnabled = $("logEnabled")
const rotationStrategy = $("rotationStrategy")
const rotationTurns = $("rotationTurns")
const rotationTokens = $("rotationTokens")
const rotationStyle = $("rotationStyle")
const providerScope = $("providerScope")
const providerReload = $("providerReload")
const providerReset = $("providerReset")
let activeScope = ""
let providerRows = []
let defaultPolicy = normalize({})
let providerPolicies = Object.create(null)
let drafts = Object.create(null)
let language = "zh"
let saving = false
let dirty = false

function translate(theme) {
  const locale = String(theme?.lang || navigator.language || "zh").toLowerCase()
  language = locale.startsWith("zh") ? "zh" : "en"
  for (const [id, value] of Object.entries(LABELS[language])) {
    const element = $(id)
    if (element) element.textContent = value
  }
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en"
  document.title = LABELS[language].title
  renderProviderChoices()
  const listStatus = $("providerListStatus")
  if (listStatus.dataset.state) listStatus.textContent = LABELS[language][listStatus.dataset.state] || ""
  showStatus(status.dataset.state || "")
}

function showStatus(state = "") {
  status.dataset.state = state
  status.textContent = state ? LABELS[language][state] || "" : ""
}

function normalize(options) {
  const value = options && typeof options === "object" && !Array.isArray(options) ? options : {}
  return {
    ...DEFAULTS,
    mode: value.mode ?? DEFAULTS.mode,
    log: value.log ?? DEFAULTS.log,
    cachedContent: value.cachedContent ?? DEFAULTS.cachedContent,
    rotation: { ...DEFAULTS.rotation, ...(value.rotation && typeof value.rotation === "object" && !Array.isArray(value.rotation) ? value.rotation : {}) },
    openaiExplicitProviders: Array.isArray(value.openaiExplicitProviders)
      ? value.openaiExplicitProviders.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean)
      : [],
  }
}

function render(options) {
  const current = normalize(options)
  const mode = ["bust", "disable-explicit"].includes(current.mode) ? current.mode : "passthrough"
  document.querySelector('input[name="mode"][value="' + mode + '"]').checked = true
  cachedContent.value = current.cachedContent === "drop" ? "drop" : "reject"
  providerIds.value = current.openaiExplicitProviders.join(", ")
  openaiEnabled.checked = current.openaiExplicitProviders.length > 0
  logEnabled.checked = current.log === true
  rotationStrategy.value = ["turns", "tokens"].includes(current.rotation.strategy) ? current.rotation.strategy : "request"
  rotationTurns.value = current.rotation.turns
  rotationTokens.value = current.rotation.tokens
  rotationStyle.value = ["marker", "punctuation", "whitespace"].includes(current.rotation.style) ? current.rotation.style : "marker"
  saveButton.disabled = !dirty
  updateControls()
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function renderProviderChoices() {
  const names = new Map(providerRows.map((provider) => [provider.id, provider.name]))
  const ids = new Set([...names.keys(), ...Object.keys(providerPolicies), ...Object.keys(drafts), activeScope])
  const first = document.createElement("option")
  first.value = ""
  first.textContent = LABELS[language].scopeDefault
  const choices = [first]
  for (const id of ids) {
    if (!id) continue
    const option = document.createElement("option")
    option.value = id
    const name = names.get(id)
    option.textContent = name && name !== id ? name + " · " + id : id
    choices.push(option)
  }
  providerScope.replaceChildren(...choices)
  providerScope.value = activeScope
  $("scopeNotice").textContent = !activeScope ? LABELS[language].scopeDefaultNotice : owns(providerPolicies, activeScope) || owns(drafts, activeScope) ? LABELS[language].scopeIndependent : LABELS[language].scopeInherited
  providerReset.disabled = saving || settings.disabled || !activeScope || (!owns(providerPolicies, activeScope) && !owns(drafts, activeScope))
  $("providerStageHint").hidden = !activeScope && Object.keys(providerPolicies).length === 0 && !Object.keys(drafts).some((scope) => scope)
}

function captureForm() {
  return {
    mode: document.querySelector('input[name="mode"]:checked')?.value,
    cachedContent: cachedContent.value, providerIds: providerIds.value, openaiEnabled: openaiEnabled.checked,
    log: logEnabled.checked, strategy: rotationStrategy.value, turns: rotationTurns.value,
    tokens: rotationTokens.value, style: rotationStyle.value,
  }
}

function restoreDraft(draft) {
  const mode = ["bust", "disable-explicit"].includes(draft.mode) ? draft.mode : "passthrough"
  document.querySelector('input[name="mode"][value="' + mode + '"]').checked = true
  cachedContent.value = draft.cachedContent
  providerIds.value = draft.providerIds
  openaiEnabled.checked = draft.openaiEnabled
  logEnabled.checked = draft.log
  rotationStrategy.value = draft.strategy
  rotationTurns.value = draft.turns
  rotationTokens.value = draft.tokens
  rotationStyle.value = draft.style
  saveButton.disabled = !dirty
  updateControls()
}

function showCurrentScope() {
  if (owns(drafts, activeScope)) restoreDraft(drafts[activeScope])
  else if (activeScope && !owns(providerPolicies, activeScope) && owns(drafts, "")) restoreDraft(drafts[""])
  else render(activeScope && owns(providerPolicies, activeScope) ? providerPolicies[activeScope] : defaultPolicy)
  renderProviderChoices()
}

function applyDocument(options) {
  defaultPolicy = normalize(options)
  providerPolicies = Object.create(null)
  if (options?.providers && typeof options.providers === "object" && !Array.isArray(options.providers)) {
    for (const [id, policy] of Object.entries(options.providers)) {
      if (policy && typeof policy === "object" && !Array.isArray(policy)) providerPolicies[id] = normalize(policy)
    }
  }
  drafts = Object.create(null)
  dirty = false
  showCurrentScope()
}

function updateControls() {
  providerField.hidden = !openaiEnabled.checked
  $("dropNotice").hidden = cachedContent.value !== "drop"
  const passthrough = document.querySelector('input[name="mode"]:checked')?.value === "passthrough"
  const bust = document.querySelector('input[name="mode"]:checked')?.value === "bust"
  const scheduled = bust && rotationStrategy.value !== "request"
  $("rotationFields").hidden = !bust
  $("rotationTurnsField").hidden = rotationStrategy.value !== "turns"
  $("rotationTokensField").hidden = rotationStrategy.value !== "tokens"
  $("rotationNotice").hidden = !scheduled
  $("rotationTokenHint").hidden = !bust || rotationStrategy.value !== "tokens"
  for (const control of [cachedContent, logEnabled]) control.disabled = passthrough
  for (const control of [openaiEnabled, providerIds]) control.disabled = passthrough || bust
  rotationStrategy.disabled = !bust
  rotationTurns.disabled = !bust || rotationStrategy.value !== "turns"
  rotationTokens.disabled = !bust || rotationStrategy.value !== "tokens"
  rotationStyle.disabled = !bust
}

function collect(draft = captureForm()) {
  const mode = draft.mode
  if (!["bust", "disable-explicit", "passthrough"].includes(mode)) throw new Error("invalidMode")
  if (!["reject", "drop"].includes(draft.cachedContent)) throw new Error("invalidCachedContent")
  const strategy = draft.strategy
  if (!["request", "turns", "tokens"].includes(strategy)) throw new Error("invalidRotation")
  const style = draft.style
  if (!["marker", "punctuation", "whitespace"].includes(style)) throw new Error("invalidStyle")
  const validTurns = Number.isSafeInteger(Number(draft.turns)) && Number(draft.turns) >= 1 && Number(draft.turns) <= 1000000
  const validTokens = Number.isSafeInteger(Number(draft.tokens)) && Number(draft.tokens) >= 1 && Number(draft.tokens) <= 1000000000
  if (mode === "bust" && strategy === "turns" && !validTurns) throw new Error("invalidTurns")
  if (mode === "bust" && strategy === "tokens" && !validTokens) throw new Error("invalidTokens")
  const ids = draft.openaiEnabled ? [...new Set(draft.providerIds.split(/[\s,]+/).filter(Boolean))] : []
  if (draft.openaiEnabled && (!ids.length || ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(id)))) throw new Error("invalidProvider")
  return {
    mode, log: draft.log, cachedContent: draft.cachedContent, openaiExplicitProviders: ids,
    rotation: { strategy, turns: validTurns ? Number(draft.turns) : 10, tokens: validTokens ? Number(draft.tokens) : 8000, style },
  }
}

function collectDocument() {
  let root = defaultPolicy
  const providers = Object.assign(Object.create(null), providerPolicies)
  for (const [scope, draft] of Object.entries(drafts)) {
    let policy
    try { policy = collect(draft) } catch (error) { error.scope = scope; throw error }
    if (scope) providers[scope] = policy
    else root = policy
  }
  return { ...root, providers: Object.fromEntries(Object.entries(providers)) }
}

function changed() {
  if (saving) return
  dirty = true
  drafts[activeScope] = captureForm()
  saveButton.disabled = false
  renderProviderChoices()
  if (status.dataset.state === "saved") showStatus("")
}

async function loadSettings() {
  settings.disabled = true
  providerScope.disabled = true
  providerReset.disabled = true
  retryButton.hidden = true
  showStatus("loading")
  try {
    applyDocument(await magpie.options.get())
    settings.disabled = false
    providerScope.disabled = false
    renderProviderChoices()
    showStatus("")
  } catch (error) {
    console.error("cache-control: settings load failed", error)
    showStatus("loadError")
    retryButton.hidden = false
  }
}

async function saveSettings() {
  if (saving || !dirty) return
  let options
  try {
    options = collectDocument()
  } catch (error) {
    if (typeof error.scope === "string") {
      activeScope = error.scope
      showCurrentScope()
    }
    showStatus(LABELS[language][error.message] ? error.message : "saveError")
    return
  }
  saving = true
  settings.disabled = true
  providerScope.disabled = true
  providerReset.disabled = true
  saveButton.disabled = true
  showStatus("saving")
  try {
    applyDocument(await magpie.options.set(options))
    showStatus("saved")
  } catch (error) {
    console.error("cache-control: settings save failed", error)
    showStatus("saveError")
  } finally {
    saving = false
    settings.disabled = false
    providerScope.disabled = false
    saveButton.disabled = !dirty
    renderProviderChoices()
  }
}

async function loadProviders() {
  providerReload.disabled = true
  $("providerListStatus").dataset.state = "providerListLoading"
  $("providerListStatus").textContent = LABELS[language].providerListLoading
  try {
    const result = await magpie.read("providers:list")
    const rows = Array.isArray(result) ? result : result?.providers
    if (!Array.isArray(rows)) throw new Error("Unexpected provider list")
    providerRows = rows.filter((provider) => provider && typeof provider.id === "string" && provider.id.trim()).map((provider) => ({ id: provider.id, name: typeof provider.name === "string" ? provider.name : provider.id }))
    $("providerListStatus").dataset.state = ""
    $("providerListStatus").textContent = ""
    renderProviderChoices()
  } catch (error) {
    console.error("cache-control: provider list failed", error)
    $("providerListStatus").dataset.state = "providerListError"
    $("providerListStatus").textContent = LABELS[language].providerListError
  } finally {
    providerReload.disabled = false
  }
}

providerScope.addEventListener("change", () => {
  if (saving || settings.disabled) { providerScope.value = activeScope; return }
  activeScope = providerScope.value
  showCurrentScope()
  showStatus(dirty ? "unsaved" : "")
})
providerReset.addEventListener("click", () => {
  if (saving || settings.disabled || !activeScope) return
  delete providerPolicies[activeScope]
  delete drafts[activeScope]
  dirty = true
  showCurrentScope()
  showStatus("unsaved")
})
providerReload.addEventListener("click", loadProviders)
settings.addEventListener("input", changed)
settings.addEventListener("change", () => { updateControls(); changed() })
saveButton.addEventListener("click", saveSettings)
retryButton.addEventListener("click", loadSettings)

async function initialize() {
  showStatus("loading")
  try {
    const theme = await magpie.ready
    translate(theme)
    magpie.onTheme(translate)
    await loadSettings()
    await loadProviders()
  } catch (error) {
    console.error("cache-control: page initialization failed", error)
    showStatus("loadError")
    retryButton.hidden = false
  }
}

initialize()

const DEFAULTS = { mode: "passthrough", log: false, cachedContent: "reject", openaiExplicitProviders: [], rotation: { strategy: "request", turns: 10, tokens: 8000, style: "marker" } }

const LABELS = {
  zh: {
    modelListLoading: "正在读取可选模型…", modelListActive: "仅显示当前有可选模型的供应商；隐藏条目的独立策略仍会保留。", modelListEmpty: "当前没有可选模型。默认策略和已保存的供应商策略保持不变。", modelListError: "暂时无法读取可选模型，已保留供应商列表。请刷新重试。", modelListStale: "模型列表刷新失败，当前沿用上次成功读取的范围。请刷新重试。", modelDraftUnavailable: "当前没有可选模型的供应商有无效草稿。请先在 Magpie 恢复其可选模型，再修正并保存。",
    providerConfigured: "已配置", providerDraft: "未保存", inactiveDraft: "已关闭的供应商有无效草稿，请先在 Magpie 启用该供应商后修正，再保存。",
    pageIntro: "按供应商选择缓存策略，保留你需要的输入前缀。", scopeRoot: "默认策略", scopeOwn: "独立策略", scopeParent: "继承默认", rotationHelpTitle: "扰动形式的限制", styleVisibility: "扰动文本会进入模型上下文，可能影响模型理解。",
    advancedTitle: "协议专项设置", advancedHint: "Gemini 缓存引用与 Responses 显式模式", previewTitle: "策略预览",
    previewRequest: "每次请求都使用新的文本扰动。", previewTurns: "前 {value} 个用户轮次保持不变，从第 {next} 轮开始逐请求扰动。", previewTokens: "保留前 {value} 个估算历史 Token，超过后逐请求扰动。", previewPercent: "保留约前 {value}% 的可见输入，在此之后插入新的扰动。",
    previewFull: "100%：请求原样转发，不插入扰动。", previewZero: "0%：从首个可编辑文本开始扰动。",
    previewEstimate: "这是文本权重估算，不是实际缓存命中率；落点在工具内容等不可编辑位置时，会顺延到后续可编辑文本。", previewBoundary: "保留早期可缓存前缀；后续每个新请求使用新扰动，同一次请求的供应商重试复用扰动。", previewImmediate: "文本会进入模型上下文；实际命中情况请对照供应商统计。",
    prefixLegendText: "允许缓存 {value}%", tailLegendText: "逐请求扰动 {value}%", ready: "无未保存修改", saveScopeHint: "保存所有配置范围的修改",
    providerScopeLabel: "配置范围", scopeDefault: "默认策略（未单独配置的供应商）", scopeInherited: "此供应商尚无单独配置，当前继承默认策略。编辑并保存后将使用独立策略。", scopeIndependent: "此供应商使用独立策略；其他供应商不受此处修改影响。", scopeDefaultNotice: "默认关闭；未单独配置的供应商使用这里的默认策略。已有手动保存的默认策略会保留。", providerReload: "刷新供应商列表", providerReset: "移除单独配置", providerListLoading: "正在读取 Magpie 供应商…", providerListError: "无法读取供应商列表，可重试；默认策略和已有供应商配置仍可编辑。", unsaved: "有未保存修改",
    providerStageHint: "单独策略在路由后执行。Magpie 在此阶段不能拒绝请求；无法安全应用时将原样发送并记录 provider-skipped 警告，请在日志中确认策略是否实际应用。",
    eyebrow: "网关策略", title: "提示词缓存控制", modeTitle: "请求策略", modeIntro: "选择如何处理各供应商请求中的提示词缓存。",
    bustTitle: "按策略扰动缓存", bustDescription: "立即扰动，或按轮数、估算 Token 数、输入比例保留可缓存前缀。",
    rotationStrategyLabel: "开始逐请求扰动的时机", rotationRequestOption: "立即：每次请求", rotationTurnsOption: "前 N 轮允许缓存，之后每次请求扰动", rotationTokensOption: "前 N 估算 Token 允许缓存，超过后每次请求扰动",
    rotationTurnsLabel: "允许缓存的前多少个用户轮次", rotationTokensLabel: "允许缓存的估算历史 Token 上限",
    rotationNotice: "阈值内原样保留；超过后，每次请求都在固定的后续消息起点加入新标记，早期缓存前缀不变。不是每 N 轮循环一次。需要完整历史；显式缓存与原缓存键保留，OpenAI explicit-only 专项暂停。",
    rotationTokenHint: "Token 是估算值，并按首次越过阈值的整个用户轮处理；该轮中阈值前的部分文本也可能不再命中缓存。",
    rotationPercentOption: "按比例保留输入前缀", rotationPercentLabel: "保留输入前缀（%）",
    rotationPercentHint: "按本次请求的可见文本估算位置。设为 5%，保留约前 5% 后插入本次标记。0% 从首个可编辑文本开始，100% 原样转发。",
    invalidPercent: "请输入 0 到 100 之间的百分比",
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
    modelListLoading: "Loading available models…", modelListActive: "Only providers with available models are shown. Hidden providers keep their independent policies.", modelListEmpty: "No models are currently available. Default and saved provider policies are preserved.", modelListError: "Available models could not be read. The provider list is preserved; refresh to retry.", modelListStale: "Model refresh failed. The last successful provider range is still shown; refresh to retry.", modelDraftUnavailable: "A provider with no available models has an invalid draft. Restore its models in Magpie, correct the draft, then save again.",
    providerConfigured: "Configured", providerDraft: "Unsaved", inactiveDraft: "A disabled provider has an invalid draft. Enable it in Magpie, correct the draft, then save again.",
    pageIntro: "Choose a policy for each provider and preserve the input prefix you need.", scopeRoot: "Default policy", scopeOwn: "Independent", scopeParent: "Inherited", rotationHelpTitle: "Perturbation limitations", styleVisibility: "Perturbation text enters model context and may affect interpretation.",
    advancedTitle: "Protocol settings", advancedHint: "Gemini references and Responses explicit mode", previewTitle: "Policy preview",
    previewRequest: "Every request receives a fresh text perturbation.", previewTurns: "Keep the first {value} user turns unchanged. Perturb every request from turn {next}.", previewTokens: "Allow the first {value} estimated history tokens to cache, then perturb every request.", previewPercent: "Preserve about the first {value}% of visible input, then insert a fresh perturbation.",
    previewFull: "100%: pass the request through unchanged, without perturbation.", previewZero: "0%: perturb from the first editable text.",
    previewEstimate: "This estimates text weight, not the actual cache hit rate. A cutoff inside tool data or other protected content advances to the next editable text.", previewBoundary: "Preserve the early cacheable prefix. Each new request gets a fresh perturbation; provider retries within that request reuse it.", previewImmediate: "Text enters model context. Check provider statistics for actual cache hits.",
    prefixLegendText: "Cache allowed {value}%", tailLegendText: "Perturbed per request {value}%", ready: "No unsaved changes", saveScopeHint: "Save changes across all policy scopes",
    providerScopeLabel: "Policy scope", scopeDefault: "Default policy (unconfigured providers)", scopeInherited: "No separate policy yet. This provider inherits the default; editing and saving creates an independent policy.", scopeIndependent: "This provider has an independent policy. Changes here do not affect other providers.", scopeDefaultNotice: "Off by default. Unconfigured providers use this policy. Previously saved default settings are preserved.", providerReload: "Refresh providers", providerReset: "Remove separate policy", providerListLoading: "Loading Magpie providers…", providerListError: "Could not load providers; retry. Default and existing provider policies can still be edited.", unsaved: "Unsaved changes",
    providerStageHint: "Separate policies run after routing, when Magpie cannot reject the request. If a policy cannot be safely applied, the request is forwarded unchanged and a provider-skipped warning is logged. Check logs to confirm application.",
    eyebrow: "Gateway policy", title: "Prompt cache control", modeTitle: "Request policy", modeIntro: "Choose how prompt caching is handled across provider requests.",
    bustTitle: "Perturb cache by policy", bustDescription: "Perturb immediately, or preserve a cacheable prefix by turns, estimated tokens, or input percentage.",
    rotationStrategyLabel: "When to start per-request perturbation", rotationRequestOption: "Immediately: every request", rotationTurnsOption: "Cache the first N turns; then perturb every request", rotationTokensOption: "Cache up to N estimated tokens; then perturb every request",
    rotationTurnsLabel: "Initial user turns allowed to cache", rotationTokensLabel: "Initial estimated history-token allowance",
    rotationNotice: "Within the allowance requests remain unchanged. Beyond it, every request gets a fresh marker at the same later-history boundary, preserving the early prefix. This does not repeat every N turns. Full history is required. Existing cache controls and cache keys are preserved; the OpenAI explicit-only override is paused.",
    rotationTokenHint: "Token counts are estimates. Perturbation starts at the user turn that first crosses the limit, so some earlier text in that turn may also stop hitting cache.",
    rotationPercentOption: "Preserve a percentage of the input prefix", rotationPercentLabel: "Input prefix to preserve (%)",
    rotationPercentHint: "The cutoff is estimated from visible request text. At 5%, a fresh marker goes after about the first 5%. At 0%, it goes at the first editable text. At 100%, the request passes through unchanged.",
    invalidPercent: "Enter a percentage between 0 and 100",
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
const rotationPercent = $("rotationPercent")
const rotationStyle = $("rotationStyle")
const providerScope = $("providerScope")
const providerReload = $("providerReload")
const providerReset = $("providerReset")
let activeScope = ""
let providerRows = []
let modelProviderIds = null
let pageServicePort
let defaultPolicy = normalize({})
let providerPolicies = Object.create(null)
let drafts = Object.create(null)
let language = "zh"
let saving = false
let dirty = false
let invalidField = null

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
  const modelStatus = $("modelListStatus")
  if (modelStatus.dataset.state) modelStatus.textContent = LABELS[language][modelStatus.dataset.state] || ""
  showStatus(status.dataset.state || "")
  renderPreview()
}

function showStatus(state = "") {
  status.dataset.state = state
  status.textContent = LABELS[language][state || "ready"] || ""
  saveButton.textContent = LABELS[language][saving ? "saving" : "saveButton"]
  saveButton.dataset.busy = String(saving)
  $("saveScopeHint").hidden = !dirty
  if (invalidField) $("fieldError").textContent = LABELS[language][state] || ""
}

function clearFieldError() {
  if (invalidField) {
    invalidField.removeAttribute("aria-invalid")
    invalidField.removeAttribute("aria-errormessage")
  }
  invalidField = null
  $("fieldError").hidden = true
}

function showFieldError(state) {
  clearFieldError()
  const fields = { invalidTurns: rotationTurns, invalidTokens: rotationTokens, invalidPercent: rotationPercent, invalidProvider: providerIds, invalidStyle: rotationStyle, invalidRotation: rotationStrategy, invalidCachedContent: cachedContent }
  const field = fields[state]
  if (!field) return
  if (field === providerIds || field === cachedContent) $("advancedSettings").open = true
  invalidField = field
  field.setAttribute("aria-invalid", "true")
  field.setAttribute("aria-errormessage", "fieldError")
  field.insertAdjacentElement("afterend", $("fieldError"))
  $("fieldError").textContent = LABELS[language][state]
  $("fieldError").hidden = false
  field.focus()
}

function renderPreview() {
  const labels = LABELS[language]
  const bust = document.querySelector('input[name="mode"]:checked')?.value === "bust"
  $("policyPreview").hidden = !bust
  $("percentPreview").hidden = true
  if (!bust) return
  const strategy = rotationStrategy.value
  let summary = labels.previewRequest
  let hint = labels.previewImmediate
  if (strategy === "turns") {
    const turns = Number(rotationTurns.value)
    summary = Number.isSafeInteger(turns) && turns > 0 && turns <= 1000000
      ? labels.previewTurns.replace("{value}", turns).replace("{next}", turns + 1) : labels.invalidTurns
    hint = labels.previewBoundary
  } else if (strategy === "tokens") {
    const tokens = Number(rotationTokens.value)
    summary = Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 1000000000
      ? labels.previewTokens.replace("{value}", tokens) : labels.invalidTokens
    hint = labels.rotationTokenHint
  } else if (strategy === "percent") {
    const percent = Number(rotationPercent.value)
    const valid = String(rotationPercent.value).trim() !== "" && Number.isFinite(percent) && percent >= 0 && percent <= 100
    summary = !valid ? labels.invalidPercent : percent === 100 ? labels.previewFull : percent === 0 ? labels.previewZero : labels.previewPercent.replace("{value}", percent)
    hint = labels.previewEstimate
    if (valid) {
      $("percentPreview").hidden = false
      $("prefixSegment").style.width = percent + "%"
      $("prefixLegend").textContent = labels.prefixLegendText.replace("{value}", percent)
      $("tailLegend").textContent = labels.tailLegendText.replace("{value}", Number((100 - percent).toFixed(8)))
    }
  }
  $("previewSummary").textContent = summary
  $("previewHint").textContent = hint
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
  rotationStrategy.value = ["turns", "tokens", "percent"].includes(current.rotation.strategy) ? current.rotation.strategy : "request"
  rotationTurns.value = current.rotation.turns
  rotationTokens.value = current.rotation.tokens
  rotationPercent.value = current.rotation.percent ?? 5
  rotationStyle.value = ["marker", "punctuation", "whitespace"].includes(current.rotation.style) ? current.rotation.style : "marker"
  saveButton.disabled = !dirty
  updateControls()
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function providerIsOff(id) {
  return providerRows.some((provider) => provider.id === id && provider.off)
}

function providerUnavailable(id) {
  return Boolean(id) && (providerIsOff(id) || (modelProviderIds !== null && !modelProviderIds.has(id)))
}

function renderProviderChoices() {
  const names = new Map(providerRows.map((provider) => [provider.id, provider.name]))
  const ids = new Set([...names.keys(), ...Object.keys(providerPolicies), ...Object.keys(drafts), activeScope])
  const first = document.createElement("option")
  first.value = ""
  first.textContent = LABELS[language].scopeDefault
  const choices = [first]
  for (const id of ids) {
    if (!id || providerUnavailable(id)) continue
    const option = document.createElement("option")
    option.value = id
    const name = names.get(id)
    const label = name && name !== id ? name + " · " + id : id
    const tags = []
    if (owns(providerPolicies, id)) tags.push(LABELS[language].providerConfigured)
    if (owns(drafts, id)) tags.push(LABELS[language].providerDraft)
    option.textContent = (tags.length ? "[" + tags.join(" · ") + "] " : "") + label
    choices.push(option)
  }
  providerScope.replaceChildren(...choices)
  providerScope.value = activeScope
  $("scopeNotice").textContent = !activeScope ? LABELS[language].scopeDefaultNotice : owns(providerPolicies, activeScope) || owns(drafts, activeScope) ? LABELS[language].scopeIndependent : LABELS[language].scopeInherited
  $("scopeState").textContent = LABELS[language][!activeScope ? "scopeRoot" : owns(providerPolicies, activeScope) || owns(drafts, activeScope) ? "scopeOwn" : "scopeParent"]
  providerReset.disabled = saving || settings.disabled || !activeScope || (!owns(providerPolicies, activeScope) && !owns(drafts, activeScope))
  providerReset.hidden = !activeScope || (!owns(providerPolicies, activeScope) && !owns(drafts, activeScope))
  $("providerStageHint").hidden = !activeScope && Object.keys(providerPolicies).length === 0 && !Object.keys(drafts).some((scope) => scope)
}

function captureForm() {
  return {
    mode: document.querySelector('input[name="mode"]:checked')?.value,
    cachedContent: cachedContent.value, providerIds: providerIds.value, openaiEnabled: openaiEnabled.checked,
    log: logEnabled.checked, strategy: rotationStrategy.value, turns: rotationTurns.value,
    tokens: rotationTokens.value, percent: rotationPercent.value, style: rotationStyle.value,
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
  rotationPercent.value = draft.percent
  rotationStyle.value = draft.style
  saveButton.disabled = !dirty
  updateControls()
}

function showCurrentScope() {
  clearFieldError()
  if (providerUnavailable(activeScope)) activeScope = ""
  if (owns(drafts, activeScope)) restoreDraft(drafts[activeScope])
  else if (activeScope && !owns(providerPolicies, activeScope) && owns(drafts, "")) restoreDraft(drafts[""])
  else render(activeScope && owns(providerPolicies, activeScope) ? providerPolicies[activeScope] : defaultPolicy)
  renderProviderChoices()
}

function applyDocument(options) {
  pageServicePort = options?.pageServicePort
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
  const scheduled = bust && ["turns", "tokens"].includes(rotationStrategy.value)
  $("rotationFields").hidden = !bust
  $("rotationTurnsField").hidden = rotationStrategy.value !== "turns"
  $("rotationTokensField").hidden = rotationStrategy.value !== "tokens"
  $("rotationPercentField").hidden = rotationStrategy.value !== "percent"
  $("rotationNotice").hidden = !scheduled
  $("rotationTokenHint").hidden = !bust || rotationStrategy.value !== "tokens"
  for (const control of [cachedContent, logEnabled]) control.disabled = passthrough
  for (const control of [openaiEnabled, providerIds]) control.disabled = passthrough || bust
  rotationStrategy.disabled = !bust
  rotationTurns.disabled = !bust || rotationStrategy.value !== "turns"
  rotationTokens.disabled = !bust || rotationStrategy.value !== "tokens"
  rotationPercent.disabled = !bust || rotationStrategy.value !== "percent"
  rotationStyle.disabled = !bust
  renderPreview()
}

function collect(draft = captureForm()) {
  const mode = draft.mode
  if (!["bust", "disable-explicit", "passthrough"].includes(mode)) throw new Error("invalidMode")
  if (!["reject", "drop"].includes(draft.cachedContent)) throw new Error("invalidCachedContent")
  const strategy = draft.strategy
  if (!["request", "turns", "tokens", "percent"].includes(strategy)) throw new Error("invalidRotation")
  const style = draft.style
  if (!["marker", "punctuation", "whitespace"].includes(style)) throw new Error("invalidStyle")
  const validTurns = Number.isSafeInteger(Number(draft.turns)) && Number(draft.turns) >= 1 && Number(draft.turns) <= 1000000
  const validTokens = Number.isSafeInteger(Number(draft.tokens)) && Number(draft.tokens) >= 1 && Number(draft.tokens) <= 1000000000
  if (mode === "bust" && strategy === "turns" && !validTurns) throw new Error("invalidTurns")
  if (mode === "bust" && strategy === "tokens" && !validTokens) throw new Error("invalidTokens")
  const percent = Number(draft.percent)
  const validPercent = String(draft.percent).trim() !== "" && Number.isFinite(percent) && percent >= 0 && percent <= 100
  if (mode === "bust" && strategy === "percent" && !validPercent) throw new Error("invalidPercent")
  const ids = draft.openaiEnabled ? [...new Set(draft.providerIds.split(/[\s,]+/).filter(Boolean))] : []
  if (draft.openaiEnabled && (!ids.length || ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(id)))) throw new Error("invalidProvider")
  return {
    mode, log: draft.log, cachedContent: draft.cachedContent, openaiExplicitProviders: ids,
    rotation: { strategy, turns: validTurns ? Number(draft.turns) : 10, tokens: validTokens ? Number(draft.tokens) : 8000, style, ...(strategy === "percent" || (validPercent && percent !== 5) ? { percent: validPercent ? percent : 5 } : {}) },
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
  return { ...root, ...(pageServicePort === undefined ? {} : { pageServicePort }), providers: Object.fromEntries(Object.entries(providers)) }
}

function changed() {
  if (saving) return
  clearFieldError()
  updateControls()
  dirty = true
  drafts[activeScope] = captureForm()
  saveButton.disabled = false
  renderProviderChoices()
  showStatus("unsaved")
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
    if (providerUnavailable(error.scope)) {
      showStatus(providerIsOff(error.scope) ? "inactiveDraft" : "modelDraftUnavailable")
      return
    }
    if (typeof error.scope === "string") {
      activeScope = error.scope
      showCurrentScope()
    }
    showStatus(LABELS[language][error.message] ? error.message : "saveError")
    showFieldError(error.message)
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
    showStatus(status.dataset.state)
  }
}

async function loadProviders() {
  providerReload.disabled = true
  $("providerListStatus").dataset.state = "providerListLoading"
  $("providerListStatus").textContent = LABELS[language].providerListLoading
  $("modelListStatus").dataset.state = "modelListLoading"
  $("modelListStatus").textContent = LABELS[language].modelListLoading
  try {
    const [providers, models] = await Promise.allSettled([
      (async () => {
        const result = await magpie.read("providers:list")
        const rows = Array.isArray(result) ? result : result?.providers
        if (!Array.isArray(rows)) throw new Error("Unexpected provider list")
        return rows.filter((provider) => provider && typeof provider.id === "string" && provider.id.trim()).map((provider) => ({
          id: provider.id, name: typeof provider.name === "string" ? provider.name : provider.id,
          off: provider.off === true || provider.enabled === false || provider.disabled === true,
        }))
      })(),
      (async () => {
        if ($("modelService")?.content !== "1") throw new Error("Page service unavailable")
        const response = await fetch(new URL("api/model-providers", location.href), { headers: { "X-Magpie-Cache-Control": "models" }, credentials: "omit", cache: "no-store" })
        if (!response.ok) throw new Error("Model list unavailable")
        const body = await response.json()
        if (!Array.isArray(body?.providerIds) || body.providerIds.some((id) => typeof id !== "string" || !id.trim())) throw new Error("Unexpected model list")
        return new Set(body.providerIds)
      })(),
    ])
    if (providers.status === "fulfilled") {
      providerRows = providers.value
      $("providerListStatus").dataset.state = ""
      $("providerListStatus").textContent = ""
    } else {
      $("providerListStatus").dataset.state = "providerListError"
      $("providerListStatus").textContent = LABELS[language].providerListError
    }
    let modelState
    if (models.status === "fulfilled") {
      modelProviderIds = models.value
      modelState = modelProviderIds.size ? "modelListActive" : "modelListEmpty"
    } else modelState = modelProviderIds === null ? "modelListError" : "modelListStale"
    $("modelListStatus").dataset.state = modelState
    $("modelListStatus").textContent = LABELS[language][modelState]
    showCurrentScope()
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
settings.addEventListener("change", changed)
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

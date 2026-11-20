const MODES = ["passthrough", "disable-explicit", "bust"]
const BLOCK_ANNOTATIONS = ["cache_control", "prompt_cache_breakpoint"]
const REQUEST_KEYS = [
  "cache_control", "prompt_cache_breakpoint", "prompt_cache_key",
  "prompt_cache_retention", "prompt_cache_options",
]

export function onRequest(body, ctx) {
  const error = optionsError(ctx.options)
  if (error) return ctx.reject(400, "cache-control: " + error)
  if (hasProviderPolicies(ctx.options)) return
  const options = settings(ctx)
  if (options.mode === "passthrough" || preservesEntirePercent(options)) return
  const state = begin(ctx, options)
  if (!supportsProtocol(ctx.protocol)) {
    state.warnings.push("unsupported-protocol")
    report(ctx, "request")
    return
  }
  if (!isObject(body)) return ctx.reject(400, "cache-control: request body must be an object")
  if (hasCachedContent(body, ctx.protocol) && options.cachedContent === "reject") {
    state.warnings.push("cached-content-reference-rejected")
    report(ctx, "rejected")
    return ctx.reject(409, "cache-control: Gemini cachedContent can contain missing context; expand it into the request before disabling caching, or explicitly set cachedContent to drop")
  }
  if (options.mode === "bust" && !isThresholdPolicy(options) && (!canPrepend(body, protocolFamily(ctx.protocol)) || (options.rotation.style === "whitespace" && !hasWhitespaceTarget(body, protocolFamily(ctx.protocol))))) {
    return ctx.reject(400, "cache-control: unsupported system prompt shape; request was not modified")
  }
  const rotationError = prepareRotation(body, ctx, options)
  if (rotationError) return ctx.reject(409, "cache-control: " + rotationError)
  return transform(body, ctx, options)
}

export function onProvider(body, ctx) {
  if (optionsError(ctx.options)) return
  const scoped = hasProviderPolicies(ctx.options)
  const provider = ctx.provider || {}
  const override = scoped && Object.prototype.hasOwnProperty.call(ctx.options.providers, provider.id)
  const options = settings(ctx, override ? ctx.options.providers[provider.id] : ctx.options)
  if (options.mode === "passthrough" || preservesEntirePercent(options) || (scoped && (typeof provider.id !== "string" || !provider.id))) {
    if (scoped) delete ctx.state.cacheControl
    return
  }
  if (!scoped && (!supportsProtocol(ctx.protocol) || !isObject(body))) return
  let state
  if (scoped) {
    const states = ctx.state.cacheControlProviders || (ctx.state.cacheControlProviders = Object.create(null))
    state = Object.prototype.hasOwnProperty.call(states, provider.id) ? states[provider.id] : undefined
    if (!state) state = states[provider.id] = begin(ctx, options)
    ctx.state.cacheControl = state
    state.policyScope = override ? "provider" : "default"
    state.salted = false
    state.explicitOnly = false
    state.cacheReadTokens = null
    state.cacheWriteTokens = null
    state.inputTokens = null
    state.warnings = []
  } else state = ctx.state.cacheControl || begin(ctx, options)
  state.providerId = provider.id ?? null
  if (!supportsProtocol(ctx.protocol) || !isObject(body)) {
    state.warnings.push(!supportsProtocol(ctx.protocol) ? "unsupported-protocol" : "invalid-request-body")
    report(ctx, "provider-skipped", scoped)
    return
  }
  if (hasCachedContent(body, ctx.protocol) && options.cachedContent === "reject") {
    state.warnings.push("provider-stage-cached-content-preserved")
    report(ctx, "provider-skipped", scoped)
    return
  }
  if (options.mode === "bust" && !isThresholdPolicy(options) && (!canPrepend(body, protocolFamily(ctx.protocol)) || (options.rotation.style === "whitespace" && !hasWhitespaceTarget(body, protocolFamily(ctx.protocol))))) {
    state.warnings.push("provider-stage-unsupported-system-prompt")
    report(ctx, "provider-skipped", scoped)
    return
  }
  const rotationError = prepareRotation(body, ctx, options)
  if (rotationError) {
    state.warnings.push("provider-stage-rotation-history-unavailable")
    report(ctx, "provider-skipped", scoped)
    return
  }
  const result = transform(body, ctx, options)
  const explicitProvider = protocolFamily(ctx.protocol) === "responses" && options.openaiExplicitProviders.includes(provider.id)
  if (explicitProvider && options.mode === "disable-explicit") {
    result.prompt_cache_options = { mode: "explicit" }
    state.explicitOnly = true
  } else {
    state.explicitOnly = false
  }
  if (explicitProvider && options.mode === "bust" && !state.warnings.includes("explicit-only-paused-for-text-perturbation")) state.warnings.push("explicit-only-paused-for-text-perturbation")
  report(ctx, "provider")
  return result
}

export function onResponse(body, ctx) {
  observe(body, ctx)
}

export function onEvent(event, ctx) {
  observe(event, ctx)
}

function settings(ctx, policy = ctx.options) {
  const options = policy || {}
  return {
    mode: options.mode ?? "passthrough",
    log: options.log ?? false,
    cachedContent: options.cachedContent ?? "reject",
    openaiExplicitProviders: options.openaiExplicitProviders ?? [],
    rotation: {
      strategy: options.rotation?.strategy ?? "request",
      turns: options.rotation?.turns ?? 10,
      tokens: options.rotation?.tokens ?? 8000,
      percent: options.rotation?.percent ?? 5,
      style: options.rotation?.style ?? "marker",
    },
  }
}

function optionsError(options, allowProviders = true) {
  if (options === undefined || options === null) return
  if (!isObject(options)) return "options must be an object"
  const allowed = ["mode", "log", "cachedContent", "openaiExplicitProviders", "rotation"]
  if (allowProviders) allowed.push("providers", "pageServicePort")
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) return "unknown option: " + key
  }
  if (options.mode !== undefined && !MODES.includes(options.mode)) return "invalid mode"
  if (options.log !== undefined && typeof options.log !== "boolean") return "log must be a boolean"
  if (options.pageServicePort !== undefined && (!Number.isSafeInteger(options.pageServicePort) || options.pageServicePort < 1 || options.pageServicePort > 65535)) return "pageServicePort must be an integer from 1 to 65535"
  if (options.cachedContent !== undefined && !["reject", "drop"].includes(options.cachedContent)) return "cachedContent must be reject or drop"
  if (options.openaiExplicitProviders !== undefined && (!Array.isArray(options.openaiExplicitProviders) || options.openaiExplicitProviders.some((provider) => typeof provider !== "string" || !provider.trim()))) {
    return "openaiExplicitProviders must be an array of nonempty provider ids"
  }
  if (options.rotation !== undefined) {
    const rotation = options.rotation
    if (!isObject(rotation)) return "rotation must be an object"
    if (Object.keys(rotation).some((key) => !["strategy", "turns", "tokens", "percent", "style"].includes(key))) return "unknown rotation option"
    if (rotation.strategy !== undefined && !["request", "turns", "tokens", "percent"].includes(rotation.strategy)) return "invalid rotation strategy"
    if (rotation.percent !== undefined && (!Number.isFinite(rotation.percent) || rotation.percent < 0 || rotation.percent > 100)) return "rotation percent must be between 0 and 100"
    if (rotation.style !== undefined && !["punctuation", "whitespace", "marker"].includes(rotation.style)) return "invalid rotation style"
    for (const [key, maximum] of [["turns", 1000000], ["tokens", 1000000000]]) {
      if (rotation[key] !== undefined && (!Number.isSafeInteger(rotation[key]) || rotation[key] < 1 || rotation[key] > maximum)) return "invalid rotation " + key
    }
  }
  if (allowProviders && options.providers !== undefined) {
    if (!isObject(options.providers)) return "providers must be an object keyed by provider id"
    for (const [id, policy] of Object.entries(options.providers)) {
      if (!id.trim()) return "provider id must not be empty"
      if (!isObject(policy)) return "provider policy must be an object"
      const error = optionsError(policy, false)
      if (error) return "providers[" + id + "]: " + error
    }
  }
}

function hasProviderPolicies(options) {
  return isObject(options?.providers) && Object.keys(options.providers).length > 0
}

function supportsProtocol(protocol) {
  return protocolFamily(protocol) !== null
}

function protocolFamily(protocol) {
  if (["anthropic", "anthropic-messages"].includes(protocol)) return "anthropic"
  if (["chat", "chat-completions", "openai-chat", "openai-compatible"].includes(protocol)) return "chat"
  if (["responses", "openai-responses"].includes(protocol)) return "responses"
  if (["gemini", "vertex", "vertex-gemini"].includes(protocol)) return "gemini"
  if (["bedrock", "bedrock-converse"].includes(protocol)) return "bedrock"
  if (["cohere", "cohere-v2"].includes(protocol)) return "cohere"
  if (["ollama-chat", "ollama-generate"].includes(protocol)) return protocol
  return null
}

function begin(ctx, options) {
  const nonce = "[magpie-cache-control:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2) + ":" + Math.random().toString(36).slice(2) + "]"
  const state = {
    mode: options.mode,
    log: options.log,
    marker: perturbationText(nonce, options.rotation.style),
    cacheKey: nonce,
    removed: {},
    salted: false,
    explicitOnly: false,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    inputTokens: null,
    warnings: [],
    rotation: { strategy: options.rotation.strategy, style: options.rotation.style },
    rotationPrepared: false,
  }
  ctx.state.cacheControl = state
  return state
}

function transform(body, ctx, options) {
  const state = ctx.state.cacheControl
  const family = protocolFamily(ctx.protocol)
  const bedrock = family === "bedrock"
  const rotateKey = options.mode === "bust" && Object.prototype.hasOwnProperty.call(body, "prompt_cache_key")
  if (isThresholdPolicy(options)) {
    if (state.rotation.strategy === "percent") {
      if (state.percentTarget) {
        const { owner, key, index } = state.percentTarget
        const text = owner[key]
        owner[key] = text.slice(0, index) + rotationInsertion(state) + text.slice(index)
        state.percentTarget = null
        state.salted = true
      }
      return body
    }
    if (state.rotation.phase === "bust-tail") {
      perturbTail(body, family, state.rotation.boundaryTurn, state.marker, state.rotation.style)
      state.salted = true
    }
    return body
  }
  removeKeys(body, REQUEST_KEYS, state)
  cleanBlocks(body.system, state, bedrock)
  if (family === "gemini") {
    cleanBlocks(body.systemInstruction?.parts, state)
    cleanBlocks(body.system_instruction?.parts, state)
  }
  for (const key of ["messages", "input", "contents"]) {
    if (!Array.isArray(body[key])) continue
    for (const message of body[key]) {
      if (!isObject(message)) continue
      removeKeys(message, BLOCK_ANNOTATIONS, state)
      cleanBlocks(message.content, state, bedrock)
      cleanBlocks(message.parts, state)
      if (message.type === "additional_tools" && Array.isArray(message.tools)) {
        for (const tool of message.tools) removeKeys(tool, BLOCK_ANNOTATIONS, state)
      }
    }
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) removeKeys(tool, BLOCK_ANNOTATIONS, state)
  }
  if (bedrock) {
    cleanBlocks(body.toolConfig?.tools, state, true)
    removeKeys(body.additionalModelRequestFields, BLOCK_ANNOTATIONS, state)
  }
  if (family === "gemini") {
    for (const key of ["cachedContent", "cached_content"]) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue
      if (body[key] && !state.warnings.includes("cached-content-dropped")) state.warnings.push("cached-content-dropped")
      removeKeys(body, [key], state)
    }
  }
  if (options.mode === "bust") {
    prepend(body, family, state.marker, options.rotation.style)
    state.salted = true
    if (rotateKey) body.prompt_cache_key = state.cacheKey
  }
  return body
}

function isThresholdPolicy(options) {
  return options.mode === "bust" && options.rotation.strategy !== "request"
}

function preservesEntirePercent(options) {
  return options.mode === "bust" && options.rotation.strategy === "percent" && options.rotation.percent === 100
}

function prepareRotation(body, ctx, options) {
  const state = ctx.state.cacheControl
  if (!isThresholdPolicy(options)) return
  const family = protocolFamily(ctx.protocol)
  if (body.previous_response_id || body.conversation || body.cachedContent || body.cached_content || (Array.isArray(body.context) && body.context.length)) {
    return "threshold policies require full visible history; expand server-side conversation and cache references first"
  }
  if (options.rotation.strategy === "percent") return preparePercent(body, family, state, options.rotation.percent)
  if (state.rotationPrepared) {
    if (state.rotation.phase === "bust-tail" && !canPerturbTail(body, family, state.rotation.boundaryTurn, options.rotation.style)) return "the first uncached user turn is unavailable or cannot be edited safely; whitespace requires an existing nonempty first text block"
    return
  }
  if (family === "ollama-generate") return "threshold policies require structured conversation history; use Ollama Chat or per-request rotation"
  const messages = family === "gemini" ? body.contents : family === "responses" ? body.input : body.messages
  const history = typeof messages === "string" && family === "responses" ? [{ role: "user", content: messages }] : messages
  if (!Array.isArray(history) || history.some((message) => message?.type === "item_reference")) return "threshold policies require full visible message history"
  const stats = { ascii: 0, other: 0, messages: 0 }
  const strategy = options.rotation.strategy
  const threshold = options.rotation[strategy]
  let turns = 0
  let boundaryTurn = null
  for (const message of history) {
    if (!isObject(message)) continue
    const role = message.role ?? (family === "gemini" ? "user" : "")
    if (role === "system" || role === "developer") continue
    if (isHumanMessage(message, family)) turns++
    const text = historyText(message, family)
    if (text) {
      stats.messages++
      for (const character of text) {
        if (character.codePointAt(0) <= 127) stats.ascii++
        else stats.other++
      }
    }
    const exceeds = strategy === "turns" ? turns > threshold : Math.ceil(stats.ascii / 4) + stats.other + stats.messages * 4 > threshold
    if (exceeds && turns > 0 && boundaryTurn === null) boundaryTurn = turns
  }
  if (!turns) return "threshold policies require at least one visible user turn"
  const estimatedTokens = Math.ceil(stats.ascii / 4) + stats.other + stats.messages * 4
  if (boundaryTurn !== null && !canPerturbTail(body, family, boundaryTurn, options.rotation.style)) return "the first uncached user turn cannot be edited safely; whitespace requires an existing nonempty first text block"
  state.rotation = { strategy, threshold, style: options.rotation.style, phase: boundaryTurn === null ? "allow-cache" : "bust-tail", turns, estimatedTokens, boundaryTurn }
  state.rotationPrepared = true
}

function rotationInsertion(state) {
  return "\n" + state.marker + "\n"
}

function preparePercent(body, family, state, percent) {
  state.percentTarget = null
  if (family === "ollama-generate" && (body.raw === true || body.template)) return "percentage rotation requires the standard Ollama prompt template"
  const history = family === "gemini" ? body.contents : family === "responses" ? body.input : body.messages
  if (Array.isArray(history) && history.some((message) => message?.type === "item_reference")) return "percentage rotation requires full visible message history"
  const fields = []
  const add = (owner, key, editable = true) => {
    const text = owner?.[key]
    if (typeof text === "string" && text.length) fields.push({ owner, key, text, editable: editable && text.trim().length > 0 })
  }
  const addContent = (owner, key, editable = true) => {
    const content = owner?.[key]
    if (!Array.isArray(content)) {
      add(owner, key, editable)
      return
    }
    for (const block of content) {
      if (!isObject(block)) continue
      const plain = block.type === undefined || block.type === "text" || block.type === "input_text" || block.type === "output_text"
      const unsigned = !block.signature && !block.thoughtSignature && !block.thought_signature && !block.thought && !block.annotations?.length
      add(block, "text", editable && plain && unsigned)
      add(block, "thinking", false)
    }
  }
  if (family === "gemini") {
    const system = body.systemInstruction ?? body.system_instruction
    addContent(system, "parts")
  } else if (family === "responses") add(body, "instructions")
  else addContent(body, "system")
  if (Array.isArray(history)) {
    for (const message of history) {
      if (!isObject(message)) continue
      if (family === "gemini") {
        addContent(message, "parts")
      } else if (family === "responses" && message.type === "function_call") {
        add(message, "arguments", false)
      } else if (family === "responses" && message.type === "custom_tool_call") {
        add(message, "input", false)
      } else if (family === "responses" && ["function_call_output", "custom_tool_call_output"].includes(message.type)) {
        addContent(message, "output", false)
      } else {
        addContent(message, "content")
      }
    }
  } else if (family === "responses") add(body, "input")
  else if (family === "ollama-generate") add(body, "prompt")

  if (fields.some(({ text }) => text.includes(rotationInsertion(state)))) {
    state.salted = true
    return
  }
  let total = 0
  for (const field of fields) {
    field.weight = 0
    for (const character of field.text) field.weight += character.codePointAt(0) <= 127 ? 1 : 4
    total += field.weight
  }
  const cutoff = Math.ceil(total * percent / 100)
  let offset = 0
  for (const field of fields) {
    if (field.editable && offset + field.weight > cutoff) {
      let index = 0
      let position = offset
      for (const character of field.text) {
        if (position >= cutoff) break
        position += character.codePointAt(0) <= 127 ? 1 : 4
        index += character.length
      }
      if (index < field.text.length) {
        state.percentTarget = { owner: field.owner, key: field.key, index }
        state.rotation = { ...state.rotation, percent, phase: "bust-tail", estimatedTextUnits: total, prefixTextUnits: position }
        return
      }
    }
    offset += field.weight
  }
  return "percentage rotation found no editable text at or after the cutoff"
}

function boundaryMessage(body, family, boundaryTurn) {
  const history = family === "gemini" ? body.contents : family === "responses" ? body.input : body.messages
  if (family === "responses" && typeof history === "string") return boundaryTurn === 1 ? { role: "user", content: history } : null
  if (!Array.isArray(history)) return null
  let turns = 0
  for (const message of history) {
    if (isObject(message) && isHumanMessage(message, family) && ++turns === boundaryTurn) return message
  }
  return null
}

function canPerturbTail(body, family, boundaryTurn, style) {
  const message = boundaryMessage(body, family, boundaryTurn)
  if (!message) return false
  if (style === "whitespace") return hasPlainTextStart(family === "gemini" ? message.parts : message.content)
  if (family === "gemini") return Array.isArray(message.parts)
  return typeof message.content === "string" || (family !== "ollama-chat" && Array.isArray(message.content))
}

function perturbationText(marker, style) {
  if (style === "marker") return marker
  const nonce = marker.slice("[magpie-cache-control:".length, -1)
  let encoded = ""
  for (const character of nonce) {
    const value = character === ":" ? 36 : parseInt(character, 36)
    if (style === "whitespace") {
      for (let bit = 5; bit >= 0; bit--) encoded += (value >> bit) & 1 ? "\t" : " "
    } else {
      const symbols = ".,:;!?~|"
      encoded += symbols[value >> 3] + symbols[value & 7]
    }
  }
  return encoded
}

function perturbTail(body, family, boundaryTurn, marker, style) {
  const message = boundaryMessage(body, family, boundaryTurn)
  if (family === "responses" && typeof body.input === "string") body.input = prependText(body.input, marker)
  else if (family === "gemini") prependStyledBlock(message.parts, { text: marker }, style)
  else if (Array.isArray(message.content)) {
    const block = family === "bedrock" ? { text: marker } : { type: family === "responses" ? "input_text" : "text", text: marker }
    prependStyledBlock(message.content, block, style)
  } else message.content = prependText(message.content, marker)
}

function isHumanMessage(message, family) {
  const role = message.role ?? (family === "gemini" ? "user" : "")
  if (role !== "user") return false
  const blocks = family === "gemini" ? message.parts : message.content
  if (!Array.isArray(blocks)) return typeof blocks === "string"
  return blocks.some((block) => isObject(block) && block.type !== "tool_result" && !block.toolResult && !block.functionResponse && !block.function_response)
}

function historyText(message, family) {
  let text = blocksText(family === "gemini" ? message.parts : message.content)
  if (message.type === "function_call") text += typeof message.arguments === "string" ? message.arguments : JSON.stringify(message.arguments ?? "")
  if (message.type === "function_call_output") text += typeof message.output === "string" ? message.output : blocksText(message.output)
  return text
}

function blocksText(blocks) {
  if (typeof blocks === "string") return blocks
  if (!Array.isArray(blocks)) return ""
  let text = ""
  for (const block of blocks) {
    if (!isObject(block)) continue
    if (typeof block.text === "string") text += block.text
    if (typeof block.thinking === "string") text += block.thinking
    if (block.type === "tool_result" || block.type === "search_result") text += blocksText(block.content)
    if (block.type === "tool_use") text += JSON.stringify(block.input ?? {})
    if (block.toolUse) text += JSON.stringify(block.toolUse.input ?? {})
    if (block.toolResult) text += blocksText(block.toolResult.content)
    if (block.json !== undefined) text += JSON.stringify(block.json)
    if (block.functionCall) text += JSON.stringify(block.functionCall.args ?? {})
    if (block.functionResponse) text += JSON.stringify(block.functionResponse.response ?? {})
  }
  return text
}

function cleanBlocks(blocks, state, bedrock = false) {
  if (!Array.isArray(blocks)) return
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]
    if (!isObject(block)) continue
    const hadCachePoint = bedrock && Object.prototype.hasOwnProperty.call(block, "cachePoint")
    if (hadCachePoint) removeKeys(block, ["cachePoint"], state)
    removeKeys(block, BLOCK_ANNOTATIONS, state)
    if (hadCachePoint && Object.keys(block).length === 0) {
      blocks.splice(index, 1)
      continue
    }
    if (block.type === "tool_result" || block.type === "search_result") {
      cleanBlocks(block.content, state)
    }
    if (bedrock) cleanBlocks(block.toolResult?.content, state, true)
  }
}

function removeKeys(object, keys, state) {
  if (!isObject(object)) return
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue
    delete object[key]
    state.removed[key] = (state.removed[key] || 0) + 1
  }
}

function hasCachedContent(body, protocol) {
  return protocolFamily(protocol) === "gemini" && !!(body.cachedContent || body.cached_content)
}

function canPrepend(body, protocol) {
  if (protocol === "anthropic") return body.system == null || typeof body.system === "string" || Array.isArray(body.system)
  if (protocol === "bedrock") return body.system == null || Array.isArray(body.system)
  if (protocol === "ollama-generate") return body.raw !== true && (body.system == null || typeof body.system === "string")
  if (protocol === "responses") return body.instructions == null || typeof body.instructions === "string"
  if (["chat", "cohere", "ollama-chat"].includes(protocol)) {
    if (!Array.isArray(body.messages)) return false
    const first = body.messages[0]
    return !isInstruction(first) || typeof first.content === "string" || (protocol !== "ollama-chat" && Array.isArray(first.content))
  }
  for (const key of ["systemInstruction", "system_instruction"]) {
    const instruction = body[key]
    if (instruction != null && (!isObject(instruction) || (instruction.parts !== undefined && !Array.isArray(instruction.parts)))) return false
  }
  return true
}

function hasPlainTextStart(content) {
  if (typeof content === "string") return content.trim().length > 0
  const first = Array.isArray(content) ? content[0] : null
  return isObject(first) && (first.type === undefined || first.type === "text" || first.type === "input_text") && !first.signature && !first.thoughtSignature && !first.thought_signature && typeof first.text === "string" && first.text.trim().length > 0
}

function hasWhitespaceTarget(body, protocol) {
  if (protocol === "anthropic" || protocol === "bedrock" || protocol === "ollama-generate") return hasPlainTextStart(body.system)
  if (protocol === "responses") return hasPlainTextStart(body.instructions)
  if (["chat", "cohere", "ollama-chat"].includes(protocol)) return isInstruction(body.messages?.[0]) && hasPlainTextStart(body.messages[0].content)
  const instructions = [body.systemInstruction, body.system_instruction].filter((value) => value != null)
  return instructions.length > 0 && instructions.every((value) => hasPlainTextStart(value.parts))
}

function prependStyledBlock(blocks, block, style) {
  if (style === "whitespace") blocks[0].text = prependText(blocks[0].text, block.text)
  else prependBlock(blocks, block)
}

function prepend(body, protocol, marker, style) {
  if (protocol === "anthropic") {
    if (Array.isArray(body.system)) prependStyledBlock(body.system, { type: "text", text: marker }, style)
    else body.system = prependText(body.system, marker)
  } else if (protocol === "bedrock") {
    if (body.system == null) body.system = []
    prependStyledBlock(body.system, { text: marker }, style)
  } else if (protocol === "ollama-generate") {
    body.system = prependText(body.system, marker)
  } else if (protocol === "responses") {
    body.instructions = prependText(body.instructions, marker)
  } else if (["chat", "cohere", "ollama-chat"].includes(protocol)) {
    const first = body.messages[0]
    if (!isInstruction(first)) body.messages.unshift({ role: "system", content: marker })
    else if (Array.isArray(first.content)) prependStyledBlock(first.content, { type: "text", text: marker }, style)
    else first.content = prependText(first.content, marker)
  } else {
    const keys = ["systemInstruction", "system_instruction"].filter((key) => body[key] != null)
    if (!keys.length) keys.push("systemInstruction")
    for (const key of keys) {
      body[key] = body[key] || {}
      body[key].parts = body[key].parts || []
      prependStyledBlock(body[key].parts, { text: marker }, style)
    }
  }
}

function prependText(text, marker) {
  if (text === marker || (typeof text === "string" && text.startsWith(marker + "\n"))) return text
  return text ? marker + "\n" + text : marker
}

function prependBlock(blocks, block) {
  if (blocks[0]?.text !== block.text) blocks.unshift(block)
}

function isInstruction(message) {
  return isObject(message) && (message.role === "system" || message.role === "developer")
}

function observe(body, ctx) {
  const state = ctx.state.cacheControl
  if (!state || !isObject(body)) return
  const usages = [body.usage, body.message?.usage, body.response?.usage, body.usageMetadata, body.usage_metadata, body.metadata?.usage, body.delta?.usage]
  const previousRead = state.cacheReadTokens
  const previousWrite = state.cacheWriteTokens
  const previousInput = state.inputTokens
  const responses = protocolFamily(ctx.protocol) === "responses"
  for (const usage of usages) {
    if (!isObject(usage)) continue
    const reads = [
      usage.cache_read_input_tokens, usage.prompt_cache_hit_tokens,
      usage.prompt_tokens_details?.cached_tokens, usage.input_tokens_details?.cached_tokens,
      usage.cachedContentTokenCount, usage.cached_content_token_count, usage.total_cached_tokens,
      usage.cacheReadInputTokens,
    ]
    const writes = [
      usage.cache_creation_input_tokens, usage.prompt_tokens_details?.cache_write_tokens,
      usage.input_tokens_details?.cache_write_tokens,
      usage.cacheWriteInputTokens,
    ]
    state.cacheReadTokens = largest(state.cacheReadTokens, reads)
    state.cacheWriteTokens = largest(state.cacheWriteTokens, writes)
    if (responses) state.inputTokens = largest(state.inputTokens, [usage.input_tokens])
  }
  if (previousRead !== state.cacheReadTokens || previousWrite !== state.cacheWriteTokens || previousInput !== state.inputTokens) report(ctx, "usage")
}

function largest(current, values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) current = current === null ? value : Math.max(current, value)
  }
  return current
}

function report(ctx, phase, force = false) {
  const state = ctx.state.cacheControl
  if (!state.log && !force) return
  console.log(JSON.stringify({
    plugin: "cache-control", phase, protocol: ctx.protocol, mode: state.mode,
    provider: ctx.provider?.id ?? state.providerId ?? null, policyScope: state.policyScope ?? "default", removed: state.removed,
    salted: state.salted, explicitOnly: state.explicitOnly,
    cacheReadTokens: state.cacheReadTokens, cacheWriteTokens: state.cacheWriteTokens,
    inputTokens: state.inputTokens,
    cacheHitPercent: state.inputTokens > 0 && state.cacheReadTokens !== null && state.cacheReadTokens <= state.inputTokens
      ? 100 * state.cacheReadTokens / state.inputTokens : null,
    outcome: state.cacheReadTokens === null ? "unknown" : state.cacheReadTokens > 0 ? "hit" : "reported-zero",
    warnings: state.warnings,
    rotation: state.rotation,
  }))
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

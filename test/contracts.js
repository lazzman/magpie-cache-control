function ensure(condition, message = "assertion failed") {
  if (!condition) throw new Error(message)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function equal(actual, expected) {
  const left = JSON.stringify(canonical(actual))
  const right = JSON.stringify(canonical(expected))
  ensure(left === right, "expected " + right + ", got " + left)
}

function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

function context(protocol, options = {}) {
  const ctx = { protocol, options: { mode: "bust", log: false, ...options }, state: {}, provider: { id: "test", model: "model" } }
  ctx.reject = (status, message) => { ctx.rejected = { status, message } }
  return ctx
}

function markerOf(ctx) {
  const marker = ctx.state.cacheControl.marker
  ensure(/^\[magpie-cache-control:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+\]$/.test(marker), "invalid marker")
  return marker
}

function requestFor(protocol) {
  if (protocol === "anthropic") return { model: "model", system: "original", messages: [{ role: "user", content: "hello" }] }
  if (protocol === "chat") return { model: "model", messages: [{ role: "developer", content: "original" }, { role: "user", content: "hello" }] }
  if (protocol === "responses") return { model: "model", instructions: "original", input: "hello" }
  return { model: "model", systemInstruction: { parts: [{ text: "original" }] }, contents: [{ role: "user", parts: [{ text: "hello" }] }] }
}

export function contractCases(plugin) {
  const cases = []
  const add = (name, run) => cases.push({ name, run })

  for (const protocol of ["anthropic", "chat", "responses", "gemini"]) {
    add(protocol + ": passthrough leaves all fields and response untouched", () => {
      const ctx = context(protocol, { mode: "passthrough" })
      const body = { ...requestFor(protocol), cache_control: { type: "ephemeral" }, prompt_cache_key: "key", cachedContent: "cachedContents/one" }
      const original = copy(body)
      ensure(plugin.onRequest(body, ctx) === undefined)
      ensure(plugin.onProvider(body, ctx) === undefined)
      equal(body, original)
      const response = { usage: { cache_read_input_tokens: 23 } }
      ensure(plugin.onResponse(response, ctx) === undefined)
      equal(ctx.state, {})
    })
    add(protocol + ": disable-explicit removes controls without adding a prompt", () => {
      const ctx = context(protocol, { mode: "disable-explicit" })
      const original = requestFor(protocol)
      const body = { ...copy(original), cache_control: {}, prompt_cache_key: "shared", prompt_cache_retention: "24h", prompt_cache_options: { mode: "implicit" } }
      equal(plugin.onRequest(body, ctx), original)
      equal(plugin.onProvider(copy(body), ctx), original)
      ensure(ctx.state.cacheControl.salted === false)
    })
    add(protocol + ": bust changes each independent request", () => {
      const seen = new Set()
      for (let index = 0; index < 64; index++) {
        const ctx = context(protocol)
        const body = requestFor(protocol)
        plugin.onRequest(body, ctx)
        const marker = markerOf(ctx)
        ensure(!seen.has(marker), "marker reused across requests")
        seen.add(marker)
        const text = protocol === "anthropic" ? body.system : protocol === "responses" ? body.instructions : protocol === "chat" ? body.messages[0].content : body.systemInstruction.parts[0].text
        ensure(text.startsWith(marker))
      }
    })
    add(protocol + ": provider retries reuse the marker without accumulating it", () => {
      const ctx = context(protocol)
      const body = plugin.onRequest(requestFor(protocol), ctx)
      const first = copy(body)
      equal(plugin.onProvider(copy(body), ctx), first)
      ctx.provider = { id: "fallback", model: "different" }
      equal(plugin.onProvider(copy(body), ctx), first)
      equal(plugin.onProvider(body, ctx), first)
    })
    add(protocol + ": provider pass removes markers added after onRequest", () => {
      const ctx = context(protocol)
      const body = plugin.onRequest(requestFor(protocol), ctx)
      body.cache_control = { type: "ephemeral" }
      const result = plugin.onProvider(body, ctx)
      ensure(!Object.hasOwn(result, "cache_control"))
    })
  }

  add("Anthropic: preserves blocks, tools, schemas, tool inputs, history and signatures", () => {
    const schema = { type: "object", properties: { cache_control: { type: "string" }, nested: { const: { cache_control: "data" } } } }
    const ctx = context("anthropic")
    const body = {
      model: "group/any", stream: true, tool_choice: { type: "auto" }, max_tokens: 100,
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: "original", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "tool", input_schema: schema, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "reason", signature: "signed" }, { type: "tool_use", id: "one", name: "tool", input: { cache_control: "argument", content: [{ cache_control: "data" }] } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "one", cache_control: {}, content: [{ type: "search_result", title: "result", source: "test", content: [{ type: "text", text: "result", cache_control: {} }] }] }] },
      ],
    }
    const expected = copy(body)
    delete expected.cache_control
    delete expected.system[0].cache_control
    delete expected.tools[0].cache_control
    delete expected.messages[1].content[0].cache_control
    delete expected.messages[1].content[0].content[0].content[0].cache_control
    plugin.onRequest(body, ctx)
    expected.system.unshift({ type: "text", text: markerOf(ctx) })
    equal(body, expected)
  })

  for (const system of [undefined, null, "", []]) {
    add("Anthropic: creates a prompt for " + JSON.stringify(system), () => {
      const ctx = context("anthropic")
      const body = { messages: [], ...(system === undefined ? {} : { system }) }
      plugin.onRequest(body, ctx)
      if (Array.isArray(system)) equal(body.system, [{ type: "text", text: markerOf(ctx) }])
      else equal(body.system, markerOf(ctx))
    })
  }

  for (const role of ["system", "developer"]) {
    add("Chat: preserves " + role + " multipart instructions and images", () => {
      const ctx = context("chat")
      const parts = [{ type: "text", text: "original", cache_control: {} }, { type: "image_url", image_url: { url: "data:image/png;base64,abc" } }]
      const body = { messages: [{ role, content: copy(parts) }, { role: "user", content: "hi" }] }
      plugin.onRequest(body, ctx)
      delete parts[0].cache_control
      equal(body.messages[0], { role, content: [{ type: "text", text: markerOf(ctx) }, ...parts] })
      equal(body.messages[1], { role: "user", content: "hi" })
    })
  }
  add("Chat: creates system message before user history", () => {
    const ctx = context("chat")
    const history = [{ role: "user", content: "question" }, { role: "assistant", content: "answer" }]
    const body = { messages: copy(history), tools: [], tool_choice: "none" }
    plugin.onRequest(body, ctx)
    equal(body.messages, [{ role: "system", content: markerOf(ctx) }, ...history])
    equal(body.tool_choice, "none")
  })
  add("Chat: handles empty message list", () => {
    const ctx = context("chat")
    const body = { messages: [] }
    plugin.onRequest(body, ctx)
    equal(body.messages, [{ role: "system", content: markerOf(ctx) }])
  })

  for (const instructions of [undefined, null, ""]) {
    add("Responses: creates instructions for " + JSON.stringify(instructions), () => {
      const ctx = context("responses")
      const body = { input: "question", ...(instructions === undefined ? {} : { instructions }) }
      plugin.onRequest(body, ctx)
      equal(body.instructions, markerOf(ctx))
    })
  }
  add("Responses: keeps server state and tool payloads while removing breakpoints", () => {
    const ctx = context("responses")
    const body = {
      previous_response_id: "response-one", conversation: "conversation-one", store: true,
      input: [
        { role: "developer", content: [{ type: "input_text", text: "guidance", prompt_cache_breakpoint: { mode: "explicit" } }] },
        { type: "function_call_output", call_id: "call-one", output: { prompt_cache_breakpoint: "business data" } },
        { type: "additional_tools", tools: [{ type: "function", name: "run", cache_control: {}, parameters: { properties: { cache_control: { type: "string" } } } }] },
      ],
    }
    const expected = copy(body)
    delete expected.input[0].content[0].prompt_cache_breakpoint
    delete expected.input[2].tools[0].cache_control
    plugin.onRequest(body, ctx)
    expected.instructions = markerOf(ctx)
    equal(body, expected)
  })

  for (const key of ["systemInstruction", "system_instruction"]) {
    add("Gemini: preserves " + key + " role, parts and function arguments", () => {
      const ctx = context("gemini")
      const body = { [key]: { role: "system", parts: [{ text: "original" }] }, contents: [{ role: "model", parts: [{ functionCall: { name: "run", args: { cache_control: "value" } } }] }] }
      const expected = copy(body)
      plugin.onRequest(body, ctx)
      expected[key].parts.unshift({ text: markerOf(ctx) })
      equal(body, expected)
    })
  }
  for (const instruction of [undefined, null, {}, { role: "system" }, { parts: [] }]) {
    add("Gemini: handles missing parts " + JSON.stringify(instruction), () => {
      const ctx = context("gemini")
      const body = { contents: [], ...(instruction === undefined ? {} : { systemInstruction: instruction }) }
      plugin.onRequest(body, ctx)
      equal(body.systemInstruction.parts, [{ text: markerOf(ctx) }])
    })
  }
  add("Gemini: handles both instruction spellings without dropping either", () => {
    const ctx = context("gemini")
    const body = { systemInstruction: { parts: [{ text: "camel" }] }, system_instruction: { parts: [{ text: "snake" }] } }
    plugin.onRequest(body, ctx)
    ensure(body.systemInstruction.parts[1].text === "camel")
    ensure(body.system_instruction.parts[1].text === "snake")
    ensure(body.systemInstruction.parts[0].text === markerOf(ctx))
  })
  for (const key of ["cachedContent", "cached_content"]) {
    for (const mode of ["disable-explicit", "bust"]) {
      add("Gemini: rejects " + key + " without losing referenced context in " + mode, () => {
        const ctx = context("gemini", { mode })
        const body = { contents: [], [key]: "cachedContents/one" }
        const original = copy(body)
        plugin.onRequest(body, ctx)
        ensure(ctx.rejected.status === 409)
        equal(body, original)
      })
    }
    add("Gemini: drops " + key + " only with explicit opt-in", () => {
      const ctx = context("gemini", { cachedContent: "drop" })
      const body = { [key]: "cachedContents/one", contents: [{ role: "user", parts: [{ text: "full context" }] }] }
      plugin.onRequest(body, ctx)
      ensure(!Object.hasOwn(body, key))
      equal(ctx.state.cacheControl.warnings, ["cached-content-dropped"])
      equal(body.contents[0].parts[0].text, "full context")
    })
  }
  add("Gemini: empty cache references are removed without rejection", () => {
    const ctx = context("gemini")
    const body = { contents: [], cachedContent: "", cached_content: null }
    plugin.onRequest(body, ctx)
    ensure(!ctx.rejected)
    ensure(!Object.hasOwn(body, "cachedContent") && !Object.hasOwn(body, "cached_content"))
  })
  add("Gemini: provider-stage reference added later is preserved with warning", () => {
    const ctx = context("gemini")
    const body = plugin.onRequest({ contents: [] }, ctx)
    body.cachedContent = "cachedContents/late"
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body.cachedContent, "cachedContents/late")
    ensure(ctx.state.cacheControl.warnings.includes("provider-stage-cached-content-preserved"))
  })

  add("Cache key: rotates an existing key, without adding it to other APIs", () => {
    const ctx = context("responses")
    const body = { instructions: "original", input: [], prompt_cache_key: "shared" }
    plugin.onRequest(body, ctx)
    equal(body.prompt_cache_key, markerOf(ctx))
    const first = copy(body)
    equal(plugin.onProvider(body, ctx), first)
    const plainCtx = context("responses")
    const plain = plugin.onRequest({ input: [] }, plainCtx)
    ensure(!Object.hasOwn(plain, "prompt_cache_key"))
  })
  add("OpenAI: explicit-only control is opt-in and limited to Responses", () => {
    const ctx = context("responses", { mode: "disable-explicit", openaiExplicitProviders: ["native-openai"] })
    const body = plugin.onRequest({ input: [], prompt_cache_options: { mode: "implicit", ttl: "12h" } }, ctx)
    ensure(!Object.hasOwn(body, "prompt_cache_options"))
    ctx.provider = { id: "native-openai" }
    equal(plugin.onProvider(copy(body), ctx).prompt_cache_options, { mode: "explicit" })
    ensure(ctx.state.cacheControl.explicitOnly)
    ctx.provider = { id: "other" }
    ensure(!Object.hasOwn(plugin.onProvider(copy(body), ctx), "prompt_cache_options"))
    ensure(!ctx.state.cacheControl.explicitOnly)
    const chatCtx = context("chat", { openaiExplicitProviders: ["test"] })
    const chat = plugin.onRequest({ messages: [] }, chatCtx)
    ensure(!Object.hasOwn(plugin.onProvider(chat, chatCtx), "prompt_cache_options"))
  })
  add("Provider hook works without request-hook state", () => {
    const ctx = context("anthropic")
    const body = plugin.onProvider({ system: "original" }, ctx)
    equal(body.system, markerOf(ctx) + "\noriginal")
  })

  const invalidOptions = [[], "bust", { mode: "off" }, { mode: null }, { log: "true" }, { cachedContent: "remove" }, { openaiExplicitProviders: "openai" }, { openaiExplicitProviders: [""] }, { openaiExplicitProviders: [null] }, { unknown: true }]
  for (const options of invalidOptions) {
    add("Invalid options are rejected: " + JSON.stringify(options), () => {
      const ctx = context("responses")
      ctx.options = options
      const body = { input: [], prompt_cache_key: "original" }
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected.status === 400)
      equal(body, original)
      ensure(plugin.onProvider(body, ctx) === undefined)
    })
  }
  for (const options of [undefined, null, {}]) {
    add("Absent options leave requests and usage untouched: " + JSON.stringify(options), () => {
      const ctx = context("responses")
      ctx.options = options
      const body = { input: [], instructions: "original", prompt_cache_key: "original", cache_control: {} }
      const original = copy(body)
      ensure(plugin.onRequest(body, ctx) === undefined)
      ensure(plugin.onProvider(body, ctx) === undefined)
      plugin.onEvent({ usage: { cache_read_input_tokens: 50 } }, ctx)
      plugin.onResponse({ usage: { cache_read_input_tokens: 50 } }, ctx)
      equal(body, original)
      equal(ctx.state, {})
    })
  }
  const invalidPrompts = [
    ["anthropic", { system: {} }], ["responses", { instructions: [] }],
    ["chat", {}], ["chat", { messages: [{ role: "system", content: null }] }],
    ["gemini", { systemInstruction: "text" }], ["gemini", { system_instruction: { parts: "text" } }],
  ]
  for (const [protocol, body] of invalidPrompts) {
    add("Rejects malformed " + protocol + " prompt " + JSON.stringify(body), () => {
      const ctx = context(protocol)
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected.status === 400)
      equal(body, original)
    })
  }
  add("Rejects invalid body before mutation", () => {
    for (const body of [null, [], "prompt"]) {
      const ctx = context("chat")
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected.status === 400)
    }
  })
  add("Unknown protocols remain unchanged and explicitly warn", () => {
    const ctx = context("unknown")
    const body = { system: "original", cache_control: {} }
    ensure(plugin.onRequest(body, ctx) === undefined)
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body, { system: "original", cache_control: {} })
    equal(ctx.state.cacheControl.warnings, ["unsupported-protocol"])
  })
  add("Provider-stage malformed prompt is preserved and warns", () => {
    const ctx = context("responses")
    plugin.onRequest({ input: [] }, ctx)
    const body = { input: [], instructions: {} }
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body, { input: [], instructions: {} })
    ensure(ctx.state.cacheControl.warnings.includes("provider-stage-unsupported-system-prompt"))
  })

  const usages = [
    ["anthropic", { usage: { cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } }, 100, 50],
    ["anthropic", { message: { usage: { cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }, 100, 0],
    ["chat", { usage: { prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 } } }, 30, 10],
    ["responses", { response: { usage: { input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 } } } }, 30, 10],
    ["gemini", { usageMetadata: { cachedContentTokenCount: 123 } }, 123, null],
    ["gemini", { usage_metadata: { cached_content_token_count: 9 } }, 9, null],
    ["chat", { usage: { prompt_cache_hit_tokens: 15 } }, 15, null],
    ["gemini", { usage: { total_cached_tokens: 88 } }, 88, null],
    ["chat", { usage: { prompt_tokens_details: { cached_tokens: 0 } } }, 0, null],
    ["chat", { usage: { prompt_tokens: 100 } }, null, null],
    ["chat", { usage: { prompt_tokens_details: { cached_tokens: "100" }, cache_creation_input_tokens: -1 } }, null, null],
  ]
  for (const [protocol, response, reads, writes] of usages) {
    add("Observes usage without editing: " + JSON.stringify(response), () => {
      const ctx = context(protocol)
      plugin.onRequest(requestFor(protocol), ctx)
      const original = copy(response)
      ensure(plugin.onResponse(response, ctx) === undefined)
      ensure(plugin.onEvent(response, ctx) === undefined)
      equal(response, original)
      equal(ctx.state.cacheControl.cacheReadTokens, reads)
      equal(ctx.state.cacheControl.cacheWriteTokens, writes)
    })
  }
  add("Streaming: repeated cumulative counts are not added together", () => {
    const ctx = context("anthropic")
    plugin.onRequest(requestFor("anthropic"), ctx)
    for (const count of [50, 50, 0, 75, 20]) plugin.onEvent({ usage: { cache_read_input_tokens: count } }, ctx)
    equal(ctx.state.cacheControl.cacheReadTokens, 75)
    for (const event of [null, "done", {}, { usage: null }, { usage: { cache_read_input_tokens: Infinity } }]) plugin.onEvent(event, ctx)
    equal(ctx.state.cacheControl.cacheReadTokens, 75)
  })
  add("Request state is isolated across concurrent lifecycles", () => {
    const first = context("chat")
    const second = context("chat")
    plugin.onRequest(requestFor("chat"), first)
    plugin.onRequest(requestFor("chat"), second)
    plugin.onEvent({ usage: { prompt_tokens_details: { cached_tokens: 55 } } }, first)
    equal(second.state.cacheControl.cacheReadTokens, null)
    ensure(markerOf(first) !== markerOf(second))
  })
  const adapters = [
    ["anthropic-messages", { system: "guide", messages: [] }, (body) => body.system],
    ["chat-completions", { messages: [{ role: "system", content: "guide" }] }, (body) => body.messages[0].content],
    ["openai-chat", { messages: [{ role: "developer", content: "guide" }] }, (body) => body.messages[0].content],
    ["openai-compatible", { messages: [{ role: "user", content: "question" }] }, (body) => body.messages[0].content],
    ["openai-responses", { instructions: "guide", input: [] }, (body) => body.instructions],
    ["vertex", { systemInstruction: { parts: [{ text: "guide" }] }, contents: [] }, (body) => body.systemInstruction.parts[0].text],
    ["vertex-gemini", { system_instruction: { parts: [{ text: "guide" }] }, contents: [] }, (body) => body.system_instruction.parts[0].text],
    ["bedrock", { system: [{ text: "guide" }], messages: [] }, (body) => body.system[0].text],
    ["bedrock-converse", { messages: [] }, (body) => body.system[0].text],
    ["cohere", { messages: [{ role: "system", content: "guide" }] }, (body) => body.messages[0].content],
    ["cohere-v2", { messages: [{ role: "user", content: "question" }] }, (body) => body.messages[0].content],
    ["ollama-chat", { messages: [{ role: "user", content: "question", images: ["base64-data"] }] }, (body) => body.messages[0].content],
    ["ollama-generate", { system: "guide", prompt: "question", context: [1, 2], keep_alive: "5m" }, (body) => body.system],
  ]
  for (const [protocol, original, prompt] of adapters) {
    add(protocol + ": new adapter defaults to no modifications or statistics", () => {
      const ctx = context(protocol)
      ctx.options = {}
      const body = copy(original)
      ensure(plugin.onRequest(body, ctx) === undefined)
      ensure(plugin.onProvider(body, ctx) === undefined)
      plugin.onResponse({ usage: { cacheReadInputTokens: 10 } }, ctx)
      equal(body, original)
      equal(ctx.state, {})
    })
    add(protocol + ": explicit-only cleanup preserves the original prompt and payload", () => {
      const ctx = context(protocol, { mode: "disable-explicit" })
      const body = { ...copy(original), cache_control: {}, prompt_cache_retention: "24h" }
      equal(plugin.onRequest(body, ctx), original)
      equal(plugin.onProvider(copy(body), ctx), original)
      ensure(ctx.state.cacheControl.salted === false)
    })
    add(protocol + ": nonce prepending is idempotent across attempts", () => {
      const ctx = context(protocol)
      const body = copy(original)
      ensure(plugin.onRequest(body, ctx) === body)
      ensure(!ctx.rejected)
      ensure(prompt(body).startsWith(markerOf(ctx)))
      const first = copy(body)
      equal(plugin.onProvider(body, ctx), first)
      ctx.provider = { id: "fallback" }
      equal(plugin.onProvider(copy(body), ctx), first)
      const other = context(protocol)
      plugin.onRequest(copy(original), other)
      ensure(markerOf(ctx) !== markerOf(other))
    })
  }

  add("Bedrock: drops whole checkpoint union blocks while preserving tools and tool-result JSON", () => {
    const checkpoint = { cachePoint: { type: "default", ttl: "1h" } }
    const spec = { name: "lookup", inputSchema: { json: { type: "object", properties: { cachePoint: { type: "string" }, cache_control: { type: "string" } } } } }
    const toolUse = { toolUse: { toolUseId: "one", name: "lookup", input: { cachePoint: "argument", cache_control: "argument" } } }
    const toolResult = { toolResult: { toolUseId: "one", content: [{ json: { cachePoint: { type: "default" }, cache_control: "business data" } }] } }
    const body = {
      system: [{ text: "guide" }, copy(checkpoint)],
      messages: [
        { role: "assistant", content: [copy(toolUse), copy(checkpoint)] },
        { role: "user", content: [copy(toolResult), { text: "hello" }, copy(checkpoint)] },
      ],
      toolConfig: { tools: [{ toolSpec: copy(spec) }, copy(checkpoint)], toolChoice: { auto: {} } },
      additionalModelRequestFields: { cache_control: { type: "ephemeral" }, thinking: { type: "enabled", budget_tokens: 1024 }, business: { cache_control: "keep" } },
    }
    const ctx = context("bedrock-converse")
    plugin.onRequest(body, ctx)
    equal(body.system, [{ text: markerOf(ctx) }, { text: "guide" }])
    equal(body.messages[0].content, [toolUse])
    equal(body.messages[1].content, [toolResult, { text: "hello" }])
    equal(body.toolConfig, { tools: [{ toolSpec: spec }], toolChoice: { auto: {} } })
    equal(body.additionalModelRequestFields, { thinking: { type: "enabled", budget_tokens: 1024 }, business: { cache_control: "keep" } })
    equal(ctx.state.cacheControl.removed.cachePoint, 4)
    ensure(!JSON.stringify(body).includes('"content":[{}]'))
  })

  add("Bedrock: explicit mode removes checkpoints without adding a new system block", () => {
    const ctx = context("bedrock", { mode: "disable-explicit" })
    const body = { system: [{ text: "keep" }, { cachePoint: { type: "default" } }], messages: [{ role: "user", content: [{ text: "question" }, { cachePoint: { type: "default" } }] }] }
    plugin.onRequest(body, ctx)
    equal(body, { system: [{ text: "keep" }], messages: [{ role: "user", content: [{ text: "question" }] }] })
  })

  for (const system of [undefined, null, []]) {
    add("Bedrock: initializes missing system blocks " + JSON.stringify(system), () => {
      const ctx = context("bedrock-converse")
      const body = system === undefined ? { messages: [] } : { messages: [], system }
      plugin.onRequest(body, ctx)
      equal(body.system, [{ text: markerOf(ctx) }])
    })
  }

  for (const [protocol, body] of [
    ["bedrock", { system: "InvokeModel is a different protocol", messages: [] }],
    ["ollama-generate", { raw: true, prompt: "raw prompt", system: "guide" }],
    ["ollama-generate", { prompt: "question", system: {} }],
    ["ollama-chat", { messages: [{ role: "system", content: [] }] }],
    ["cohere-v2", { messages: [{ role: "system", content: null }] }],
    ["vertex-gemini", { contents: [], systemInstruction: "invalid" }],
  ]) {
    add(protocol + ": rejects unsupported shape before touching request " + JSON.stringify(body), () => {
      const ctx = context(protocol)
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 400)
      equal(body, original)
    })
  }

  add("Ollama: generates an optional system prompt without modifying model residency or conversation state", () => {
    const ctx = context("ollama-generate")
    const body = { prompt: "question", context: [1, 5, 9], keep_alive: 0, template: "{{ .System }} {{ .Prompt }}", options: { num_ctx: 8192 } }
    const expected = copy(body)
    plugin.onRequest(body, ctx)
    expected.system = markerOf(ctx)
    equal(body, expected)
  })

  add("Cohere v2: preserves tools, documents, citations and multi-part system content", () => {
    const ctx = context("cohere-v2")
    const body = { model: "command", messages: [{ role: "system", content: [{ type: "text", text: "guide" }] }, { role: "user", content: "question" }], tools: [{ type: "function", function: { name: "run", parameters: { properties: { cache_control: { type: "string" } } } } }], documents: [{ id: "one", data: { cache_control: "document data" } }], citation_options: { mode: "accurate" } }
    const expected = copy(body)
    plugin.onRequest(body, ctx)
    expected.messages[0].content.unshift({ type: "text", text: markerOf(ctx) })
    equal(body, expected)
  })

  for (const protocol of ["vertex", "vertex-gemini"]) {
    add(protocol + ": cachedContent is protected and only dropped with opt-in", () => {
      const original = { cachedContent: "projects/one/locations/global/cachedContents/one", contents: [] }
      const ctx = context(protocol)
      const body = copy(original)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 409)
      equal(body, original)
      const allowed = context(protocol, { cachedContent: "drop" })
      plugin.onRequest(body, allowed)
      ensure(!Object.hasOwn(body, "cachedContent"))
      ensure(body.systemInstruction.parts[0].text === markerOf(allowed))
    })
  }

  add("Expanded adapters: usage wrappers preserve unknown statistics as unknown", () => {
    const ctx = context("bedrock-converse")
    plugin.onRequest({ messages: [] }, ctx)
    for (const event of [
      { usage: { cacheReadInputTokens: 10, cacheWriteInputTokens: 20 } },
      { metadata: { usage: { cacheReadInputTokens: 15, cacheWriteInputTokens: 30 } } },
      { delta: { usage: { cacheReadInputTokens: 15, cacheWriteInputTokens: 30 } } },
    ]) {
      const original = copy(event)
      ensure(plugin.onEvent(event, ctx) === undefined)
      equal(event, original)
    }
    equal(ctx.state.cacheControl.cacheReadTokens, 15)
    equal(ctx.state.cacheControl.cacheWriteTokens, 30)
    for (const protocol of ["ollama-chat", "cohere-v2"]) {
      const fresh = context(protocol)
      plugin.onRequest({ messages: [] }, fresh)
      plugin.onResponse({ prompt_eval_count: 99, usage: { billed_units: { input_tokens: 20 }, tokens: { input_tokens: 100 } } }, fresh)
      equal(fresh.state.cacheControl.cacheReadTokens, null)
    }
  })

  add("Chat vendor names are not treated as native protocol identifiers", () => {
    for (const protocol of ["deepseek", "qwen", "openrouter", "ollama", "cohere-v1"]) {
      const ctx = context(protocol)
      const body = { messages: [], cache_control: {} }
      const original = copy(body)
      ensure(plugin.onRequest(body, ctx) === undefined)
      equal(body, original)
      equal(ctx.state.cacheControl.warnings, ["unsupported-protocol"])
    }
  })

  function historyFor(family, count) {
    const messages = []
    for (let index = 0; index < count; index++) {
      const content = index === 0 ? "first question" : "next question " + index
      if (family === "gemini") messages.push({ role: "user", parts: [{ text: content }] })
      else if (family === "bedrock") messages.push({ role: "user", content: [{ text: content }] })
      else messages.push({ role: "user", content })
      if (index < count - 1) {
        if (family === "gemini") messages.push({ role: "model", parts: [{ text: "answer" }] })
        else if (family === "bedrock") messages.push({ role: "assistant", content: [{ text: "answer" }] })
        else messages.push({ role: "assistant", content: "answer" })
      }
    }
    return family === "gemini" ? { contents: messages } : family === "responses" ? { input: messages } : { messages }
  }

  for (const [protocol, family] of [
    ["anthropic", "anthropic"], ["chat", "chat"], ["responses", "responses"], ["openai-responses", "responses"],
    ["gemini", "gemini"], ["vertex-gemini", "gemini"], ["bedrock-converse", "bedrock"], ["cohere-v2", "chat"], ["ollama-chat", "chat"],
  ]) {
    add(protocol + ": initial turns pass unchanged, then every request perturbs the fixed tail boundary", () => {
      const markers = []
      for (const turns of [1, 2, 3, 3, 4, 5]) {
        const ctx = context(protocol, { rotation: { strategy: "turns", turns: 2 } })
        const body = historyFor(family, turns)
        const expected = copy(body)
        ensure(plugin.onRequest(body, ctx) === body)
        ensure(!ctx.rejected)
        equal(ctx.state.cacheControl.rotation.turns, turns)
        equal(ctx.state.cacheControl.rotation.phase, turns <= 2 ? "allow-cache" : "bust-tail")
        equal(ctx.state.cacheControl.salted, turns > 2)
        if (turns > 2) {
          markers.push(markerOf(ctx))
          const history = family === "gemini" ? expected.contents : family === "responses" ? expected.input : expected.messages
          if (family === "gemini") history[4].parts.unshift({ text: markerOf(ctx) })
          else if (family === "bedrock") history[4].content.unshift({ text: markerOf(ctx) })
          else history[4].content = markerOf(ctx) + "\n" + history[4].content
          equal(ctx.state.cacheControl.rotation.boundaryTurn, 3)
        }
        equal(body, expected)
        const first = copy(body)
        equal(plugin.onProvider(copy(body), ctx), first)
        equal(plugin.onProvider(body, ctx), first)
      }
      ensure(new Set(markers).size === markers.length)
    })
  }

  add("Threshold policies preserve early cache controls, system instructions and the original routing key", () => {
    const body = { ...historyFor("responses", 3), instructions: "guide", cache_control: { type: "ephemeral" }, prompt_cache_options: { mode: "implicit" }, prompt_cache_retention: "24h", prompt_cache_key: "session", inputExtra: { keep: true } }
    body.input[0].content = [{ type: "input_text", text: "first question", prompt_cache_breakpoint: { mode: "explicit" } }]
    const ctx = context("responses", { rotation: { strategy: "turns", turns: 2 }, openaiExplicitProviders: ["test"] })
    plugin.onRequest(body, ctx)
    const first = copy(body)
    plugin.onProvider(body, ctx)
    equal(body, first)
    equal(body.cache_control, { type: "ephemeral" })
    equal(body.prompt_cache_options, { mode: "implicit" })
    equal(body.prompt_cache_retention, "24h")
    equal(body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" })
    equal(body.prompt_cache_key, "session")
    equal(body.instructions, "guide")
    ensure(body.input[4].content.startsWith(markerOf(ctx)))
    equal(ctx.state.cacheControl.removed, {})
    ensure(!ctx.state.cacheControl.explicitOnly)
    ensure(ctx.state.cacheControl.warnings.includes("explicit-only-paused-for-text-perturbation"))
    ensure(markerOf(ctx).length <= 64)
  })

  add("Initial Bedrock history and cache checkpoints remain completely unchanged", () => {
    const ctx = context("bedrock-converse", { rotation: { strategy: "turns", turns: 3 } })
    const body = historyFor("bedrock", 1)
    body.messages[0].content.push({ cachePoint: { type: "default" } })
    body.toolConfig = { tools: [{ cachePoint: { type: "default" } }] }
    plugin.onRequest(body, ctx)
    equal(body.messages[0].content[1], { cachePoint: { type: "default" } })
    equal(body.toolConfig.tools[0], { cachePoint: { type: "default" } })
  })

  add("At or below the token allowance requests pass through; above it each request has a fresh tail nonce", () => {
    const markers = []
    const messages = []
    for (const [role, content] of [["user", "abcd"], ["assistant", "abcd"], ["user", "abcd"], ["assistant", "12345678901234567890"]]) {
      messages.push({ role, content })
      const ctx = context("chat", { rotation: { strategy: "tokens", tokens: 10 } })
      const body = { messages: copy(messages) }
      const expected = copy(body)
      plugin.onRequest(body, ctx)
      ensure(!ctx.rejected)
      equal(ctx.state.cacheControl.rotation.estimatedTokens, [5, 10, 15, 24][messages.length - 1])
      if (messages.length <= 2) {
        equal(body, expected)
        equal(ctx.state.cacheControl.rotation.phase, "allow-cache")
      } else {
        markers.push(markerOf(ctx))
        equal(ctx.state.cacheControl.rotation.boundaryTurn, 2)
        expected.messages[2].content = markerOf(ctx) + "\n" + expected.messages[2].content
        equal(body, expected)
      }
    }
    ensure(markers[0] !== markers[1])
  })

  add("Token estimates count Unicode code points and omit static prompts and media bytes", () => {
    const ctx = context("chat", { rotation: { strategy: "tokens", tokens: 100 } })
    const body = { messages: [{ role: "system", content: "x".repeat(10000) }, { role: "user", content: [{ type: "text", text: "你好😀abcd" }, { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(10000) } }] }], tools: [{ schema: "x".repeat(10000) }] }
    plugin.onRequest(body, ctx)
    equal(ctx.state.cacheControl.rotation.estimatedTokens, 8)
    equal(ctx.state.cacheControl.rotation.turns, 1)
  })

  add("Tool round trips do not count as new user turns", () => {
    const fixtures = [
      ["anthropic", { messages: [{ role: "user", content: "first" }, { role: "assistant", content: [{ type: "tool_use", input: { query: "hello" } }] }, { role: "user", content: [{ type: "tool_result", content: "result" }] }] }],
      ["bedrock-converse", { messages: [{ role: "user", content: [{ text: "first" }] }, { role: "assistant", content: [{ toolUse: { input: { query: "hello" } } }] }, { role: "user", content: [{ toolResult: { content: [{ json: { found: true } }] } }] }] }],
      ["gemini", { contents: [{ role: "user", parts: [{ text: "first" }] }, { role: "model", parts: [{ functionCall: { args: { query: "hello" } } }] }, { role: "user", parts: [{ functionResponse: { response: { found: true } } }] }] }],
      ["responses", { input: [{ role: "user", content: "first" }, { type: "function_call", arguments: "{}" }, { type: "function_call_output", output: "result" }] }],
    ]
    for (const [protocol, body] of fixtures) {
      const ctx = context(protocol, { rotation: { strategy: "turns", turns: 1 } })
      plugin.onRequest(body, ctx)
      ensure(!ctx.rejected)
      equal(ctx.state.cacheControl.rotation.turns, 1)
      equal(ctx.state.cacheControl.rotation.phase, "allow-cache")
      ensure(ctx.state.cacheControl.salted === false)
      ensure(ctx.state.cacheControl.rotation.estimatedTokens > 5)
    }
  })

  add("Repeated identical post-threshold requests never reuse a tail marker or change the original cache key", () => {
    const markers = []
    for (let index = 0; index < 16; index++) {
      const ctx = context("chat", { rotation: { strategy: "turns", turns: 2 } })
      const body = { ...historyFor("chat", 4), prompt_cache_key: "original" }
      const prefix = copy(body.messages.slice(0, 4))
      plugin.onRequest(body, ctx)
      markers.push(markerOf(ctx))
      equal(body.messages.slice(0, 4), prefix)
      equal(body.prompt_cache_key, "original")
      ensure(body.messages[4].content.startsWith(markerOf(ctx)))
    }
    ensure(new Set(markers).size === 16)
  })

  for (const [protocol, body] of [
    ["responses", { input: "latest only", previous_response_id: "hidden" }],
    ["responses", { input: [], conversation: { id: "hidden" } }],
    ["responses", { input: [{ type: "item_reference", id: "hidden" }] }],
    ["gemini", { contents: [], cachedContent: "cachedContents/hidden" }],
    ["ollama-chat", { messages: [], context: [1, 2] }],
    ["ollama-generate", { prompt: "question" }],
    ["chat", { messages: [{ role: "assistant", content: "no user" }] }],
  ]) {
    add(protocol + ": schedule rejects hidden or insufficient history before mutation " + JSON.stringify(body), () => {
      const ctx = context(protocol, { rotation: { strategy: "turns" }, cachedContent: "drop" })
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 409)
      equal(body, original)
    })
  }

  for (const rotation of [null, [], "turns", { strategy: "hours" }, { strategy: null }, { turns: 0 }, { turns: 1.5 }, { turns: 1000001 }, { tokens: -1 }, { tokens: "1000" }, { tokens: 1000000001 }, { unknown: true }]) {
    add("Invalid rotation configuration is rejected: " + JSON.stringify(rotation), () => {
      const ctx = context("chat", { rotation })
      const body = historyFor("chat", 1)
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 400)
      equal(body, original)
    })
  }

  add("Scheduled preferences alone do not activate control or affect disable-explicit", () => {
    for (const mode of ["passthrough", "disable-explicit"]) {
      const ctx = context("responses", { mode, rotation: { strategy: "turns" } })
      const body = { previous_response_id: "hidden", input: "latest" }
      plugin.onRequest(body, ctx)
      ensure(!ctx.rejected)
      equal(body, { previous_response_id: "hidden", input: "latest" })
    }
  })

  add("Provider hook alone preserves unavailable scheduled history and warns", () => {
    const ctx = context("responses", { rotation: { strategy: "tokens" } })
    const body = { input: "latest", previous_response_id: "hidden" }
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(ctx.state.cacheControl.warnings, ["provider-stage-rotation-history-unavailable"])
    equal(body, { input: "latest", previous_response_id: "hidden" })
  })

  add("A hidden history reference added after planning is not silently accepted by the provider hook", () => {
    const ctx = context("responses", { rotation: { strategy: "turns", turns: 2 } })
    const body = historyFor("responses", 1)
    plugin.onRequest(body, ctx)
    body.previous_response_id = "added-later"
    const original = copy(body)
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body, original)
    ensure(ctx.state.cacheControl.warnings.includes("provider-stage-rotation-history-unavailable"))
  })

  add("First ten turns remain cacheable; every request from turn eleven onward perturbs only the fixed tail", () => {
    const markers = []
    for (const turns of [10, 11, 12, 12, 21, 22]) {
      const ctx = context("chat", { rotation: { strategy: "turns", turns: 10 } })
      const body = { ...historyFor("chat", turns), prompt_cache_key: "same-conversation", cache_control: { type: "ephemeral" }, tools: [{ name: "keep", cache_control: {} }] }
      body.messages.unshift({ role: "system", content: "stable system prompt" })
      const expected = copy(body)
      plugin.onRequest(body, ctx)
      if (turns > 10) {
        markers.push(markerOf(ctx))
        expected.messages[21].content = markerOf(ctx) + "\n" + expected.messages[21].content
        equal(ctx.state.cacheControl.rotation.boundaryTurn, 11)
      }
      equal(body, expected)
      equal(body.prompt_cache_key, "same-conversation")
    }
    ensure(markers.length === 5 && new Set(markers).size === 5)
  })

  add("Responses multipart tail receives input_text while the first cached turn remains untouched", () => {
    const ctx = context("responses", { rotation: { strategy: "turns", turns: 1 } })
    const body = { instructions: "unchanged", input: [{ role: "user", content: [{ type: "input_text", text: "first", prompt_cache_breakpoint: { mode: "explicit" } }] }, { role: "assistant", content: "answer" }, { role: "user", content: [{ type: "input_text", text: "second" }, { type: "input_image", image_url: "image" }] }] }
    const expected = copy(body)
    plugin.onRequest(body, ctx)
    expected.input[2].content.unshift({ type: "input_text", text: markerOf(ctx) })
    equal(body, expected)
  })

  add("A tool-result-only user message is never chosen as the first uncached human turn", () => {
    const ctx = context("anthropic", { rotation: { strategy: "turns", turns: 1 } })
    const body = { system: "unchanged", messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "tool_use", id: "one", name: "lookup", input: { query: "first" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "one", content: "result" }] },
      { role: "assistant", content: "answer" },
      { role: "user", content: [{ type: "text", text: "second" }, { type: "image", source: { type: "base64", data: "keep" } }] },
    ] }
    const expected = copy(body)
    plugin.onRequest(body, ctx)
    expected.messages[4].content.unshift({ type: "text", text: markerOf(ctx) })
    equal(body, expected)
  })

  add("Token crossing inside an assistant answer is safely anchored at the start of that user turn", () => {
    const ctx = context("chat", { rotation: { strategy: "tokens", tokens: 10 } })
    const body = { messages: [{ role: "user", content: "abcd" }, { role: "assistant", content: "a".repeat(100) }] }
    const expected = copy(body)
    plugin.onRequest(body, ctx)
    equal(ctx.state.cacheControl.rotation.boundaryTurn, 1)
    expected.messages[0].content = markerOf(ctx) + "\n" + expected.messages[0].content
    equal(body, expected)
  })

  add("Responses plain input stays a plain string when a token cutoff perturbs its first turn", () => {
    const ctx = context("responses", { rotation: { strategy: "tokens", tokens: 1 } })
    const body = { instructions: "keep", input: "long question" }
    plugin.onRequest(body, ctx)
    equal(body, { instructions: "keep", input: markerOf(ctx) + "\nlong question" })
    const first = copy(body)
    equal(plugin.onProvider(body, ctx), first)
  })

  add("Unsupported tail shapes are rejected before mutation and provider boundary removal is warned", () => {
    const malformed = context("gemini", { rotation: { strategy: "tokens", tokens: 1 } })
    const invalid = { contents: [{ role: "user", parts: "invalid" }] }
    const original = copy(invalid)
    plugin.onRequest(invalid, malformed)
    ensure(malformed.rejected?.status === 409)
    equal(invalid, original)
    const ctx = context("chat", { rotation: { strategy: "turns", turns: 1 } })
    const body = historyFor("chat", 2)
    plugin.onRequest(body, ctx)
    body.messages.pop()
    const truncated = copy(body)
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body, truncated)
    ensure(ctx.state.cacheControl.warnings.includes("provider-stage-rotation-history-unavailable"))
  })

  const styledRequests = [
    ["anthropic", { system: "guide", messages: [] }, "system-string"],
    ["anthropic", { system: [{ type: "text", text: "guide" }], messages: [] }, "system-blocks"],
    ["chat", { messages: [{ role: "developer", content: "guide" }, { role: "user", content: "question" }] }, "chat-string"],
    ["chat", { messages: [{ role: "system", content: [{ type: "text", text: "guide" }] }] }, "chat-blocks"],
    ["responses", { instructions: "guide", input: "question" }, "instructions"],
    ["gemini", { systemInstruction: { parts: [{ text: "guide" }] }, contents: [] }, "gemini"],
    ["vertex-gemini", { system_instruction: { parts: [{ text: "guide" }] }, contents: [] }, "vertex"],
    ["bedrock-converse", { system: [{ text: "guide" }], messages: [] }, "bedrock"],
    ["cohere-v2", { messages: [{ role: "system", content: "guide" }] }, "chat-string"],
    ["ollama-chat", { messages: [{ role: "system", content: "guide" }] }, "chat-string"],
    ["ollama-generate", { system: "guide", prompt: "question", keep_alive: 0 }, "system-string"],
  ]

  function expectStyle(marker, style) {
    const expression = style === "marker" ? /^\[magpie-cache-control:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+\]$/ : style === "punctuation" ? /^[.,:;!?~|]+$/ : /^[ \t]+$/
    ensure(expression.test(marker), "wrong perturbation alphabet for " + style)
    ensure(marker.length > 0 && marker.length < 512)
  }

  for (const style of ["marker", "punctuation", "whitespace"]) {
    for (const [protocol, original, kind] of styledRequests) {
      add(protocol + ": per-request " + style + " text preserves payload and is idempotent (" + kind + ")", () => {
        const ctx = context(protocol, { rotation: { style } })
        const body = copy(original)
        plugin.onRequest(body, ctx)
        ensure(!ctx.rejected)
        const marker = ctx.state.cacheControl.marker
        expectStyle(marker, style)
        equal(ctx.state.cacheControl.rotation.style, style)
        const expected = copy(original)
        if (kind === "system-string") expected.system = marker + "\nguide"
        else if (kind === "instructions") expected.instructions = marker + "\nguide"
        else if (kind === "chat-string") expected.messages[0].content = marker + "\nguide"
        else {
          const blocks = kind === "chat-blocks" ? expected.messages[0].content : kind === "gemini" ? expected.systemInstruction.parts : kind === "vertex" ? expected.system_instruction.parts : expected.system
          if (style === "whitespace") {
            blocks[0].text = marker + "\nguide"
            ensure(blocks[0].text.trim().length > 0)
            equal(blocks.length, 1)
          } else blocks.unshift(["system-blocks", "chat-blocks"].includes(kind) ? { type: "text", text: marker } : { text: marker })
        }
        equal(body, expected)
        equal(plugin.onProvider(body, ctx), expected)
        equal(plugin.onProvider(copy(body), ctx), expected)
      })
    }

    add(style + ": front ten turns remain untouched and every later request has a unique perturbation", () => {
      const seen = new Set()
      for (const turns of [10, 11, 11, 12, 21]) {
        const ctx = context("chat", { rotation: { strategy: "turns", turns: 10, style } })
        const body = { ...historyFor("chat", turns), prompt_cache_key: "original-key" }
        const expected = copy(body)
        plugin.onRequest(body, ctx)
        if (turns > 10) {
          const marker = ctx.state.cacheControl.marker
          expectStyle(marker, style)
          ensure(!seen.has(marker), "reused perturbation")
          seen.add(marker)
          expected.messages[20].content = marker + "\n" + expected.messages[20].content
        }
        equal(body, expected)
        equal(body.prompt_cache_key, "original-key")
        equal(plugin.onProvider(body, ctx), expected)
      }
      equal(seen.size, 4)
    })

    add(style + ": existing request cache key remains bounded ASCII metadata", () => {
      const ctx = context("responses", { rotation: { style } })
      const body = { instructions: "guide", input: [], prompt_cache_key: "original" }
      plugin.onRequest(body, ctx)
      ensure(body.prompt_cache_key.length <= 64)
      ensure(/^\[magpie-cache-control:[a-z0-9:]+\]$/.test(body.prompt_cache_key))
      const first = copy(body)
      equal(plugin.onProvider(body, ctx), first)
    })
  }

  for (const [protocol, body] of [
    ["anthropic", { system: [], messages: [] }],
    ["chat", { messages: [{ role: "user", content: "question" }] }],
    ["responses", { input: "question" }],
    ["gemini", { systemInstruction: { parts: [{ inlineData: { data: "image" } }] }, contents: [] }],
    ["anthropic", { system: [{ type: "text", text: "signed", signature: "keep" }], messages: [] }],
    ["vertex-gemini", { systemInstruction: { parts: [{ text: "signed", thoughtSignature: "keep" }] }, contents: [] }],
  ]) {
    add(protocol + ": whitespace rejects missing or signed first text before cleanup", () => {
      const ctx = context(protocol, { rotation: { style: "whitespace" } })
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 400)
      equal(body, original)
    })
  }

  add("Threshold whitespace merges into the existing first text block without creating whitespace-only blocks", () => {
    for (const protocol of ["anthropic", "responses", "bedrock-converse", "gemini"]) {
      const ctx = context(protocol, { rotation: { strategy: "turns", turns: 1, style: "whitespace" } })
      const first = protocol === "gemini" ? { role: "user", parts: [{ text: "first" }] } : { role: "user", content: protocol === "bedrock-converse" ? [{ text: "first" }] : "first" }
      const text = { ...(protocol === "anthropic" ? { type: "text", cache_control: { type: "ephemeral" } } : protocol === "responses" ? { type: "input_text", prompt_cache_breakpoint: { mode: "explicit" } } : {}), text: "second" }
      const tail = protocol === "gemini" ? { role: "user", parts: [text] } : { role: "user", content: [text] }
      const body = protocol === "gemini" ? { contents: [first, tail] } : protocol === "responses" ? { input: [first, tail] } : { messages: [first, tail] }
      const expected = copy(body)
      plugin.onRequest(body, ctx)
      ensure(!ctx.rejected)
      const history = expected.contents || expected.input || expected.messages
      const blocks = history[1].parts || history[1].content
      blocks[0].text = ctx.state.cacheControl.marker + "\nsecond"
      equal(blocks.length, 1)
      equal(body, expected)
      equal(plugin.onProvider(body, ctx), expected)
    }
  })

  add("Whitespace fails explicitly for media-first uncached history and does not silently switch style", () => {
    const original = { messages: [{ role: "user", content: "first" }, { role: "user", content: [{ type: "image_url", image_url: { url: "image" } }, { type: "text", text: "second" }] }] }
    const ctx = context("chat", { rotation: { strategy: "turns", turns: 1, style: "whitespace" } })
    const body = copy(original)
    plugin.onRequest(body, ctx)
    ensure(ctx.rejected?.status === 409)
    equal(body, original)
    const warmup = context("chat", { rotation: { strategy: "turns", turns: 2, style: "whitespace" } })
    ensure(plugin.onRequest(copy(original), warmup))
    ensure(!warmup.rejected)
    equal(warmup.state.cacheControl.salted, false)
  })

  add("Text perturbation wins over configured provider-specific cache suppression for all timings", () => {
    for (const strategy of ["request", "turns", "tokens"]) {
      const ctx = context("responses", { openaiExplicitProviders: ["test"], rotation: { strategy, turns: 1, tokens: 1, style: "punctuation" } })
      const body = { instructions: "guide", ...historyFor("responses", 2) }
      plugin.onRequest(body, ctx)
      plugin.onProvider(body, ctx)
      ensure(!Object.hasOwn(body, "prompt_cache_options"))
      ensure(!ctx.state.cacheControl.explicitOnly)
      ensure(ctx.state.cacheControl.warnings.includes("explicit-only-paused-for-text-perturbation"))
    }
  })

  for (const style of [null, "native", "", 1, {}, []]) {
    add("Invalid text perturbation style is rejected: " + JSON.stringify(style), () => {
      const ctx = context("chat", { rotation: { style } })
      const body = historyFor("chat", 2)
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 400)
      equal(body, original)
    })
  }

  add("Provider policies defer all request changes until the actual routed provider is known", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: { mode: "bust", rotation: { style: "punctuation" } }, beta: { mode: "passthrough" } } })
    const original = { ...requestFor("chat"), cache_control: { type: "ephemeral" }, prompt_cache_key: "key" }
    const body = copy(original)
    ensure(plugin.onRequest(body, ctx) === undefined)
    equal(body, original)
    equal(ctx.state, {})
    ctx.provider = { id: "alpha", name: "Alpha" }
    const first = plugin.onProvider(copy(body), ctx)
    const marker = ctx.state.cacheControl.marker
    ensure(/^[.,:;!?~|]+$/.test(marker))
    ensure(first.messages[0].content.startsWith(marker))
    ensure(!Object.hasOwn(first, "cache_control"))
    ctx.provider = { id: "beta" }
    const off = copy(body)
    ensure(plugin.onProvider(off, ctx) === undefined)
    equal(off, original)
    ensure(ctx.state.cacheControl === undefined)
    ctx.provider = { id: "alpha" }
    equal(plugin.onProvider(copy(body), ctx), first)
    equal(ctx.state.cacheControl.marker, marker)
  })

  add("Default and independent provider policies stay off unless explicitly enabled", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: {}, beta: { rotation: { strategy: "turns", turns: 10 } }, off: { mode: "passthrough" } } })
    const original = requestFor("chat")
    ensure(plugin.onRequest(copy(original), ctx) === undefined)
    for (const id of ["alpha", "beta", "off", "unconfigured"]) {
      ctx.provider = { id }
      const body = copy(original)
      ensure(plugin.onProvider(body, ctx) === undefined)
      equal(body, original)
      ensure(ctx.state.cacheControl === undefined)
    }
  })

  add("Provider-specific turn allowances and styles do not leak across routing failover", () => {
    const ctx = context("chat", { mode: "passthrough", providers: {
      alpha: { mode: "bust", rotation: { strategy: "turns", turns: 1, style: "marker" } },
      beta: { mode: "bust", rotation: { strategy: "turns", turns: 2, style: "whitespace" } },
    } })
    const base = { ...historyFor("chat", 3), prompt_cache_key: "stable" }
    plugin.onRequest(copy(base), ctx)
    ctx.provider = { id: "alpha" }
    const first = plugin.onProvider(copy(base), ctx)
    const firstState = ctx.state.cacheControl
    equal(firstState.rotation.boundaryTurn, 2)
    equal(first.messages.slice(0, 2), base.messages.slice(0, 2))
    ensure(first.messages[2].content.startsWith(firstState.marker))
    ctx.provider = { id: "beta" }
    const second = plugin.onProvider(copy(base), ctx)
    const secondState = ctx.state.cacheControl
    ensure(secondState !== firstState)
    equal(secondState.rotation.boundaryTurn, 3)
    ensure(/^[ \t]+$/.test(secondState.marker))
    equal(second.messages.slice(0, 4), base.messages.slice(0, 4))
    ensure(second.messages[4].content.startsWith(secondState.marker))
    equal(second.prompt_cache_key, "stable")
    ctx.provider = { id: "alpha" }
    equal(plugin.onProvider(copy(base), ctx), first)
  })

  add("A provider within its own allowance remains unchanged after another provider exceeded its limit", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: { mode: "bust", rotation: { strategy: "turns", turns: 1 } }, beta: { mode: "bust", rotation: { strategy: "turns", turns: 10 } } } })
    const base = historyFor("chat", 2)
    plugin.onRequest(copy(base), ctx)
    ctx.provider = { id: "alpha" }
    plugin.onProvider(copy(base), ctx)
    ensure(ctx.state.cacheControl.salted)
    ctx.provider = { id: "beta" }
    equal(plugin.onProvider(copy(base), ctx), base)
    equal(ctx.state.cacheControl.rotation.phase, "allow-cache")
    ensure(!ctx.state.cacheControl.salted)
  })

  add("Explicit provider off and empty policies override a previously enabled global default", () => {
    const ctx = context("chat", { mode: "bust", rotation: { strategy: "turns", turns: 10 }, providers: { off: { mode: "passthrough" }, empty: {}, immediate: { mode: "bust" } } })
    const base = { ...requestFor("chat"), cache_control: {} }
    ensure(plugin.onRequest(copy(base), ctx) === undefined)
    for (const id of ["off", "empty"]) {
      ctx.provider = { id }
      const body = copy(base)
      ensure(plugin.onProvider(body, ctx) === undefined)
      equal(body, base)
    }
    ctx.provider = { id: "immediate" }
    ensure(plugin.onProvider(copy(base), ctx).messages[0].content !== base.messages[0].content)
    equal(ctx.state.cacheControl.rotation.strategy, "request")
    ctx.provider = { id: "unconfigured" }
    equal(plugin.onProvider(copy(base), ctx), base)
    equal(ctx.state.cacheControl.policyScope, "default")
  })

  add("Policies match exact routed ids, not names, models or requested group aliases", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: { mode: "bust" } } })
    const base = { ...requestFor("chat"), model: "alpha/group" }
    plugin.onRequest(copy(base), ctx)
    for (const provider of [{ id: "beta", name: "alpha", model: "alpha/model" }, { id: "ALPHA" }, {}, undefined]) {
      ctx.provider = provider
      const body = copy(base)
      ensure(plugin.onProvider(body, ctx) === undefined)
      equal(body, base)
    }
  })

  add("Off provider completions cannot update the last active provider statistics", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: { mode: "bust" } } })
    const base = requestFor("chat")
    plugin.onRequest(copy(base), ctx)
    ctx.provider = { id: "alpha" }
    plugin.onProvider(copy(base), ctx)
    const state = ctx.state.cacheControl
    plugin.onResponse({ usage: { prompt_tokens_details: { cached_tokens: 12 } } }, ctx)
    equal(state.cacheReadTokens, 12)
    ctx.provider = { id: "beta" }
    plugin.onProvider(copy(base), ctx)
    plugin.onResponse({ usage: { prompt_tokens_details: { cached_tokens: 99 } } }, ctx)
    equal(state.cacheReadTokens, 12)
    ctx.provider = { id: "alpha" }
    plugin.onProvider(copy(base), ctx)
    equal(ctx.state.cacheControl.cacheReadTokens, null)
  })

  add("Provider map special property names are treated as literal ids", () => {
    const providers = JSON.parse('{"__proto__":{"mode":"bust"},"constructor":{"mode":"passthrough"}}')
    const ctx = context("chat", { mode: "passthrough", providers })
    const body = requestFor("chat")
    plugin.onRequest(copy(body), ctx)
    ctx.provider = { id: "__proto__" }
    ensure(plugin.onProvider(copy(body), ctx).messages[0].content !== body.messages[0].content)
    ctx.provider = { id: "constructor" }
    ensure(plugin.onProvider(copy(body), ctx) === undefined)
    ctx.provider = { id: "toString" }
    ensure(plugin.onProvider(copy(body), ctx) === undefined)
  })

  add("Provider-stage failures preserve inputs, report a skipped policy and do not affect off providers", () => {
    const ctx = context("responses", { mode: "passthrough", providers: { alpha: { mode: "bust", rotation: { strategy: "turns", turns: 10 } }, beta: { mode: "passthrough" } } })
    const base = { input: "private latest only", previous_response_id: "private hidden reference" }
    ensure(plugin.onRequest(copy(base), ctx) === undefined)
    ensure(!ctx.rejected)
    ctx.provider = { id: "beta" }
    ensure(plugin.onProvider(copy(base), ctx) === undefined)
    ctx.provider = { id: "alpha" }
    const body = copy(base)
    ensure(plugin.onProvider(body, ctx) === undefined)
    equal(body, base)
    ensure(!ctx.state.cacheControl.salted)
    ensure(ctx.state.cacheControl.warnings.includes("provider-stage-rotation-history-unavailable"))
  })

  add("Provider-specific native settings apply only to the selected provider and native mode", () => {
    const ctx = context("responses", { mode: "passthrough", providers: {
      alpha: { mode: "disable-explicit", openaiExplicitProviders: ["alpha"] },
      beta: { mode: "bust", openaiExplicitProviders: ["beta"], rotation: { style: "punctuation" } },
    } })
    const base = { instructions: "guide", input: "question" }
    plugin.onRequest(copy(base), ctx)
    ctx.provider = { id: "alpha" }
    equal(plugin.onProvider(copy(base), ctx).prompt_cache_options, { mode: "explicit" })
    ctx.provider = { id: "beta" }
    ensure(!Object.hasOwn(plugin.onProvider(copy(base), ctx), "prompt_cache_options"))
    ensure(!ctx.state.cacheControl.explicitOnly)
  })

  for (const providers of [null, [], "alpha", { alpha: null }, { alpha: [] }, { alpha: { mode: "unknown" } }, { alpha: { providers: {} } }, { "": {} }, { " ": {} }, { alpha: { rotation: { turns: 0 } } }]) {
    add("Invalid provider configuration is rejected before any rewrite: " + JSON.stringify(providers), () => {
      const ctx = context("chat", { mode: "passthrough", providers })
      const body = requestFor("chat")
      const original = copy(body)
      plugin.onRequest(body, ctx)
      ensure(ctx.rejected?.status === 400)
      equal(body, original)
    })
  }

  add("Five percent preserves the initial text and uses a fresh marker for each request", () => {
    const markers = new Set()
    const system = "s".repeat(100)
    const input = "u".repeat(100)
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctx = context("responses", { rotation: { strategy: "percent", percent: 5 } })
      const original = { instructions: system, input, prompt_cache_key: "keep", prompt_cache_options: { mode: "explicit" } }
      const body = plugin.onRequest(copy(original), ctx)
      const marker = markerOf(ctx)
      markers.add(marker)
      equal(body, { ...original, instructions: system.slice(0, 10) + "\n" + marker + "\n" + system.slice(10) })
      equal(ctx.state.cacheControl.rotation.prefixTextUnits, 10)
      equal(plugin.onProvider(copy(body), ctx), body)
      equal(plugin.onProvider(copy(original), ctx), body)
    }
    equal(markers.size, 3)
  })

  add("Percentage cutoff respects Unicode and leaves signed Gemini blocks intact", () => {
    const ctx = context("gemini", { rotation: { strategy: "percent", percent: 10, style: "whitespace" } })
    const signed = { text: "signed", thoughtSignature: "keep" }
    const original = { contents: [{ role: "user", parts: [signed, { text: "😀abcdef" }, { inlineData: { data: "keep" } }] }] }
    const body = plugin.onRequest(copy(original), ctx)
    const marker = ctx.state.cacheControl.marker
    equal(body.contents[0].parts, [signed, { text: "\n" + marker + "\n😀abcdef" }, original.contents[0].parts[2]])
    equal(plugin.onProvider(body, ctx), body)
    const unicodeCtx = context("responses", { rotation: { strategy: "percent", percent: 5 } })
    const unicode = plugin.onRequest({ input: "😀abcd" }, unicodeCtx)
    equal(unicode.input, "😀\n" + markerOf(unicodeCtx) + "\nabcd")
  })

  add("A percentage applies only to the selected provider and keeps the 0 and 100 endpoints distinct", () => {
    const ctx = context("chat", { mode: "passthrough", providers: { alpha: { mode: "bust", rotation: { strategy: "percent", percent: 0 } }, beta: { mode: "bust", rotation: { strategy: "percent", percent: 100 } } } })
    const original = { messages: [{ role: "user", content: "question" }] }
    ensure(plugin.onRequest(copy(original), ctx) === undefined)
    ctx.provider = { id: "alpha" }
    const body = plugin.onProvider(copy(original), ctx)
    equal(body.messages[0].content, "\n" + markerOf(ctx) + "\nquestion")
    ctx.provider = { id: "beta" }
    ensure(plugin.onProvider(copy(original), ctx) === undefined)
    ensure(plugin.onProvider({ ...original, previous_response_id: "hidden" }, ctx) === undefined)
  })

  add("Percentage rotation rejects hidden history and invalid percentages before mutation", () => {
    const body = { input: "question", previous_response_id: "hidden" }
    for (const [percent, status] of [[5, 409], [-1, 400], [101, 400], ["5", 400]]) {
      const ctx = context("responses", { rotation: { strategy: "percent", percent } })
      plugin.onRequest(body, ctx)
      equal(ctx.rejected.status, status)
      equal(body, { input: "question", previous_response_id: "hidden" })
    }
  })

  return cases
}

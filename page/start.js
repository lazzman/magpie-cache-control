function connectPageBridge() {
  if (parent === globalThis) throw new Error("Open settings inside Magpie")
  const waiting = new Map()
  const themed = []
  let next = 0
  const paint = (theme) => {
    const root = document.documentElement
    root.dataset.theme = theme.dark ? "dark" : "light"
    root.style.colorScheme = theme.dark ? "dark" : "light only"
    root.lang = theme.lang || "en"
    for (const [key, value] of Object.entries(theme.tokens || {})) root.style.setProperty("--magpie-" + key, value)
  }
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = "cache-control-page:" + ++next
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error("Magpie page bridge timed out"))
    }, 8000)
    waiting.set(id, { resolve, reject, timer })
    parent.postMessage({ magpie: 1, id, method, params }, "*")
  })
  const api = {
    theme: null,
    onTheme(callback) { themed.push(callback) },
    options: {
      get: () => call("options.get"),
      set: (options) => call("options.set", { options }),
    },
    read: (name, params) => call("read", { name, params }),
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.magpie !== 1) return
    const message = event.data
    if (message.event === "theme" && message.data) {
      api.theme = message.data
      paint(message.data)
      for (const callback of themed) callback(message.data)
      return
    }
    const request = waiting.get(message.id)
    if (!request) return
    waiting.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(String(message.error)))
    else request.resolve(message.result)
  })
  api.ready = call("hello").then(({ context, service, visible, ...theme }) => {
    api.theme = theme
    paint(theme)
    return theme
  })
  return api
}

async function startPage() {
  const status = document.getElementById("status")
  const retry = document.getElementById("retryButton")
  const chinese = () => String(globalThis.magpie?.theme?.lang || navigator.language || "zh").toLowerCase().startsWith("zh")
  const failed = () => {
    status.textContent = chinese() ? "请从 Magpie 侧栏重新打开「缓存控制」。若仍未连接，请重新启用插件。" : "Reopen Cache Control from the Magpie sidebar. If it still cannot connect, re-enable the plugin."
    retry.hidden = false
    retry.textContent = chinese() ? "重新连接" : "Reconnect"
    retry.addEventListener("click", () => location.reload())
  }
  try {
    const onService = document.getElementById("modelService")?.content === "1"
    if (onService && !globalThis.magpie) globalThis.magpie = connectPageBridge()
    await magpie.ready
    if (onService) {
      const script = document.createElement("script")
      script.src = "app.js"
      script.addEventListener("error", failed)
      document.head.append(script)
      return
    }
    status.textContent = chinese() ? "正在连接配置页面…" : "Connecting to settings…"
    const options = await magpie.options.get()
    const port = options?.pageServicePort ?? 3489
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid page port")
    let base = magpie.service
    if (!base) {
      const hostname = location.hostname.toLowerCase().replace(/^\[|\]$/g, "")
      if (hostname && hostname !== "localhost" && !hostname.endsWith(".localhost") && hostname !== "::1" && !/^127\./.test(hostname)) throw new Error("Host service forwarding required")
      base = "http://127.0.0.1:" + port + "/"
    }
    const target = new URL("index.html", base)
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid page service")
    target.searchParams.set("bridge", new URL("_magpie/bridge.js", location.href).href)
    location.replace(target.href)
    setTimeout(failed, 8000)
  } catch {
    failed()
  }
}

startPage()

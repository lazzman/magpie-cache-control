async function startPage() {
  const status = document.getElementById("status")
  const retry = document.getElementById("retryButton")
  const chinese = () => String(globalThis.magpie?.theme?.lang || navigator.language || "zh").toLowerCase().startsWith("zh")
  const failed = () => {
    status.textContent = chinese() ? "配置页面服务未连接，请重试或重新启用插件。" : "The settings service is unavailable. Retry or re-enable the plugin."
    retry.hidden = false
    retry.textContent = chinese() ? "重新连接" : "Reconnect"
    retry.addEventListener("click", () => location.reload())
  }
  try {
    await magpie.ready
    if (document.getElementById("modelService")?.content === "1") {
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

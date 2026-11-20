import { createServer } from "node:http"
import { readFile } from "node:fs/promises"

const pageRoot = new URL("../page/", import.meta.url)
const assets = new Map([
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/start.js", ["start.js", "text/javascript; charset=utf-8"]],
])

function modelsURL(address) {
  const url = new URL(address.includes("://") ? address : "http://" + address)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Magpie gateway address")
  if (host === "0.0.0.0") url.hostname = "127.0.0.1"
  else if (host === "::") url.hostname = "[::1]"
  else if (host !== "localhost" && host !== "::1" && !/^127\.\d+\.\d+\.\d+$/.test(host)) throw new Error("Magpie gateway must be local")
  url.pathname = "/v1/models"
  return url.href
}

function bridgeURL(raw) {
  const url = new URL(raw)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[;'"\s]/.test(url.href)) throw new Error("Invalid page bridge")
  if (!/\/_magpie\/plugin\/[A-Za-z0-9_-]+\/_magpie\/bridge\.js$/.test(url.pathname)) throw new Error("Invalid page bridge")
  return url.href
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(value))
}

export async function startPageService({ port = 3489, gatewayAddress = "127.0.0.1:3425", timeout = 3000 } = {}) {
  const endpoint = modelsURL(gatewayAddress)
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Referrer-Policy", "no-referrer")
    const actualPort = server.address()?.port
    const localOrigin = "http://127.0.0.1:" + actualPort
    if (!["127.0.0.1:" + actualPort, "localhost:" + actualPort].includes(request.headers.host)) return json(response, 403, { error: "invalid-host" })
    const origin = request.headers.origin
    if (origin !== undefined && origin !== "null" && origin !== localOrigin && origin !== "http://localhost:" + actualPort) return json(response, 403, { error: "invalid-origin" })
    let url
    try { url = new URL(request.url, localOrigin) } catch { return json(response, 400, { error: "invalid-path" }) }
    if (url.pathname === "/api/model-providers") {
      response.setHeader("Access-Control-Allow-Origin", origin || localOrigin)
      response.setHeader("Vary", "Origin")
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET")
        response.setHeader("Access-Control-Allow-Headers", "X-Magpie-Cache-Control")
        response.writeHead(204)
        return response.end()
      }
      if (request.method !== "GET") return json(response, 405, { error: "read-only" })
      if (request.headers["x-magpie-cache-control"] !== "models") return json(response, 403, { error: "missing-read-header" })
      try {
        const upstream = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(timeout) })
        if (!upstream.ok) throw new Error("Models unavailable")
        const body = await upstream.json()
        const models = body?.data
        if (!Array.isArray(models) || body.has_more === true) throw new Error("Incomplete model list")
        const providers = new Set()
        for (const model of models) {
          if (!model || typeof model.id !== "string" || !model.id.trim() || typeof model.owned_by !== "string" || !model.owned_by.trim()) throw new Error("Invalid model list")
          providers.add(model.owned_by)
        }
        return json(response, 200, { providerIds: [...providers].sort(), modelCount: models.length })
      } catch {
        return json(response, 503, { error: "models-unavailable" })
      }
    }
    if (request.method !== "GET") return json(response, 405, { error: "read-only" })
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        let bridge
        try { bridge = bridgeURL(url.searchParams.get("bridge") || "") } catch { return json(response, 400, { error: "open-from-magpie" }) }
        const source = await readFile(new URL("index.html", pageRoot), "utf8")
        const html = source.replace('name="cache-control-model-service" content=""', 'name="cache-control-model-service" content="1"').replace('src="_magpie/bridge.js"', 'src="' + escapeAttribute(bridge) + '"')
        response.setHeader("Content-Type", "text/html; charset=utf-8")
        response.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'self' " + localOrigin + " " + bridge + "; style-src 'self' " + localOrigin + " 'unsafe-inline'; connect-src 'self' " + localOrigin + "; img-src 'self' " + localOrigin + "; font-src 'self' " + localOrigin)
        return response.end(html)
      }
      const asset = assets.get(url.pathname)
      if (!asset) return json(response, 404, { error: "not-found" })
      const content = await readFile(new URL(asset[0], pageRoot))
      response.setHeader("Content-Type", asset[1])
      response.end(content)
    } catch {
      json(response, 500, { error: "page-unavailable" })
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve() })
  })
  return server
}

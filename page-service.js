import { startPageService } from "./lib/page-service.js"

let started

export const CacheControlPage = async (_input, options = {}) => {
  if (!started) {
    const port = options?.pageServicePort ?? 3489
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid cache control page port")
    started = startPageService({ port, gatewayAddress: process.env.MAGPIE_ADDR || "127.0.0.1:3425" }).catch((error) => {
      started = undefined
      throw error
    })
  }
  await started
  return {}
}

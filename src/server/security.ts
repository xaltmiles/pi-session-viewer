import type { IncomingMessage } from 'node:http'

function hostnameFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('[')) {
    const closingBracket = normalized.indexOf(']')
    return closingBracket > 0 ? normalized.slice(1, closingBracket) : undefined
  }
  return normalized.split(':', 1)[0]
}

export function isAllowedHost(value: string | undefined): boolean {
  // This fork binds 0.0.0.0 so the panel also serves trusted LAN and Tailscale
  // peers; any Host header is therefore accepted, because every /api request
  // still requires the per-instance bearer token (see hasValidBearerToken).
  return hostnameFromHeader(value) !== undefined
}

export function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true

  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:'
      && isAllowedHost(parsed.host)
      && parsed.host.toLowerCase() === request.headers.host?.toLowerCase()
  } catch {
    return false
  }
}

export function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization
  return authorization === `Bearer ${expectedToken}`
}

import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import packageManifest from '../../package.json'
import { configuredSessionRootSync } from './session-discovery'
import { startSessionHttpServer } from './http-server'
import { viewerLanAddresses } from './lan-addresses'

const port = Number.parseInt(process.env.PORT ?? '0', 10)
const token = process.env.PI_SESSION_VIEWER_TOKEN ?? randomBytes(32).toString('base64url')
const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
const server = await startSessionHttpServer({
  sessionRoot: configuredSessionRootSync(),
  webRoot,
  token,
  port,
  version: typeof packageManifest.version === 'string' ? packageManifest.version : '0.2.0',
  currentCwd: process.cwd(),
})

// The first line stays loopback-based (machine-local tools parse it); the
// remote lines advertise the same instance on LAN and Tailscale addresses.
const lines = [`Pi session viewer started at: ${server.url}`]
for (const address of viewerLanAddresses()) {
  lines.push(`${address.kind === 'tailscale' ? 'Tailscale' : 'LAN'}: http://${address.ip}:${server.port}`)
}
process.stdout.write(`${lines.join('\n')}\n`)

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await server.close()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })

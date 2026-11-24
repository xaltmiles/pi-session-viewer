import { randomBytes } from 'node:crypto'
import { startSessionHttpServer, type SessionHttpServer, type SessionHttpServerOptions } from '../server/http-server'
import { viewerLanAddresses, type LanAddress } from '../server/lan-addresses'

export type ServerControllerState = 'stopped' | 'starting' | 'running' | 'stopping'

export type SessionViewerUrlKind = 'local' | 'lan' | 'tailscale'

export interface SessionViewerPanelUrl {
  readonly url: string
  readonly kind: SessionViewerUrlKind
}

export interface SessionViewerPanel {
  readonly host: string
  readonly port: number
  readonly token: string
  readonly url: string
  /** Every address the panel answers on; `url` is the local entry. */
  readonly urls: readonly SessionViewerPanelUrl[]
}

export interface ServerControllerOptions {
  sessionRoot: string
  webRoot: string
  version?: string
  host?: string
  port?: number
  currentCwd?: string
  /** Overrides LAN discovery for the panel URL list; injectable for tests. */
  lanAddresses?: () => LanAddress[]
  startServer?: (options: SessionHttpServerOptions) => Promise<SessionHttpServer>
  createToken?: () => string
  openBrowser?: (url: string) => Promise<void> | void
}

export interface ServerController {
  start(cwd?: string): Promise<SessionViewerPanel>
  stop(): Promise<void>
  getState(): ServerControllerState
}

function defaultToken(): string {
  return randomBytes(32).toString('base64url')
}

function panelFromServer(
  server: SessionHttpServer,
  cwd: string | undefined,
  serverCwd: string | undefined,
  lanAddresses: LanAddress[],
): SessionViewerPanel {
  const hash = new URLSearchParams({ token: server.token })
  if (cwd && cwd !== serverCwd) hash.set('cwd', cwd)
  const suffix = hash.toString()
  const urls: SessionViewerPanelUrl[] = [
    { url: `${server.url}/#${suffix}`, kind: 'local' },
    ...lanAddresses.map((address): SessionViewerPanelUrl => ({
      url: `http://${address.ip}:${server.port}/#${suffix}`,
      kind: address.kind,
    })),
  ]
  return {
    host: server.host,
    port: server.port,
    token: server.token,
    url: urls[0].url,
    urls,
  }
}

export function createServerController(options: ServerControllerOptions): ServerController {
  const startServer = options.startServer ?? startSessionHttpServer
  const createToken = options.createToken ?? defaultToken
  const resolveLanAddresses = options.lanAddresses ?? viewerLanAddresses
  let state: ServerControllerState = 'stopped'
  let server: SessionHttpServer | undefined
  let panel: SessionViewerPanel | undefined
  let serverCwd: string | undefined
  let activeCwd = options.currentCwd
  let startPromise: Promise<SessionViewerPanel> | undefined
  let stopPromise: Promise<void> | undefined

  const stopRunningServer = async (): Promise<void> => {
    const activeServer = server
    server = undefined
    panel = undefined
    serverCwd = undefined
    if (!activeServer) return
    await activeServer.close()
  }

  const start = async (cwd?: string): Promise<SessionViewerPanel> => {
    if (cwd) activeCwd = cwd
    if (panel && state === 'running' && server) return panelFromServer(server, activeCwd, serverCwd, resolveLanAddresses())
    if (startPromise) return startPromise
    if (stopPromise) await stopPromise

    state = 'starting'
    startPromise = (async () => {
      try {
        const serverCwdAtStart = activeCwd
        const started = await startServer({
          sessionRoot: options.sessionRoot,
          webRoot: options.webRoot,
          token: createToken(),
          host: options.host,
          port: options.port,
          version: options.version,
          currentCwd: serverCwdAtStart,
        })
        server = started
        serverCwd = serverCwdAtStart
        panel = panelFromServer(started, activeCwd, serverCwd, resolveLanAddresses())
        state = 'running'
        if (options.openBrowser) {
          try {
            await options.openBrowser(panel.url)
          } catch {
            // Opening a browser is best effort; the URL remains available to copy.
          }
        }
        return panel
      } catch (error) {
        state = 'stopped'
        throw error
      } finally {
        startPromise = undefined
      }
    })()
    return startPromise
  }

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise
    if (startPromise) {
      try {
        await startPromise
      } catch {
        return
      }
    }
    if (!server) {
      state = 'stopped'
      return
    }
    state = 'stopping'
    stopPromise = stopRunningServer().finally(() => {
      state = 'stopped'
      stopPromise = undefined
    })
    return stopPromise
  }

  return {
    start,
    stop,
    getState: () => state,
  }
}

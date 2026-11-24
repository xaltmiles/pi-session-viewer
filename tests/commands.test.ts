import { describe, expect, it } from 'vitest'
import { registerSessionViewerCommand } from '../src/extension/commands'
import { createServerController } from '../src/extension/server-controller'
import type { SessionViewerPanel, ServerController } from '../src/extension/server-controller'

interface RegisteredCommand {
  handler: (args: string, context: unknown) => Promise<void>
}

function commandContext(notifications: string[], cwd?: string): unknown {
  return {
    cwd,
    ui: {
      notify: (message: string) => notifications.push(message),
    },
  }
}

describe('/session-viewer command', () => {
  it('keeps the displayed link short while preserving the current project scope', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    const cwd = '/home/hzf/workspace/projects-dev/pi-extensions-mine/pi-session-viewer'
    const token = 'a'.repeat(43)
    let serverCwd: string | undefined
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      createToken: () => token,
      lanAddresses: () => [],
      startServer: async (options) => {
        serverCwd = options.currentCwd
        return {
          host: '127.0.0.1',
          port: 43210,
          token,
          url: 'http://127.0.0.1:43210',
          close: async () => {},
        }
      },
    })
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('on', commandContext(notifications, cwd))

    expect(serverCwd).toBe(cwd)
    expect(notifications).toEqual([`Viewer started at: http://127.0.0.1:43210/#token=${token}`])
    expect(notifications[0].length).toBeLessThanOrEqual(100)
  })

  it('starts the panel and explains that capture remains enabled', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    const panel: SessionViewerPanel = {
      host: '127.0.0.1',
      port: 43210,
      token: 'a'.repeat(64),
      url: 'http://127.0.0.1:43210/#token=' + 'a'.repeat(64),
      urls: [{ url: 'http://127.0.0.1:43210/#token=' + 'a'.repeat(64), kind: 'local' }],
    }
    const controller: ServerController = {
      start: async () => panel,
      stop: async () => {},
      getState: () => 'stopped',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('on', commandContext(notifications))

    expect(notifications).toEqual(['Viewer started at: http://127.0.0.1:43210/#token=' + 'a'.repeat(64)])
  })

  it('defaults to on when called without arguments', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    const panel: SessionViewerPanel = {
      host: '127.0.0.1',
      port: 43210,
      token: 'a'.repeat(64),
      url: 'http://127.0.0.1:43210/#token=' + 'a'.repeat(64),
      urls: [{ url: 'http://127.0.0.1:43210/#token=' + 'a'.repeat(64), kind: 'local' }],
    }
    const controller: ServerController = {
      start: async () => panel,
      stop: async () => {},
      getState: () => 'stopped',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('', commandContext(notifications))
    await registrations.get('session-viewer')?.handler('   ', commandContext(notifications))

    expect(notifications).toEqual([
      'Viewer started at: http://127.0.0.1:43210/#token=' + 'a'.repeat(64),
      'Viewer started at: http://127.0.0.1:43210/#token=' + 'a'.repeat(64),
    ])
  })

  it('appends one line per remote LAN or Tailscale address', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    const token = 'b'.repeat(43)
    const controller = createServerController({
      sessionRoot: '/tmp/pi-sessions',
      webRoot: '/tmp/pi-web',
      createToken: () => token,
      lanAddresses: () => [
        { ip: '192.168.1.7', kind: 'lan' },
        { ip: '100.64.2.9', kind: 'tailscale' },
      ],
      startServer: async () => ({
        host: '0.0.0.0',
        port: 43211,
        token,
        url: 'http://127.0.0.1:43211',
        close: async () => {},
      }),
    })
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('on', commandContext(notifications))

    expect(notifications).toEqual([
      [
        `Viewer started at: http://127.0.0.1:43211/#token=${token}`,
        `LAN: http://192.168.1.7:43211/#token=${token}`,
        `Tailscale: http://100.64.2.9:43211/#token=${token}`,
      ].join('\n'),
    ])
  })

  it('stops only the panel and notifies user', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    let stopCount = 0
    const controller: ServerController = {
      start: async () => { throw new Error('not used') },
      stop: async () => { stopCount += 1 },
      getState: () => 'running',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('off', commandContext(notifications))

    expect(stopCount).toBe(1)
    expect(notifications).toEqual(['Viewer stopped.'])
  })

  it('returns usage for an unknown argument without changing server state', async () => {
    const registrations = new Map<string, RegisteredCommand>()
    const notifications: string[] = []
    let starts = 0
    let stops = 0
    const controller: ServerController = {
      start: async () => { starts += 1; throw new Error('not used') },
      stop: async () => { stops += 1 },
      getState: () => 'stopped',
    }
    registerSessionViewerCommand({
      registerCommand: (name, command) => registrations.set(name, command as RegisteredCommand),
    }, controller)

    await registrations.get('session-viewer')?.handler('restart', commandContext(notifications))

    expect(starts).toBe(0)
    expect(stops).toBe(0)
    expect(notifications).toEqual(['Usage: /session-viewer on | off'])
  })
})

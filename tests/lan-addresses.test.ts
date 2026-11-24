import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { viewerLanAddresses } from '../src/server/lan-addresses'

type InterfaceTable = ReturnType<typeof os.networkInterfaces>

function info(address: string, family: 'IPv4' | 'IPv6', internal = false): os.NetworkInterfaceInfo {
  if (family === 'IPv6') {
    return { address, netmask: 'ffff:ffff:ffff:ffff::', family, mac: 'aa:bb:cc:dd:ee:ff', internal, cidr: null, scopeid: 0 }
  }
  return { address, netmask: '255.255.255.0', family, mac: 'aa:bb:cc:dd:ee:ff', internal, cidr: null }
}

function interfaces(entries: Record<string, os.NetworkInterfaceInfo[]>): InterfaceTable {
  return () => entries
}

describe('viewer LAN addresses', () => {
  it('classifies Tailscale interfaces by name and CGNAT address', () => {
    const addresses = viewerLanAddresses(interfaces({
      'tailscale0': [info('100.101.5.23', 'IPv4')],
      'eth0': [info('100.115.92.193', 'IPv4')],
    }))

    expect(addresses).toEqual([
      { ip: '100.101.5.23', kind: 'tailscale' },
      { ip: '100.115.92.193', kind: 'tailscale' },
    ])
  })

  it('classifies 10.x and 192.168.x ranges as LAN', () => {
    const addresses = viewerLanAddresses(interfaces({
      'eth0': [info('10.1.2.3', 'IPv4')],
      'wlan0': [info('192.168.1.20', 'IPv4')],
    }))

    expect(addresses).toEqual([
      { ip: '10.1.2.3', kind: 'lan' },
      { ip: '192.168.1.20', kind: 'lan' },
    ])
  })

  it('excludes docker-bridge 172.16.0.0/12 ranges and unclassified addresses', () => {
    const addresses = viewerLanAddresses(interfaces({
      'docker0': [info('172.17.0.1', 'IPv4')],
      'br-f2ca': [info('172.31.200.9', 'IPv4')],
      'eth0': [info('169.254.12.9', 'IPv4'), info('8.8.8.8', 'IPv4')],
    }))

    expect(addresses).toEqual([])
  })

  it('skips internal interfaces and IPv6 addresses', () => {
    const addresses = viewerLanAddresses(interfaces({
      'lo': [info('127.0.0.1', 'IPv4', true)],
      'eth0': [info('fe80::1a2b:3c4d', 'IPv6'), info('192.168.0.7', 'IPv4')],
    }))

    expect(addresses).toEqual([{ ip: '192.168.0.7', kind: 'lan' }])
  })

  it('deduplicates one address reported on several interfaces', () => {
    const addresses = viewerLanAddresses(interfaces({
      'eth0': [info('192.168.1.4', 'IPv4')],
      'eth0:1': [info('192.168.1.4', 'IPv4')],
    }))

    expect(addresses).toEqual([{ ip: '192.168.1.4', kind: 'lan' }])
  })

  it('prefers the interface name over the address range when both apply', () => {
    const addresses = viewerLanAddresses(interfaces({
      'tailscale0': [info('10.9.9.9', 'IPv4')],
    }))

    expect(addresses).toEqual([{ ip: '10.9.9.9', kind: 'tailscale' }])
  })

  it('reads the real interface table without crashing', () => {
    expect(() => viewerLanAddresses()).not.toThrow()
    expect(viewerLanAddresses().every((address) => address.kind === 'lan' || address.kind === 'tailscale')).toBe(true)
  })
})

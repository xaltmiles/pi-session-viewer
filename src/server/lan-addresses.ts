import os from 'node:os'

export type LanAddressKind = 'lan' | 'tailscale'

export interface LanAddress {
  ip: string
  kind: LanAddressKind
}

type NetworkInterfaces = () => ReturnType<typeof os.networkInterfaces>

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets
}

/**
 * Classifies one candidate interface address. Only addresses a peer can
 * actually use to reach this machine's viewer are listed: Tailscale interfaces
 * (by interface name or a 100.64.0.0/10 CGNAT address) and private LAN ranges.
 * The 172.16.0.0/12 range is excluded on purpose — it is where Docker and other
 * container bridges live, and those addresses are not reachable from peers.
 */
function classifyLanAddress(name: string, ip: string): LanAddressKind | null {
  if (/tailscale/i.test(name)) return 'tailscale'
  const octets = ipv4Octets(ip)
  if (!octets) return null
  const [first, second] = octets
  if (first === 100 && second >= 64 && second <= 127) return 'tailscale'
  if (first === 10) return 'lan'
  if (first === 192 && second === 168) return 'lan'
  return null
}

/**
 * The IPv4 addresses a remote peer can use to open this instance's viewer,
 * deduplicated in interface order. `networkInterfaces` is injectable so tests
 * can describe machines without depending on the host's actual interfaces.
 */
export function viewerLanAddresses(networkInterfaces: NetworkInterfaces = os.networkInterfaces): LanAddress[] {
  const addresses: LanAddress[] = []
  const seen = new Set<string>()
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.internal) continue
      const family = String(info.family)
      if (family !== 'IPv4' && family !== '4') continue
      const kind = classifyLanAddress(name, info.address)
      if (!kind || seen.has(info.address)) continue
      seen.add(info.address)
      addresses.push({ ip: info.address, kind })
    }
  }
  return addresses
}

import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import type {
  P2pDiscoveredPeer,
  P2pNetworkStatus,
  P2pShareItem,
  P2pShareSession,
  TransferJob,
} from '../src/types';
import { listAndroidDirectory, pullFromAndroid, pushToAndroid } from './adb';
import { calculateLocalTotalBytes, resolveInputPath } from './localFs';
import { isSshSerial, listSshDirectory, pullFromSsh, pushToSsh } from './ssh';

const execFileAsync = promisify(execFile);

export type CreateJobFn = (
  direction: TransferJob['direction'],
  serial: string,
  sourcePaths: string[],
  targetPath: string,
  summary: string,
  totalBytes?: number
) => TransferJob;

const P2P_TEMP_DIR = path.join(os.tmpdir(), 'droidbridge-p2p');
fs.mkdirSync(P2P_TEMP_DIR, { recursive: true });

const p2pUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(P2P_TEMP_DIR, `up-${crypto.randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = path.basename(file.originalname || `file-${Date.now()}`);
    cb(null, safeName);
  },
});

const p2pUpload = multer({ storage: p2pUploadStorage });

const shareSessions = new Map<string, P2pShareSession>();
let lastHotspotConfig: { ssid: string; password: string } | null = null;

/**
 * Sanitizes a relative file path (e.g. "MyFolder/Sub/file.txt") to prevent path traversal
 */
export function sanitizeRelativePath(rawRelPath: string, fallbackName: string): string {
  const normalized = String(rawRelPath || fallbackName)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const parts = normalized
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '.' && p !== '..');
  if (parts.length === 0) {
    return path.basename(fallbackName || `file-${Date.now()}`);
  }
  return parts.join('/');
}

/**
 * Returns non-internal IPv4 addresses on this machine, prioritizing Wi-Fi / P2P / Hotspot interfaces
 */
export function getLanAddresses(): {
  ip: string;
  iface: string;
  isP2pOrHotspot: boolean;
}[] {
  const nets = os.networkInterfaces();
  const list: { ip: string; iface: string; isP2pOrHotspot: boolean }[] = [];

  for (const [iface, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    // Skip docker/veth/bridge virtual interfaces unless needed
    if (/^(docker|veth|br-|virbr|lo)/i.test(iface)) continue;

    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const isP2pOrHotspot =
          /^(wlan|wlp|p2p|ap|wlx|uap|wi-fi|wireless|local area connection\*)/i.test(iface) ||
          addr.address.startsWith('10.42.0.') ||
          addr.address.startsWith('192.168.43.') ||
          addr.address.startsWith('192.168.49.') ||
          addr.address.startsWith('192.168.137.');
        list.push({
          ip: addr.address,
          iface,
          isP2pOrHotspot,
        });
      }
    }
  }

  // Sort Hotspot subnet (10.42.0.x / 192.168.49.x) first, then Wi-Fi interfaces, then Ethernet
  list.sort((a, b) => {
    const aHotspotIp = a.ip.startsWith('10.42.0.') || a.ip.startsWith('192.168.49.') ? 1 : 0;
    const bHotspotIp = b.ip.startsWith('10.42.0.') || b.ip.startsWith('192.168.49.') ? 1 : 0;
    if (aHotspotIp !== bHotspotIp) return bHotspotIp - aHotspotIp;
    if (a.isP2pOrHotspot !== b.isP2pOrHotspot) return a.isP2pOrHotspot ? -1 : 1;
    return a.iface.localeCompare(b.iface);
  });

  return list;
}

/**
 * Queries Linux NetworkManager (`nmcli`) for Wi-Fi hotspot capability and active AP status
 */
export async function getP2pNetworkStatus(port = 3456): Promise<P2pNetworkStatus> {
  const addresses = getLanAddresses();
  const hotspot: P2pNetworkStatus['hotspot'] = {
    supported: process.platform === 'linux',
    active: false,
  };

  if (process.platform === 'linux') {
    try {
      const { stdout: devOut } = await execFileAsync(
        'nmcli',
        ['-t', '-f', 'DEVICE,TYPE,STATE', 'device'],
        { timeout: 3000 }
      );
      const wifiLine = devOut
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.includes(':wifi:'));

      if (!wifiLine) {
        hotspot.supported = false;
      } else {
        const wifiIface = wifiLine.split(':')[0];
        hotspot.iface = wifiIface;

        const { stdout: activeOut } = await execFileAsync(
          'nmcli',
          ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active'],
          { timeout: 3000 }
        );

        for (const line of activeOut.split('\n')) {
          const [connName, connType, connDev] = line.trim().split(':');
          if (!connName || connType !== '802-11-wireless') continue;

          // Check if connection is in AP/hotspot mode or named Hotspot or has 10.42.0.x IP
          const matchingAddr = addresses.find((a) => a.iface === connDev);
          const isHotspotName = /hotspot/i.test(connName);
          const isHotspotSubnet = Boolean(
            matchingAddr &&
              (matchingAddr.ip.startsWith('10.42.0.') ||
                matchingAddr.ip.startsWith('192.168.49.'))
          );

          let modeIsAp = false;
          let detectedSsid = '';
          try {
            const { stdout: detailOut } = await execFileAsync(
              'nmcli',
              [
                '-t',
                '-f',
                '802-11-wireless.mode,802-11-wireless.ssid',
                'connection',
                'show',
                connName,
              ],
              { timeout: 2500 }
            );
            for (const dLine of detailOut.split('\n')) {
              if (dLine.startsWith('802-11-wireless.mode:') && dLine.includes('ap')) {
                modeIsAp = true;
              }
              if (dLine.startsWith('802-11-wireless.ssid:')) {
                detectedSsid = dLine.split(':').slice(1).join(':').trim();
              }
            }
          } catch {
            // ignore
          }

          if (modeIsAp || isHotspotName || isHotspotSubnet) {
            hotspot.active = true;
            hotspot.iface = connDev || wifiIface;
            hotspot.ssid =
              detectedSsid || lastHotspotConfig?.ssid || connName || 'DroidBridge-P2P';
            hotspot.password = lastHotspotConfig?.password;
            hotspot.ip = matchingAddr?.ip || '10.42.0.1';
            break;
          }
        }
      }
    } catch {
      hotspot.supported = false;
    }
  }

  return {
    hostname: os.hostname(),
    port,
    addresses,
    hotspot,
  };
}

/**
 * Starts or stops a Direct Wi-Fi P2P Hotspot on Linux using NetworkManager (`nmcli`)
 */
export async function toggleP2pHotspot(
  action: 'start' | 'stop',
  rawSsid?: string,
  rawPassword?: string,
  port = 3456
): Promise<{
  ok: boolean;
  message: string;
  hotspot: P2pNetworkStatus['hotspot'];
}> {
  if (process.platform !== 'linux') {
    const status = await getP2pNetworkStatus(port);
    return {
      ok: false,
      message: 'Direct Wi-Fi P2P Hotspot management via NetworkManager requires Ubuntu / Linux.',
      hotspot: status.hotspot,
    };
  }

  try {
    const { stdout: devOut } = await execFileAsync(
      'nmcli',
      ['-t', '-f', 'DEVICE,TYPE', 'device'],
      { timeout: 4000 }
    );
    const wifiLine = devOut
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.endsWith(':wifi'));
    const wifiIface = wifiLine ? wifiLine.split(':')[0] : undefined;

    if (!wifiIface) {
      const status = await getP2pNetworkStatus(port);
      return {
        ok: false,
        message: 'No Wi-Fi adapter detected on this Linux host.',
        hotspot: status.hotspot,
      };
    }

    if (action === 'start') {
      const ssid = (rawSsid || 'DroidBridge-P2P').trim() || 'DroidBridge-P2P';
      const password =
        rawPassword && rawPassword.trim().length >= 8
          ? rawPassword.trim()
          : 'droidbridge';

      const args = [
        'device',
        'wifi',
        'hotspot',
        'ifname',
        wifiIface,
        'ssid',
        ssid,
        'password',
        password,
      ];

      await execFileAsync('nmcli', args, { timeout: 15000 });
      lastHotspotConfig = { ssid, password };
      await new Promise((r) => setTimeout(r, 500));
      const status = await getP2pNetworkStatus(port);

      return {
        ok: true,
        message: `Wi-Fi P2P Hotspot "${ssid}" is active on ${status.hotspot.ip || '10.42.0.1'}`,
        hotspot: {
          ...status.hotspot,
          active: true,
          ssid,
          password,
          iface: wifiIface,
        },
      };
    } else {
      // Stop active hotspot connection
      try {
        await execFileAsync('nmcli', ['connection', 'down', 'Hotspot'], {
          timeout: 8000,
        });
      } catch {
        await execFileAsync('nmcli', ['device', 'disconnect', wifiIface], {
          timeout: 8000,
        });
      }
      lastHotspotConfig = null;
      await new Promise((r) => setTimeout(r, 400));
      const status = await getP2pNetworkStatus(port);
      return {
        ok: true,
        message: 'Wi-Fi P2P Hotspot stopped.',
        hotspot: status.hotspot,
      };
    }
  } catch (err: unknown) {
    const status = await getP2pNetworkStatus(port);
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Hotspot operation failed: ${errMsg}`,
      hotspot: status.hotspot,
    };
  }
}

/**
 * Fast TCP port check with short timeout
 */
function probeTcpPort(ip: string, port: number, timeoutMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}

/**
 * Discovers peers on the local Wi-Fi / P2P Hotspot using ARP table, ip neigh, mDNS (avahi-browse),
 * active /24 subnet sweep on port 5555, and fast TCP port probes (5555 ADB, 22 SSH)
 */
export async function discoverP2pPeers(): Promise<P2pDiscoveredPeer[]> {
  const peerMap = new Map<string, P2pDiscoveredPeer>();
  const lanAddresses = getLanAddresses();
  const ownIps = new Set(lanAddresses.map((a) => a.ip));
  ownIps.add('127.0.0.1');

  const upsertPeer = (
    ip: string,
    patch: Partial<P2pDiscoveredPeer> & { addServices?: ('adb' | 'ssh' | 'http' | 'lan')[] }
  ) => {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
    if (
      ownIps.has(ip) ||
      ip.endsWith('.255') ||
      ip.endsWith('.0') ||
      ip.startsWith('224.') ||
      ip.startsWith('239.') ||
      ip.startsWith('255.')
    ) {
      return;
    }

    const isHotspotIp =
      ip.startsWith('10.42.0.') ||
      ip.startsWith('192.168.43.') ||
      ip.startsWith('192.168.49.') ||
      ip.startsWith('192.168.137.') ||
      (patch.iface ? /^(p2p|ap|local area connection\*)/i.test(patch.iface) : false);

    const existing = peerMap.get(ip) || {
      ip,
      services: ['lan'],
      source: isHotspotIp ? 'hotspot' : patch.source || 'arp',
    };

    if (patch.hostname && !existing.hostname) existing.hostname = patch.hostname;
    if (patch.mac && !existing.mac) existing.mac = patch.mac;
    if (patch.iface && !existing.iface) existing.iface = patch.iface;
    if (patch.adbPort) existing.adbPort = patch.adbPort;
    if (patch.sshPort) existing.sshPort = patch.sshPort;
    if (isHotspotIp) {
      existing.source = 'hotspot';
    } else if (patch.source === 'mdns') {
      existing.source = 'mdns';
    }

    if (patch.addServices) {
      for (const svc of patch.addServices) {
        if (!existing.services.includes(svc)) {
          existing.services.push(svc);
        }
      }
    }

    peerMap.set(ip, existing);
  };

  // 1. Read /proc/net/arp on Linux, or `arp -a` on Windows / macOS / fallback
  let procArpLoaded = false;
  if (process.platform === 'linux' && fs.existsSync('/proc/net/arp')) {
    try {
      const arpRaw = await fs.promises.readFile('/proc/net/arp', 'utf8');
      for (const line of arpRaw.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const [ip, , flags, mac, , iface] = parts;
          if (
            flags === '0x0' ||
            mac === '00:00:00:00:00:00' ||
            mac.toLowerCase() === 'ff:ff:ff:ff:ff:ff'
          ) {
            continue;
          }
          if (/^(docker|veth|br-|virbr)/i.test(iface)) continue;
          upsertPeer(ip, { mac: mac.toLowerCase(), iface, source: 'arp', addServices: ['lan'] });
        }
      }
      procArpLoaded = true;
    } catch {
      // fallback to arp -a below
    }
  }

  if (!procArpLoaded || process.platform === 'win32' || process.platform === 'darwin') {
    try {
      const { stdout: arpOut } = await execFileAsync('arp', ['-a'], {
        timeout: 3000,
        windowsHide: true,
      });
      for (const rawLine of arpOut.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        // Windows format: "  192.168.1.50          aa-bb-cc-dd-ee-ff     dynamic"
        const winMatch = line.match(
          /^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})\s+(\S+)/
        );
        if (winMatch) {
          const ip = winMatch[1];
          const mac = winMatch[2].replace(/-/g, ':').toLowerCase();
          if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') continue;
          upsertPeer(ip, { mac, source: 'arp', addServices: ['lan'] });
          continue;
        }

        // macOS / BSD / Linux `arp -a` format: "? (192.168.1.50) at aa:bb:cc:dd:ee:ff [ether] on en0"
        const bsdMatch = line.match(
          /\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F]{1,2}(?:[:-][0-9a-fA-F]{1,2}){5})/
        );
        if (bsdMatch) {
          const ip = bsdMatch[1];
          const mac = bsdMatch[2]
            .replace(/-/g, ':')
            .split(':')
            .map((part) => part.padStart(2, '0').toLowerCase())
            .join(':');
          if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') continue;
          const ifaceMatch = line.match(/\bon\s+(\S+)/);
          upsertPeer(ip, {
            mac,
            iface: ifaceMatch ? ifaceMatch[1] : undefined,
            source: 'arp',
            addServices: ['lan'],
          });
        }
      }
    } catch {
      // ignore if arp is unavailable
    }
  }

  // 2. Read `ip neigh show` for up-to-date neighbor entries on Linux
  if (process.platform === 'linux') {
    try {
      const { stdout: neighOut } = await execFileAsync('ip', ['neigh', 'show'], {
        timeout: 2500,
      });
      for (const line of neighOut.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes('FAILED') || trimmed.includes('INCOMPLETE')) continue;
        const ipMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)\s+/);
        if (!ipMatch) continue;
        const ip = ipMatch[1];
        const devMatch = trimmed.match(/\bdev\s+(\S+)/);
        const macMatch = trimmed.match(/\blladdr\s+([0-9a-fA-F:]{17})/);
        const iface = devMatch ? devMatch[1] : undefined;
        if (iface && /^(docker|veth|br-|virbr)/i.test(iface)) continue;
        upsertPeer(ip, {
          iface,
          mac: macMatch ? macMatch[1].toLowerCase() : undefined,
          source: 'arp',
          addServices: ['lan'],
        });
      }
    } catch {
      // ignore
    }

    // 3. Optional fast mDNS browse via avahi-browse on Linux
    try {
      const { stdout: mdnsOut } = await execFileAsync(
        'avahi-browse',
        ['-artp', '-t'],
        { timeout: 2500 }
      );
      for (const line of mdnsOut.split('\n')) {
        if (!line.startsWith('=')) continue;
        const cols = line.split(';');
        // Format: =;iface;protocol;name;type;domain;hostname;address;port;txt
        if (cols.length < 9) continue;
        const [, iface, , serviceName, serviceType, , hostname, address, portStr] = cols;
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) continue;
        const portNum = Number.parseInt(portStr, 10);

        const addServices: ('adb' | 'ssh' | 'http' | 'lan')[] = ['lan'];
        let adbPort: number | undefined;
        let sshPort: number | undefined;

        if (serviceType.includes('_adb')) {
          addServices.push('adb');
          if (!Number.isNaN(portNum) && portNum > 0) adbPort = portNum;
        } else if (serviceType.includes('_ssh') || serviceType.includes('_sftp-ssh')) {
          addServices.push('ssh');
          if (!Number.isNaN(portNum) && portNum > 0) sshPort = portNum;
        } else if (serviceType.includes('_http')) {
          addServices.push('http');
        }

        upsertPeer(address, {
          iface,
          hostname: (hostname || serviceName || '').replace(/\.local\.?$/, ''),
          adbPort,
          sshPort,
          source: 'mdns',
          addServices,
        });
      }
    } catch {
      // avahi-browse may not be installed or may time out; safe to ignore
    }
  }

  // 4. Active /24 subnet sweep on primary local IPv4 interface for port 5555 (Wireless ADB)
  // Finds devices (e.g. TrimUI Smart Pro S) on the same Wi-Fi that haven't entered the ARP cache yet
  const primaryLan = lanAddresses[0];
  if (primaryLan) {
    const octets = primaryLan.ip.split('.');
    if (octets.length === 4) {
      const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
      const subnetIps: string[] = [];
      for (let host = 1; host <= 254; host++) {
        const candidateIp = `${prefix}.${host}`;
        if (!ownIps.has(candidateIp)) {
          subnetIps.push(candidateIp);
        }
      }

      const BATCH_SIZE = 50;
      for (let i = 0; i < subnetIps.length; i += BATCH_SIZE) {
        const batch = subnetIps.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (candidateIp) => {
            const adbOpen = await probeTcpPort(candidateIp, 5555, 350);
            if (adbOpen) {
              upsertPeer(candidateIp, {
                iface: primaryLan.iface,
                adbPort: 5555,
                source: 'arp',
                addServices: ['lan', 'adb'],
              });
            }
          })
        );
      }
    }
  }

  // 5. Probe TCP ports 5555 (ADB) and 22 (SSH) on all candidate peers in parallel
  const allCandidates = Array.from(peerMap.values()).sort((a, b) => {
    const aHasSvc = a.services.includes('adb') || a.services.includes('ssh') ? 1 : 0;
    const bHasSvc = b.services.includes('adb') || b.services.includes('ssh') ? 1 : 0;
    return bHasSvc - aHasSvc;
  });
  const peers = allCandidates.slice(0, 32);
  await Promise.all(
    peers.map(async (peer) => {
      const [adbOpen, sshOpen] = await Promise.all([
        peer.services.includes('adb')
          ? Promise.resolve(true)
          : probeTcpPort(peer.ip, peer.adbPort || 5555, 450),
        probeTcpPort(peer.ip, peer.sshPort || 22, 450),
      ]);
      if (adbOpen) {
        if (!peer.services.includes('adb')) peer.services.push('adb');
        peer.adbPort = peer.adbPort || 5555;
      }
      if (sshOpen) {
        if (!peer.services.includes('ssh')) peer.services.push('ssh');
        peer.sshPort = peer.sshPort || 22;
      }
    })
  );

  // Sort peers with ADB/SSH or Hotspot first
  peers.sort((a, b) => {
    const aScore =
      (a.services.includes('adb') ? 4 : 0) +
      (a.services.includes('ssh') ? 2 : 0) +
      (a.source === 'hotspot' ? 1 : 0);
    const bScore =
      (b.services.includes('adb') ? 4 : 0) +
      (b.services.includes('ssh') ? 2 : 0) +
      (b.source === 'hotspot' ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });

  return peers;
}

// ============================================================================
// Self-Contained ISO/IEC 18004 QR Code SVG Generator (Versions 1-6, Byte Mode, EC Level L)
// ============================================================================

interface QrVersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks: number;
  alignmentCoords: number[];
}

const QR_VERSIONS_L: QrVersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, ecCodewordsPerBlock: 7, numBlocks: 1, alignmentCoords: [] },
  { version: 2, size: 25, dataCodewords: 34, ecCodewordsPerBlock: 10, numBlocks: 1, alignmentCoords: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, ecCodewordsPerBlock: 15, numBlocks: 1, alignmentCoords: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, ecCodewordsPerBlock: 20, numBlocks: 1, alignmentCoords: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, ecCodewordsPerBlock: 26, numBlocks: 1, alignmentCoords: [6, 30] },
  { version: 6, size: 41, dataCodewords: 136, ecCodewordsPerBlock: 18, numBlocks: 2, alignmentCoords: [6, 34] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return rem;
}

function computeFormatBits(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function generateQrSvg(text: string): string {
  const payload = Buffer.from(text, 'utf8');
  const spec =
    QR_VERSIONS_L.find((s) => payload.length + 2 <= s.dataCodewords) ||
    QR_VERSIONS_L[QR_VERSIONS_L.length - 1];

  const maxLen = Math.min(payload.length, spec.dataCodewords - 2);
  const bytes = payload.subarray(0, maxLen);

  // Build data bit stream: 0100 (Byte mode) + 8-bit length + payload bytes + terminator
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const maxDataBits = spec.dataCodewords * 8;
  const terminatorLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataCodewords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bits[i * 8 + b];
    }
    dataCodewords[i] = byteVal;
  }

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  for (let i = bits.length / 8; i < spec.dataCodewords; i++) {
    dataCodewords[i] = padBytes[padIdx % 2];
    padIdx++;
  }

  // Reed-Solomon blocks & interleaving
  const blockDataSize = Math.floor(spec.dataCodewords / spec.numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.numBlocks; b++) {
    const block = dataCodewords.subarray(b * blockDataSize, (b + 1) * blockDataSize);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, spec.ecCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  for (let i = 0; i < blockDataSize; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  const N = spec.size;
  const modules: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
  const isFunction: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= N || c < 0 || c >= N) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inCenter));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, N - 7);
  drawFinder(N - 7, 0);

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const coords = spec.alignmentCoords;
  for (const ar of coords) {
    for (const ac of coords) {
      if (
        (ar === 6 && ac === 6) ||
        (ar === 6 && ac === N - 7) ||
        (ar === N - 7 && ac === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunctionModule(ar + dr, ac + dc, dist === 2 || dist === 0);
        }
      }
    }
  }

  // Dark module and reserved format information cells
  setFunctionModule(N - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) setFunctionModule(8, i, false);
    if (!isFunction[i][8]) setFunctionModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][N - 1 - i]) setFunctionModule(8, N - 1 - i, false);
    if (!isFunction[N - 1 - i][8]) setFunctionModule(N - 1 - i, 8, false);
  }

  // Place data & EC bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let rightCol = N - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < N; step++) {
      const r = upward ? N - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!isFunction[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const cw = finalCodewords[bitIdx >> 3];
            dark = Boolean((cw >> (7 - (bitIdx & 7))) & 1);
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) {
            dark = !dark;
          }
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for EC Level L (01) and Mask 0 (000)
  const formatBits = computeFormatBits(0b01, 0);
  const getFmtBit = (i: number) => Boolean((formatBits >> i) & 1);

  // Copy 1 around top-left finder
  for (let i = 0; i <= 5; i++) modules[i][8] = getFmtBit(i);
  modules[7][8] = getFmtBit(6);
  modules[8][8] = getFmtBit(7);
  modules[8][7] = getFmtBit(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = getFmtBit(i);

  // Copy 2 along top-right and bottom-left
  for (let i = 0; i <= 7; i++) modules[8][N - 1 - i] = getFmtBit(i);
  for (let i = 8; i <= 14; i++) modules[N - 15 + i][8] = getFmtBit(i);

  // Render SVG with 3-module quiet zone
  const margin = 3;
  const viewSize = N + margin * 2;
  let pathData = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (modules[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff" rx="1.5"/><path d="${pathData}" fill="#0b0f17"/></svg>`;
}

// ============================================================================
// Wi-Fi P2P Share Session Manager & Mobile Portal
// ============================================================================

export async function createShareSession(
  opts: {
    sourceKind: 'ubuntu' | 'android';
    serial?: string;
    paths: string[];
    uploadTargetDir?: string;
    allowUpload?: boolean;
    pin?: string;
    title?: string;
  },
  port = 3456
): Promise<P2pShareSession> {
  const sourceKind = opts.sourceKind === 'android' ? 'android' : 'ubuntu';
  const serial = opts.serial?.trim() || undefined;
  const rawPaths = Array.isArray(opts.paths) ? opts.paths.map(String).filter(Boolean) : [];

  const items: P2pShareItem[] = [];

  if (sourceKind === 'ubuntu') {
    for (const p of rawPaths) {
      const resolved = resolveInputPath(p);
      try {
        const stat = await fs.promises.stat(resolved);
        const isDirectory = stat.isDirectory();
        const size = isDirectory
          ? await calculateLocalTotalBytes([resolved])
          : stat.size;
        items.push({
          name: path.basename(resolved),
          path: resolved,
          isDirectory,
          size,
        });
      } catch {
        // skip non-existent path
      }
    }
  } else if (serial) {
    for (const p of rawPaths) {
      const norm = path.posix.normalize(p.trim());
      const parentDir = path.posix.dirname(norm);
      const baseName = path.posix.basename(norm);
      let matchedItem: P2pShareItem | null = null;
      try {
        const listing = isSshSerial(serial)
          ? await listSshDirectory(serial, parentDir)
          : await listAndroidDirectory(serial, parentDir);
        const found = listing.entries.find((e) => e.name === baseName);
        if (found) {
          matchedItem = {
            name: found.name,
            path: found.path,
            isDirectory: found.isDirectory,
            size: found.size,
          };
        }
      } catch {
        // fallback below
      }
      items.push(
        matchedItem || {
          name: baseName,
          path: norm,
          isDirectory: false,
          size: 0,
        }
      );
    }
  }

  const defaultUploadDir =
    sourceKind === 'ubuntu'
      ? resolveInputPath(opts.uploadTargetDir || path.join(os.homedir(), 'Downloads'))
      : opts.uploadTargetDir?.trim() || '/sdcard/Download';

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(3).toString('hex');
  const lanAddrs = getLanAddresses();
  const urls =
    lanAddrs.length > 0
      ? lanAddrs.map((a) => `http://${a.ip}:${port}/p2p/s/${token}`)
      : [`http://localhost:${port}/p2p/s/${token}`];

  const defaultTitle =
    items.length === 1
      ? items[0].name
      : items.length > 1
        ? `${items.length} Shared Items`
        : 'DroidBridge Wi-Fi Drop Zone';

  const session: P2pShareSession = {
    id,
    token,
    sourceKind,
    serial,
    title: (opts.title || '').trim() || defaultTitle,
    items,
    uploadTargetDir: defaultUploadDir,
    allowUpload: opts.allowUpload ?? true,
    pin: opts.pin && opts.pin.trim() ? opts.pin.trim() : undefined,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    downloadCount: 0,
    uploadCount: 0,
    urls,
    qrSvg: generateQrSvg(urls[0]),
  };

  shareSessions.set(id, session);
  return session;
}

function getSessionByToken(token: string): P2pShareSession | undefined {
  for (const session of shareSessions.values()) {
    if (session.token === token) {
      return session;
    }
  }
  return undefined;
}

function formatHumanBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMobilePortalHtml(session: P2pShareSession, providedPin?: string): string {
  const pinLocked = Boolean(session.pin && session.pin !== providedPin);
  const pinQuery = session.pin && providedPin === session.pin ? `&pin=${encodeURIComponent(providedPin)}` : '';
  const hasDirectoriesOrMultiple =
    session.items.length > 1 || session.items.some((item) => item.isDirectory);

  if (pinLocked) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>PIN Required — DroidBridge Wi-Fi P2P</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0e14;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: #131822;
      border: 1px solid #263042;
      border-radius: 16px;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 12px;
      letter-spacing: 0.05em;
    }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { font-size: 14px; color: #8b949e; margin-bottom: 20px; }
    input {
      width: 100%;
      padding: 12px 14px;
      font-size: 18px;
      text-align: center;
      letter-spacing: 0.2em;
      border-radius: 10px;
      border: 1px solid #30363d;
      background: #0d1117;
      color: #fff;
      margin-bottom: 14px;
    }
    button {
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: #fff;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <form class="card" method="GET" action="/p2p/s/${escapeHtml(session.token)}">
    <span class="badge">DROIDBRIDGE WI-FI P2P</span>
    <h1>PIN Protected Share</h1>
    <p>Enter the session PIN shown on the DroidBridge host to access "${escapeHtml(session.title)}".</p>
    <input type="password" name="pin" placeholder="••••" autofocus required />
    <button type="submit">Unlock Share</button>
  </form>
</body>
</html>`;
  }

  const itemsHtml =
    session.items.length === 0
      ? `<div class="empty">No files queued for download in this session — use the drop zone below to send files or folders to the host!</div>`
      : session.items
          .map(
            (item, idx) => `
      <div class="item-row">
        <div class="item-meta">
          <span class="type-pill ${item.isDirectory ? 'dir' : 'file'}">${
              item.isDirectory ? 'DIR' : 'FILE'
            }</span>
          <div class="item-text">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-sub">${
              item.isDirectory
                ? `Folder (${formatHumanBytes(item.size)} total) • Downloads as .tar.gz`
                : formatHumanBytes(item.size)
            }</div>
          </div>
        </div>
        <a class="dl-btn" href="/p2p/s/${escapeHtml(
          session.token
        )}/download?index=${idx}${pinQuery}">
          ${item.isDirectory ? 'Download .tar.gz' : 'Download'}
        </a>
      </div>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${escapeHtml(session.title)} — DroidBridge Wi-Fi P2P</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0e14;
      color: #e6edf3;
      min-height: 100vh;
      padding: 20px 14px 48px;
    }
    .container {
      max-width: 680px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .header-card, .section-card {
      background: #131822;
      border: 1px solid #242e42;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 10px;
      letter-spacing: 0.04em;
    }
    h1 { font-size: 22px; margin-bottom: 6px; word-break: break-word; }
    .subtitle { font-size: 13px; color: #8b949e; }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .section-title { font-size: 15px; font-weight: 700; color: #f0f6fc; }
    .dl-all-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      padding: 9px 14px;
      border-radius: 10px;
    }
    .items-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #0d1117;
      border: 1px solid #21262d;
    }
    .item-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .type-pill {
      font-size: 10px;
      font-weight: 800;
      padding: 3px 7px;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .type-pill.dir { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
    .type-pill.file { background: rgba(56, 189, 248, 0.16); color: #38bdf8; }
    .item-text { min-width: 0; }
    .item-name {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-sub { font-size: 12px; color: #8b949e; margin-top: 2px; }
    .dl-btn {
      text-decoration: none;
      background: #1f6feb;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 9px;
      flex-shrink: 0;
    }
    .drop-zone {
      border: 2px dashed #30363d;
      border-radius: 14px;
      padding: 26px 18px;
      text-align: center;
      background: #0d1117;
      transition: all 0.18s ease;
    }
    .drop-zone.dragover {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.08);
    }
    .drop-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .drop-sub { font-size: 12px; color: #8b949e; margin-bottom: 16px; }
    .btn-row {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pick-btn {
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid #30363d;
      background: #161b22;
      color: #e6edf3;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .pick-btn.primary {
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      border-color: transparent;
      color: #fff;
    }
    .progress-wrap {
      margin-top: 14px;
      display: none;
    }
    .progress-bar-bg {
      height: 8px;
      background: #21262d;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .progress-bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #38bdf8, #10b981);
      transition: width 0.15s ease;
    }
    .status-text { font-size: 12px; color: #8b949e; }
    .empty { font-size: 13px; color: #8b949e; padding: 12px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <div class="brand">⚡ DROIDBRIDGE WI-FI P2P PORTAL</div>
      <h1>${escapeHtml(session.title)}</h1>
      <div class="subtitle">
        Host: <strong>${escapeHtml(os.hostname())}</strong> • Target: <code>${escapeHtml(
    session.uploadTargetDir
  )}</code>
      </div>
    </div>

    <div class="section-card">
      <div class="section-header">
        <div class="section-title">Shared Files &amp; Folders (${session.items.length})</div>
        ${
          hasDirectoriesOrMultiple && session.items.length > 0
            ? `<a class="dl-all-btn" href="/p2p/s/${escapeHtml(
                session.token
              )}/download?all=1${pinQuery}">⬇ Download All (.tar.gz)</a>`
            : ''
        }
      </div>
      <div class="items-list">
        ${itemsHtml}
      </div>
    </div>

    ${
      session.allowUpload
        ? `<div class="section-card">
      <div class="section-header">
        <div class="section-title">Send Files or Folders to Host</div>
      </div>
      <div id="dropZone" class="drop-zone">
        <div class="drop-title">Drag &amp; Drop Files or Folders Here</div>
        <div class="drop-sub">Preserves full nested folder hierarchies automatically</div>
        <div class="btn-row">
          <button type="button" class="pick-btn primary" id="pickFilesBtn">Select Files</button>
          <button type="button" class="pick-btn" id="pickFolderBtn">Select Folder</button>
        </div>
        <input type="file" id="fileInput" multiple style="display:none" />
        <input type="file" id="folderInput" webkitdirectory directory multiple style="display:none" />
        <div id="progressWrap" class="progress-wrap">
          <div class="progress-bar-bg"><div id="progressFill" class="progress-bar-fill"></div></div>
          <div id="statusText" class="status-text">Uploading...</div>
        </div>
      </div>
    </div>`
        : ''
    }
  </div>

  <script>
    (function() {
      const dropZone = document.getElementById('dropZone');
      if (!dropZone) return;
      const fileInput = document.getElementById('fileInput');
      const folderInput = document.getElementById('folderInput');
      const pickFilesBtn = document.getElementById('pickFilesBtn');
      const pickFolderBtn = document.getElementById('pickFolderBtn');
      const progressWrap = document.getElementById('progressWrap');
      const progressFill = document.getElementById('progressFill');
      const statusText = document.getElementById('statusText');

      pickFilesBtn.addEventListener('click', () => fileInput.click());
      pickFolderBtn.addEventListener('click', () => folderInput.click());

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const items = Array.from(fileInput.files).map(f => ({
            file: f,
            relativePath: f.webkitRelativePath || f.name
          }));
          uploadItems(items);
          fileInput.value = '';
        }
      });

      folderInput.addEventListener('change', () => {
        if (folderInput.files && folderInput.files.length > 0) {
          const items = Array.from(folderInput.files).map(f => ({
            file: f,
            relativePath: f.webkitRelativePath || f.name
          }));
          uploadItems(items);
          folderInput.value = '';
        }
      });

      function readEntriesPromise(reader) {
        return new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
      }

      async function traverseEntry(entry, prefix) {
        if (!entry) return [];
        if (entry.isFile) {
          return new Promise((resolve) => {
            entry.file((file) => {
              resolve([{ file, relativePath: (prefix ? prefix + '/' : '') + file.name }]);
            }, () => resolve([]));
          });
        }
        if (entry.isDirectory) {
          const reader = entry.createReader();
          const results = [];
          while (true) {
            const batch = await readEntriesPromise(reader).catch(() => []);
            if (!batch || batch.length === 0) break;
            for (const child of batch) {
              const sub = await traverseEntry(child, (prefix ? prefix + '/' : '') + entry.name);
              results.push(...sub);
            }
          }
          return results;
        }
        return [];
      }

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
      });
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const dt = e.dataTransfer;
        if (!dt) return;
        const collected = [];
        if (dt.items && dt.items.length > 0) {
          const entries = [];
          for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item.webkitGetAsEntry) {
              const entry = item.webkitGetAsEntry();
              if (entry) entries.push(entry);
            }
          }
          if (entries.length > 0) {
            for (const entry of entries) {
              const sub = await traverseEntry(entry, '');
              collected.push(...sub);
            }
          }
        }
        if (collected.length === 0 && dt.files && dt.files.length > 0) {
          for (let i = 0; i < dt.files.length; i++) {
            const f = dt.files[i];
            collected.push({ file: f, relativePath: f.webkitRelativePath || f.name });
          }
        }
        if (collected.length > 0) {
          uploadItems(collected);
        }
      });

      function uploadItems(items) {
        const formData = new FormData();
        for (const item of items) {
          formData.append('files', item.file);
          formData.append('relativePaths', item.relativePath);
        }
        progressWrap.style.display = 'block';
        progressFill.style.width = '0%';
        statusText.textContent = 'Uploading ' + items.length + ' file(s)...';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/p2p/s/${escapeHtml(session.token)}/upload?1=1${pinQuery}');
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            progressFill.style.width = pct + '%';
            statusText.textContent = 'Uploading ' + items.length + ' file(s)... ' + pct + '%';
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            progressFill.style.width = '100%';
            statusText.textContent = '✅ Successfully sent ' + items.length + ' file(s) to host!';
          } else {
            statusText.textContent = '❌ Upload failed (' + xhr.status + ')';
          }
        };
        xhr.onerror = () => {
          statusText.textContent = '❌ Network error while uploading';
        };
        xhr.send(formData);
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Streams one or more local paths as a `.tar.gz` archive to the HTTP response
 */
function streamTarGzArchive(
  res: Response,
  archiveBaseName: string,
  targetPaths: string[],
  onCleanup?: () => Promise<void>
): void {
  const safeArchiveName =
    archiveBaseName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'droidbridge-share';
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeArchiveName}.tar.gz"`
  );

  // Build tar arguments using -C <parentDir> <basename> for each entry so paths inside archive are clean
  const tarArgs: string[] = ['-czf', '-'];
  for (const p of targetPaths) {
    tarArgs.push('-C', path.dirname(p), path.basename(p));
  }

  const child = spawn('tar', tarArgs);
  child.stdout.pipe(res);

  const cleanup = () => {
    if (onCleanup) {
      onCleanup().catch(() => {});
    }
  };

  child.on('close', cleanup);
  child.on('error', () => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).end('Archive stream failed');
    } else {
      res.end();
    }
  });
  res.on('close', () => {
    if (!child.killed) {
      child.kill();
    }
  });
}

/**
 * Registers all `/api/p2p/*` and `/p2p/s/:token*` routes on the Express app
 */
export function registerP2pRoutes(
  app: Express,
  createJob: CreateJobFn,
  defaultPort = Number(process.env.PORT || 3456)
): void {
  app.get('/api/p2p/status', async (_req: Request, res: Response) => {
    try {
      const status = await getP2pNetworkStatus(defaultPort);
      res.json(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/p2p/peers', async (_req: Request, res: Response) => {
    try {
      const peers = await discoverP2pPeers();
      res.json({ peers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message, peers: [] });
    }
  });

  app.get('/api/p2p/shares', (_req: Request, res: Response) => {
    const shares = Array.from(shareSessions.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    res.json({ shares });
  });

  app.post('/api/p2p/shares', async (req: Request, res: Response) => {
    try {
      const {
        sourceKind = 'ubuntu',
        serial,
        paths = [],
        uploadTargetDir,
        allowUpload = true,
        pin,
        title,
      } = req.body || {};

      const share = await createShareSession(
        {
          sourceKind,
          serial,
          paths: Array.isArray(paths) ? paths.map(String) : [],
          uploadTargetDir,
          allowUpload: Boolean(allowUpload),
          pin: typeof pin === 'string' ? pin : undefined,
          title: typeof title === 'string' ? title : undefined,
        },
        defaultPort
      );

      res.json({ ok: true, share });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.delete('/api/p2p/shares/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    const deleted = shareSessions.delete(id);
    res.json({ ok: deleted });
  });

  app.post('/api/p2p/hotspot', async (req: Request, res: Response) => {
    try {
      const { action, ssid, password } = req.body || {};
      if (action !== 'start' && action !== 'stop') {
        res.status(400).json({ ok: false, error: 'action must be "start" or "stop"' });
        return;
      }
      const result = await toggleP2pHotspot(
        action,
        typeof ssid === 'string' ? ssid : undefined,
        typeof password === 'string' ? password : undefined,
        defaultPort
      );
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, message, error: message });
    }
  });

  // Mobile Web Portal HTML
  app.get('/p2p/s/:token', (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    const session = getSessionByToken(token);
    if (!session) {
      res.status(404).send('Share session not found or expired.');
      return;
    }
    const providedPin = typeof req.query.pin === 'string' ? req.query.pin : undefined;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderMobilePortalHtml(session, providedPin));
  });

  // Mobile Web Portal Download (single file or .tar.gz archive for folders / multiple items)
  app.get('/p2p/s/:token/download', async (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    const session = getSessionByToken(token);
    if (!session) {
      res.status(404).json({ error: 'Share session not found or expired' });
      return;
    }

    const providedPin = typeof req.query.pin === 'string' ? req.query.pin : undefined;
    if (session.pin && session.pin !== providedPin) {
      res.status(403).json({ error: 'Invalid PIN' });
      return;
    }

    const downloadAll = req.query.all === '1' || req.query.all === 'true';
    const index = Number.parseInt(String(req.query.index ?? '0'), 10);
    const selectedItems = downloadAll
      ? session.items
      : session.items[index]
        ? [session.items[index]]
        : [];

    if (selectedItems.length === 0) {
      res.status(404).json({ error: 'No shared items found to download' });
      return;
    }

    session.downloadCount += 1;
    const totalBytes = selectedItems.reduce((acc, it) => acc + (it.size || 0), 0);
    const job = createJob(
      'p2p-share',
      session.serial || 'wifi-p2p',
      selectedItems.map((i) => i.path),
      req.ip || 'peer',
      `Wi-Fi P2P Download: ${
        selectedItems.length === 1 ? selectedItems[0].name : `${selectedItems.length} items`
      }`,
      totalBytes
    );

    try {
      if (session.sourceKind === 'ubuntu') {
        if (selectedItems.length === 1 && !selectedItems[0].isDirectory) {
          job.status = 'completed';
          job.completedAt = Date.now();
          res.download(selectedItems[0].path, selectedItems[0].name);
          return;
        }
        job.status = 'completed';
        job.completedAt = Date.now();
        const archiveName =
          selectedItems.length === 1 ? selectedItems[0].name : session.title;
        streamTarGzArchive(
          res,
          archiveName,
          selectedItems.map((i) => i.path)
        );
        return;
      }

      // Remote Android / SSH source: pull to temp directory first
      const serial = session.serial || '';
      const tempPullDir = path.join(P2P_TEMP_DIR, `dl-${crypto.randomUUID()}`);
      await fs.promises.mkdir(tempPullDir, { recursive: true });

      const remotePaths = selectedItems.map((i) => i.path);
      if (isSshSerial(serial)) {
        await pullFromSsh(serial, remotePaths, tempPullDir);
      } else {
        await pullFromAndroid(serial, remotePaths, tempPullDir);
      }

      const localPulledPaths = selectedItems.map((i) =>
        path.join(tempPullDir, path.posix.basename(i.path))
      );

      job.status = 'completed';
      job.completedAt = Date.now();

      if (localPulledPaths.length === 1 && !selectedItems[0].isDirectory) {
        res.download(localPulledPaths[0], selectedItems[0].name, async () => {
          await fs.promises.rm(tempPullDir, { recursive: true, force: true }).catch(() => {});
        });
      } else {
        const archiveName =
          selectedItems.length === 1 ? selectedItems[0].name : session.title;
        streamTarGzArchive(res, archiveName, localPulledPaths, async () => {
          await fs.promises.rm(tempPullDir, { recursive: true, force: true }).catch(() => {});
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = message;
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  });

  // Mobile Web Portal Upload (files & nested folders from peer browser to Ubuntu or Android/SSH)
  app.post(
    '/p2p/s/:token/upload',
    p2pUpload.any(),
    async (req: Request, res: Response) => {
      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      const cleanupUploadedTemp = async () => {
        for (const f of uploadedFiles) {
          await fs.promises.rm(path.dirname(f.path), { recursive: true, force: true }).catch(() => {});
        }
      };

      const token = String(req.params.token || '').trim();
      const session = getSessionByToken(token);
      if (!session || !session.allowUpload) {
        await cleanupUploadedTemp();
        res.status(403).json({ error: 'Upload not allowed for this session' });
        return;
      }

      const providedPin =
        typeof req.query.pin === 'string'
          ? req.query.pin
          : typeof req.body?.pin === 'string'
            ? req.body.pin
            : undefined;
      if (session.pin && session.pin !== providedPin) {
        await cleanupUploadedTemp();
        res.status(403).json({ error: 'Invalid PIN' });
        return;
      }

      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }

      const rawRel = req.body?.relativePaths;
      const relList: string[] = Array.isArray(rawRel)
        ? rawRel.map(String)
        : typeof rawRel === 'string'
          ? [rawRel]
          : [];

      const totalBytes = uploadedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
      const job = createJob(
        'p2p-share',
        session.serial || 'wifi-p2p',
        uploadedFiles.map((f, i) => relList[i] || f.originalname),
        session.uploadTargetDir,
        `Wi-Fi P2P Receive ${uploadedFiles.length} file(s) -> ${session.uploadTargetDir}`,
        totalBytes
      );

      let stageRoot: string | null = null;
      try {
        if (session.sourceKind === 'ubuntu') {
          const targetBase = resolveInputPath(session.uploadTargetDir);
          await fs.promises.mkdir(targetBase, { recursive: true });

          for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const safeRel = sanitizeRelativePath(relList[i] || '', file.originalname);
            const destPath = path.join(targetBase, safeRel);
            await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
            await fs.promises.cp(file.path, destPath, { force: true });
          }
        } else if (session.serial) {
          stageRoot = path.join(P2P_TEMP_DIR, `stage-${crypto.randomUUID()}`);
          await fs.promises.mkdir(stageRoot, { recursive: true });
          const topLevelNames = new Set<string>();

          for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const safeRel = sanitizeRelativePath(relList[i] || '', file.originalname);
            topLevelNames.add(safeRel.split('/')[0]);
            const destPath = path.join(stageRoot, safeRel);
            await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
            await fs.promises.cp(file.path, destPath, { force: true });
          }

          const topLevelPaths = Array.from(topLevelNames).map((name) =>
            path.join(stageRoot!, name)
          );
          if (isSshSerial(session.serial)) {
            await pushToSsh(session.serial, topLevelPaths, session.uploadTargetDir);
          } else {
            await pushToAndroid(session.serial, topLevelPaths, session.uploadTargetDir);
          }
        }

        session.uploadCount += uploadedFiles.length;
        job.status = 'completed';
        job.completedAt = Date.now();
        res.json({ ok: true, uploaded: uploadedFiles.length, job });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        job.status = 'failed';
        job.completedAt = Date.now();
        job.error = message;
        res.status(500).json({ error: message, job });
      } finally {
        await cleanupUploadedTemp();
        if (stageRoot) {
          await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  );
}

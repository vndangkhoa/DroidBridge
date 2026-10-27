import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AndroidDevice,
  DirectoryListingResponse,
  FileEntry,
  StorageVolume,
} from '../src/types';
import { escapeShellArg, parseDfLine, parseLsLine } from './adb';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 50 * 1024 * 1024;

export interface SshConnectionTarget {
  serial: string; // e.g. "ssh://root@192.168.31.88:22" or "ssh://trimui"
  user?: string;
  host: string;
  port?: number;
  password?: string;
  label?: string;
}

const activeSshTargets = new Map<string, SshConnectionTarget>();

export function isSshSerial(serial: string): boolean {
  return serial.startsWith('ssh://');
}

export function parseSshAddress(rawInput: string, password?: string): SshConnectionTarget {
  let cleaned = rawInput.trim();
  if (cleaned.startsWith('ssh://')) {
    cleaned = cleaned.slice('ssh://'.length);
  }

  let user: string | undefined;
  let hostPart = cleaned;
  if (cleaned.includes('@')) {
    const atIdx = cleaned.indexOf('@');
    user = cleaned.slice(0, atIdx).trim() || undefined;
    hostPart = cleaned.slice(atIdx + 1).trim();
  }

  let host = hostPart;
  let port: number | undefined;
  if (hostPart.includes(':')) {
    const colonIdx = hostPart.lastIndexOf(':');
    host = hostPart.slice(0, colonIdx).trim();
    const parsedPort = Number.parseInt(hostPart.slice(colonIdx + 1).trim(), 10);
    if (!Number.isNaN(parsedPort) && parsedPort > 0) {
      port = parsedPort;
    }
  }

  const normalizedSerial = `ssh://${user ? `${user}@` : ''}${host}${port ? `:${port}` : ''}`;
  return {
    serial: normalizedSerial,
    user,
    host,
    port,
    password: password || undefined,
  };
}

function getSshTarget(serial: string): SshConnectionTarget {
  const existing = activeSshTargets.get(serial);
  if (existing) return existing;
  const parsed = parseSshAddress(serial);
  activeSshTargets.set(parsed.serial, parsed);
  return parsed;
}

function buildSshBaseArgs(target: SshConnectionTarget, isScp = false): string[] {
  const args: string[] = [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'ConnectTimeout=6',
    '-o',
    'ControlMaster=auto',
    '-o',
    'ControlPath=/tmp/droidbridge-ssh-%C',
    '-o',
    'ControlPersist=10m',
  ];

  if (!target.password) {
    args.push('-o', 'BatchMode=yes');
  }

  if (target.port) {
    args.push(isScp ? '-P' : '-p', String(target.port));
  }

  return args;
}

async function execWithOptionalPassword(
  binary: string,
  args: string[],
  password?: string,
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string }> {
  if (!password) {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  }

  // Create temporary SSH_ASKPASS script for password authentication
  const askpassPath = `/tmp/droidbridge-askpass-${crypto.randomUUID()}.sh`;
  const escapedPw = password.replace(/'/g, `'\\''`);
  await fs.promises.writeFile(
    askpassPath,
    `#!/bin/sh\necho '${escapedPw}'\n`,
    { mode: 0o700 }
  );

  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
        SSH_ASKPASS: askpassPath,
        SSH_ASKPASS_REQUIRE: 'force',
      },
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } finally {
    await fs.promises.rm(askpassPath, { force: true }).catch(() => {});
  }
}

export async function runSshCommand(
  serial: string,
  command: string,
  timeoutMs = 20000
): Promise<string> {
  const target = getSshTarget(serial);
  const destination = target.user ? `${target.user}@${target.host}` : target.host;
  const args = [...buildSshBaseArgs(target, false), destination, command];
  const { stdout } = await execWithOptionalPassword(
    'ssh',
    args,
    target.password,
    timeoutMs
  );
  return stdout.replace(/\r\n/g, '\n');
}

export async function connectSshDevice(
  address: string,
  password?: string
): Promise<{ ok: boolean; message: string; serial?: string }> {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, message: 'SSH host address is required' };
  }

  const target = parseSshAddress(trimmed, password);
  activeSshTargets.set(target.serial, target);

  try {
    const out = await runSshCommand(
      target.serial,
      'echo "CONNECTED_OK $(uname -n) $(uname -m)"',
      12000
    );
    if (out.includes('CONNECTED_OK')) {
      return {
        ok: true,
        serial: target.serial,
        message: `Connected to Linux SSH host ${target.serial.replace('ssh://', '')}`,
      };
    }
    activeSshTargets.delete(target.serial);
    return {
      ok: false,
      message: out.trim() || `Failed to verify SSH connection to ${trimmed}`,
    };
  } catch (err: unknown) {
    activeSshTargets.delete(target.serial);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export async function disconnectSshDevice(
  serial: string
): Promise<{ ok: boolean; message: string }> {
  const target = activeSshTargets.get(serial) || parseSshAddress(serial);
  activeSshTargets.delete(target.serial);

  const destination = target.user ? `${target.user}@${target.host}` : target.host;
  try {
    await execFileAsync('ssh', [
      '-O',
      'exit',
      '-o',
      'ControlPath=/tmp/droidbridge-ssh-%C',
      ...(target.port ? ['-p', String(target.port)] : []),
      destination,
    ]);
  } catch {
    // ignore if socket already closed
  }

  return {
    ok: true,
    message: `Disconnected SSH device ${target.serial.replace('ssh://', '')}`,
  };
}

export async function getSshVolumes(serial: string): Promise<StorageVolume[]> {
  const volumes: StorageVolume[] = [];

  try {
    const raw = await runSshCommand(
      serial,
      `echo "===SDCARD==="; [ -d /mnt/SDCARD ] && df -Pk /mnt/SDCARD 2>/dev/null || true; echo "===ROOT==="; df -Pk / 2>/dev/null || true; echo "===HOME==="; df -Pk "$HOME" 2>/dev/null || true`,
      8000
    );
    const sdSplit = raw.split('===ROOT===');
    const sdSection = (sdSplit[0] || '').replace('===SDCARD===', '');
    const restSplit = (sdSplit[1] || '').split('===HOME===');
    const rootSection = restSplit[0] || '';
    const homeSection = restSplit[1] || '';

    const sdVol = parseDfLine(sdSection, 'SD Card (/mnt/SDCARD)', '/mnt/SDCARD', 'sdcard');
    if (sdVol) volumes.push(sdVol);

    const rootVol = parseDfLine(rootSection, 'Root System (/)', '/', 'internal');
    if (rootVol) volumes.push(rootVol);

    const homeVol = parseDfLine(homeSection, 'Home Directory', '/root', 'local');
    if (
      homeVol &&
      !volumes.some((v) => v.totalBytes === homeVol.totalBytes && v.freeBytes === homeVol.freeBytes)
    ) {
      volumes.push(homeVol);
    }
  } catch {
    // ignore
  }

  return volumes;
}

export async function listSshDevices(): Promise<AndroidDevice[]> {
  const results: AndroidDevice[] = [];

  for (const target of activeSshTargets.values()) {
    try {
      const probeCmd = [
        'echo "HOSTNAME=$(uname -n 2>/dev/null)"',
        'echo "UNAME_M=$(uname -m 2>/dev/null)"',
        'echo "UNAME_R=$(uname -r 2>/dev/null)"',
        'echo "DT_MODEL=$(tr \'\\0\' \' \' < /proc/device-tree/model 2>/dev/null)"',
        'echo "OS_PRETTY=$(grep \'^PRETTY_NAME=\' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'\\"\')"',
        'echo "SYS_BAT=$(cat /sys/class/power_supply/axp2202-battery/capacity /sys/class/power_supply/BAT0/capacity /sys/class/power_supply/battery/capacity 2>/dev/null | head -n 1)"',
        'echo "HAS_MNT_SDCARD=$([ -d /mnt/SDCARD ] && echo 1 || echo 0)"',
        'echo "HOME_DIR=$HOME"',
      ].join('; ');

      const [probeOut, volumes] = await Promise.all([
        runSshCommand(target.serial, probeCmd, 7000),
        getSshVolumes(target.serial),
      ]);

      const propMap: Record<string, string> = {};
      for (const line of probeOut.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          propMap[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }

      const dtModel = (propMap.DT_MODEL || '').toLowerCase();
      const isSmartProS = dtModel.includes('sun55iw3') || dtModel.includes('tg5050');
      let model = propMap.HOSTNAME || target.host;
      let manufacturer = 'Linux SSH';

      if (isSmartProS) {
        model = 'TrimUI Smart Pro S';
        manufacturer = 'TrimUI';
      } else if (propMap.DT_MODEL) {
        model = propMap.DT_MODEL;
      }

      const bat = propMap.SYS_BAT ? Number.parseInt(propMap.SYS_BAT, 10) : null;

      results.push({
        serial: target.serial,
        state: 'device',
        model,
        manufacturer,
        product: target.host,
        androidVersion: propMap.OS_PRETTY || `Linux ${propMap.UNAME_R || ''}`.trim(),
        sdkVersion: '',
        abi: propMap.UNAME_M || '',
        batteryLevel: bat !== null && !Number.isNaN(bat) ? bat : null,
        transport: 'ssh',
        osType: 'linux',
        protocol: 'ssh',
        defaultPath:
          propMap.HAS_MNT_SDCARD === '1'
            ? '/mnt/SDCARD'
            : propMap.HOME_DIR || '/',
        volumes,
      });
    } catch {
      results.push({
        serial: target.serial,
        state: 'offline',
        model: target.host,
        manufacturer: 'Linux SSH',
        product: target.host,
        androidVersion: 'Linux',
        sdkVersion: '',
        abi: '',
        batteryLevel: null,
        transport: 'ssh',
        osType: 'linux',
        protocol: 'ssh',
        defaultPath: '/',
        volumes: [],
      });
    }
  }

  return results;
}

export async function listSshDirectory(
  serial: string,
  dirPath?: string
): Promise<DirectoryListingResponse> {
  let requestedPath = dirPath && dirPath.trim() ? dirPath.trim() : '';
  if (!requestedPath || requestedPath === '/sdcard') {
    const resolved = await runSshCommand(
      serial,
      'if [ -d /mnt/SDCARD ]; then echo "/mnt/SDCARD"; elif [ -n "$HOME" ] && [ -d "$HOME" ]; then echo "$HOME"; else echo "/"; fi',
      6000
    ).catch(() => '/');
    requestedPath = resolved.trim() || '/';
  }

  const normalized = path.posix.normalize(requestedPath);
  const currentPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const parentPath = currentPath === '/' ? null : path.posix.dirname(currentPath);

  const trailingSlashPath = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
  const escapedDir = escapeShellArg(trailingSlashPath);

  const lsCmd = `ls -la -L --time-style=+%s ${escapedDir} 2>/dev/null || ls -la -L --full-time ${escapedDir} 2>/dev/null || ls -la -L ${escapedDir} 2>/dev/null || ls -la ${escapedDir}`;

  const [lsOutput, volumes] = await Promise.all([
    runSshCommand(serial, lsCmd, 20000),
    getSshVolumes(serial).catch(() => []),
  ]);

  const entries: FileEntry[] = [];
  for (const line of lsOutput.split('\n')) {
    const parsed = parseLsLine(line, currentPath);
    if (parsed) {
      entries.push(parsed);
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  const hasTrimuiSd = volumes.some((v) => v.path === '/mnt/SDCARD');
  const bookmarks: { label: string; path: string; kind?: string }[] = hasTrimuiSd
    ? [
        { label: 'SD Card', path: '/mnt/SDCARD', kind: 'sdcard' },
        { label: 'Roms', path: '/mnt/SDCARD/Roms', kind: 'folder' },
        { label: 'Apps', path: '/mnt/SDCARD/Apps', kind: 'folder' },
        { label: 'BIOS', path: '/mnt/SDCARD/BIOS', kind: 'folder' },
        { label: 'Saves', path: '/mnt/SDCARD/Saves', kind: 'folder' },
        { label: 'RetroArch', path: '/mnt/SDCARD/RetroArch', kind: 'folder' },
        { label: 'Root (/)', path: '/', kind: 'system' },
      ]
    : [
        { label: 'Root (/)', path: '/', kind: 'system' },
        { label: 'Root Home', path: '/root', kind: 'folder' },
        { label: 'Home (/home)', path: '/home', kind: 'folder' },
        { label: '/mnt', path: '/mnt', kind: 'folder' },
        { label: '/tmp', path: '/tmp', kind: 'folder' },
        { label: '/etc', path: '/etc', kind: 'folder' },
      ];

  const matchedVol =
    volumes
      .filter((v) => currentPath === v.path || currentPath.startsWith(`${v.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0] ||
    volumes[0] ||
    null;

  return {
    currentPath,
    parentPath,
    entries,
    bookmarks,
    volume: matchedVol,
  };
}

export async function mkdirSsh(serial: string, targetPath: string): Promise<void> {
  const normalized = path.posix.normalize(targetPath.trim());
  await runSshCommand(serial, `mkdir -p ${escapeShellArg(normalized)}`);
}

export async function renameSsh(
  serial: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  const normOld = path.posix.normalize(oldPath.trim());
  const normNew = path.posix.normalize(newPath.trim());
  await runSshCommand(serial, `mv ${escapeShellArg(normOld)} ${escapeShellArg(normNew)}`);
}

export async function deleteSsh(serial: string, paths: string[]): Promise<void> {
  if (!paths || paths.length === 0) return;
  const escaped = paths
    .map((p) => path.posix.normalize(p.trim()))
    .filter((p) => p.length > 1 && p !== '/' && p !== '/mnt/SDCARD' && p !== '/root')
    .map(escapeShellArg);

  if (escaped.length === 0) {
    throw new Error('Refusing to delete root or primary mount paths');
  }
  await runSshCommand(serial, `rm -rf ${escaped.join(' ')}`, 60000);
}

export async function pushToSsh(
  serial: string,
  localPaths: string[],
  remoteDir: string
): Promise<void> {
  if (!localPaths || localPaths.length === 0) return;
  const target = getSshTarget(serial);
  const destination = target.user ? `${target.user}@${target.host}` : target.host;
  const normalizedRemoteDir = path.posix.normalize(remoteDir.trim() || '/');
  const remoteTarget = normalizedRemoteDir.endsWith('/')
    ? normalizedRemoteDir
    : `${normalizedRemoteDir}/`;

  const args = [
    ...buildSshBaseArgs(target, true),
    '-r',
    ...localPaths,
    `${destination}:${remoteTarget}`,
  ];
  await execWithOptionalPassword('scp', args, target.password, 10 * 60 * 1000);
}

export async function pullFromSsh(
  serial: string,
  remotePaths: string[],
  localDir: string
): Promise<void> {
  if (!remotePaths || remotePaths.length === 0) return;
  const target = getSshTarget(serial);
  const destination = target.user ? `${target.user}@${target.host}` : target.host;
  const resolvedLocalDir = path.resolve(localDir.trim());

  for (const remotePath of remotePaths) {
    const normRemote = path.posix.normalize(remotePath.trim());
    const args = [
      ...buildSshBaseArgs(target, true),
      '-r',
      `${destination}:${normRemote}`,
      resolvedLocalDir,
    ];
    await execWithOptionalPassword('scp', args, target.password, 10 * 60 * 1000);
  }
}

export async function listSshConfigPresets(): Promise<
  { alias: string; hostName?: string; user?: string; port?: string }[]
> {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  try {
    const content = await fs.promises.readFile(sshConfigPath, 'utf8');
    const presets: { alias: string; hostName?: string; user?: string; port?: string }[] = [];
    let current: { alias: string; hostName?: string; user?: string; port?: string } | null =
      null;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(\S+)\s+(.+)$/);
      if (!match) continue;
      const key = match[1].toLowerCase();
      const val = match[2].trim();

      if (key === 'host') {
        const firstAlias = val
          .split(/\s+/)
          .find((h) => !h.includes('*') && !h.includes('.org'));
        if (firstAlias) {
          current = { alias: firstAlias };
          presets.push(current);
        } else {
          current = null;
        }
      } else if (current) {
        if (key === 'hostname') current.hostName = val;
        if (key === 'user') current.user = val;
        if (key === 'port') current.port = val;
      }
    }
    return presets;
  } catch {
    return [];
  }
}

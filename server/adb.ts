import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AndroidDevice,
  DirectoryListingResponse,
  FileEntry,
  StorageVolume,
} from '../src/types';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function runAdb(
  args: string[],
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('adb', args, {
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
  });
  return {
    stdout: stdout.toString(),
    stderr: stderr.toString(),
  };
}

async function runAdbShell(
  serial: string,
  command: string,
  timeoutMs = 20000
): Promise<string> {
  const { stdout } = await runAdb(['-s', serial, 'shell', command], timeoutMs);
  return stdout.replace(/\r\n/g, '\n');
}

function parseDfLine(
  output: string,
  name: string,
  mountPath: string,
  kind: StorageVolume['kind']
): StorageVolume | null {
  const lines = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Filesystem'));

  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split(/\s+/);
  // Format: Filesystem 1024-blocks Used Available Capacity Mounted_on
  if (parts.length < 5) return null;

  const totalKb = Number.parseInt(parts[1], 10);
  const usedKb = Number.parseInt(parts[2], 10);
  const freeKb = Number.parseInt(parts[3], 10);

  if (Number.isNaN(totalKb) || totalKb <= 0) return null;

  return {
    name,
    path: mountPath,
    totalBytes: totalKb * 1024,
    usedBytes: (Number.isNaN(usedKb) ? 0 : usedKb) * 1024,
    freeBytes: (Number.isNaN(freeKb) ? 0 : freeKb) * 1024,
    kind,
  };
}

export async function getAndroidVolumes(serial: string): Promise<StorageVolume[]> {
  const volumes: StorageVolume[] = [];

  try {
    const sdcardDf = await runAdbShell(serial, 'df -Pk /sdcard 2>/dev/null || true');
    const internalVol = parseDfLine(sdcardDf, 'Internal Storage', '/sdcard', 'internal');
    if (internalVol) {
      volumes.push(internalVol);
    }
  } catch {
    // ignore
  }

  try {
    const storageListRaw = await runAdbShell(serial, 'ls -1 /storage 2>/dev/null || true');
    const entries = storageListRaw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'emulated' && s !== 'self');

    for (const entry of entries) {
      const volPath = `/storage/${entry}`;
      const isUuid = /^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$/.test(entry);
      const label = isUuid ? `SD Card (${entry})` : `Storage (${entry})`;
      const dfOut = await runAdbShell(
        serial,
        `df -Pk ${escapeShellArg(volPath)} 2>/dev/null || true`
      );
      const vol = parseDfLine(dfOut, label, volPath, 'sdcard');
      if (vol && vol.totalBytes > 0) {
        volumes.push(vol);
      }
    }
  } catch {
    // ignore
  }

  // Also check handheld game partitions such as /mnt/kv_games (e.g. TrimUI Smart Pro S)
  try {
    const kvDf = await runAdbShell(
      serial,
      'df -Pk /mnt/kv_games 2>/dev/null || true'
    );
    const hasKvDir = await runAdbShell(
      serial,
      '[ -d /sdcard/KV-GAMES ] && echo "yes" || echo "no"'
    );
    const kvMountPath = hasKvDir.trim() === 'yes' ? '/sdcard/KV-GAMES' : '/mnt/kv_games';
    const kvVol = parseDfLine(kvDf, 'Games SD (KV-GAMES)', kvMountPath, 'sdcard');
    if (
      kvVol &&
      kvVol.totalBytes > 0 &&
      !volumes.some((v) => v.totalBytes === kvVol.totalBytes)
    ) {
      volumes.push(kvVol);
    }
  } catch {
    // ignore
  }

  return volumes;
}

export async function listDevices(): Promise<AndroidDevice[]> {
  let stdout = '';
  try {
    const res = await runAdb(['devices', '-l'], 10000);
    stdout = res.stdout;
  } catch {
    return [];
  }

  const lines = stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('List of devices') && !line.startsWith('*'));

  const devices: AndroidDevice[] = [];

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) continue;

    const [, serial, state, rest = ''] = match;
    const tokens: Record<string, string> = {};
    for (const part of rest.split(/\s+/)) {
      const idx = part.indexOf(':');
      if (idx > 0) {
        tokens[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }

    const isWifi =
      serial.includes(':') ||
      serial.includes('._adb-tls-') ||
      (!('usb' in tokens) && /^\d+\.\d+\.\d+\.\d+/.test(serial));

    const deviceInfo: AndroidDevice = {
      serial,
      state,
      model: (tokens.model || serial).replace(/_/g, ' '),
      manufacturer: '',
      product: tokens.product || '',
      androidVersion: '',
      sdkVersion: '',
      abi: '',
      batteryLevel: null,
      transport: isWifi ? 'wifi' : 'usb',
      volumes: [],
    };

    if (state === 'device') {
      try {
        const propCmd = [
          'echo "MODEL=$(getprop ro.product.model)"',
          'echo "MANUFACTURER=$(getprop ro.product.manufacturer)"',
          'echo "PRODUCT=$(getprop ro.product.name)"',
          'echo "RELEASE=$(getprop ro.build.version.release)"',
          'echo "SDK=$(getprop ro.build.version.sdk)"',
          'echo "ABI=$(getprop ro.product.cpu.abi)"',
        ].join('; ');

        const [propOut, batteryOut, volumes] = await Promise.all([
          runAdbShell(serial, propCmd, 8000).catch(() => ''),
          runAdbShell(serial, 'dumpsys battery', 8000).catch(() => ''),
          getAndroidVolumes(serial).catch(() => []),
        ]);

        const propMap: Record<string, string> = {};
        for (const pLine of propOut.split('\n')) {
          const eqIdx = pLine.indexOf('=');
          if (eqIdx > 0) {
            const key = pLine.slice(0, eqIdx).trim();
            const val = pLine.slice(eqIdx + 1).trim();
            propMap[key] = val;
          }
        }

        if (propMap.MODEL) deviceInfo.model = propMap.MODEL;
        if (propMap.MANUFACTURER) deviceInfo.manufacturer = propMap.MANUFACTURER;
        if (propMap.PRODUCT) deviceInfo.product = propMap.PRODUCT;
        if (propMap.RELEASE) deviceInfo.androidVersion = propMap.RELEASE;
        if (propMap.SDK) deviceInfo.sdkVersion = propMap.SDK;
        if (propMap.ABI) deviceInfo.abi = propMap.ABI;

        const batMatch = batteryOut.match(/level:\s*(\d+)/i);
        if (batMatch) {
          const parsedBat = Number.parseInt(batMatch[1], 10);
          if (!Number.isNaN(parsedBat)) {
            deviceInfo.batteryLevel = parsedBat;
          }
        }

        deviceInfo.volumes = volumes;
      } catch {
        // Keep fallback tokens if shell queries fail
      }
    }

    devices.push(deviceInfo);
  }

  return devices;
}

export async function connectWirelessDevice(
  address: string
): Promise<{ ok: boolean; message: string }> {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, message: 'Device address is required' };
  }
  try {
    const { stdout, stderr } = await runAdb(['connect', trimmed], 15000);
    const combined = `${stdout}\n${stderr}`.trim();
    const lower = combined.toLowerCase();
    const ok =
      (lower.includes('connected to') || lower.includes('already connected')) &&
      !lower.includes('failed to connect') &&
      !lower.includes('cannot connect');
    return {
      ok,
      message: combined || (ok ? `Connected to ${trimmed}` : `Failed to connect to ${trimmed}`),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export async function disconnectDevice(
  address: string
): Promise<{ ok: boolean; message: string }> {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, message: 'Device address is required' };
  }
  try {
    const { stdout, stderr } = await runAdb(['disconnect', trimmed], 10000);
    const combined = `${stdout}\n${stderr}`.trim();
    return {
      ok: true,
      message: combined || `Disconnected ${trimmed}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export async function captureScreenshot(serial: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, 'exec-out', 'screencap', '-p']);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out capturing screenshot from Android device'));
    }, 15000);

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      errChunks.push(chunk);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length === 0) {
        const errMsg = Buffer.concat(errChunks).toString() || `screencap exited with code ${code}`;
        reject(new Error(errMsg.trim()));
        return;
      }
      resolve(buffer);
    });
  });
}

function parseLsLine(line: string, parentDir: string): FileEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('total ')) return null;

  // Pattern 1: --time-style=+%s (Unix timestamp in seconds)
  // e.g. drwxrwx--- 2 u0_a48 u0_a48 4096 1793011190 Alarms
  const epochMatch = trimmed.match(
    /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+(?:\d+\s+)?\S+\s+\S+\s+(\d+)\s+(\d{9,12})\s+(.+)$/
  );

  // Pattern 2: Standard Android Toybox / GNU ls date time
  // e.g. drwxrwx--- 2 u0_a48 u0_a48 4096 2026-10-26 17:39 Alarms
  const isoMatch = !epochMatch
    ? trimmed.match(
        /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+(?:\d+\s+)?\S+\s+\S+\s+(\d+)?\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s+[+-]\d{4})?)\s+(.+)$/
      )
    : null;

  let permissions = '';
  let size = 0;
  let mtime = 0;
  let rawName = '';

  if (epochMatch) {
    permissions = epochMatch[1];
    size = Number.parseInt(epochMatch[2], 10) || 0;
    mtime = Number.parseInt(epochMatch[3], 10) || 0;
    rawName = epochMatch[4];
  } else if (isoMatch) {
    permissions = isoMatch[1];
    size = Number.parseInt(isoMatch[2] || '0', 10) || 0;
    const dateStr = `${isoMatch[3]}T${isoMatch[4].slice(0, 5)}:00`;
    const parsedTime = Date.parse(dateStr);
    mtime = Number.isNaN(parsedTime) ? 0 : Math.floor(parsedTime / 1000);
    rawName = isoMatch[5];
  } else {
    return null;
  }

  const isSymlink = permissions.startsWith('l');
  let name = rawName;
  if (isSymlink && rawName.includes(' -> ')) {
    name = rawName.split(' -> ')[0];
  }

  if (name === '.' || name === '..' || name === '') {
    return null;
  }

  const isDirectory = permissions.startsWith('d');
  const entryPath = path.posix.join(parentDir, name);
  const ext = !isDirectory && name.includes('.') ? path.posix.extname(name).slice(1).toLowerCase() : undefined;

  return {
    name,
    path: entryPath,
    isDirectory,
    isSymlink: isSymlink || undefined,
    size,
    mtime,
    permissions: permissions.slice(0, 10),
    extension: ext || undefined,
  };
}

export async function listAndroidDirectory(
  serial: string,
  dirPath = '/sdcard'
): Promise<DirectoryListingResponse> {
  const rawTarget = dirPath && dirPath.trim() ? dirPath.trim() : '/sdcard';
  const normalized = path.posix.normalize(rawTarget);
  const currentPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const parentPath = currentPath === '/' ? null : path.posix.dirname(currentPath);

  const trailingSlashPath = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
  const escapedDir = escapeShellArg(trailingSlashPath);

  // Use -L so symlinks to directories (like /sdcard, /storage/self/primary, or ROM folders) resolve as directories
  const lsCmd = `ls -la -L --time-style=+%s ${escapedDir} 2>/dev/null || ls -la -L ${escapedDir} 2>/dev/null || ls -la ${escapedDir}`;

  const [lsOutput, volumes] = await Promise.all([
    runAdbShell(serial, lsCmd, 20000),
    getAndroidVolumes(serial).catch(() => []),
  ]);

  if (
    lsOutput.includes('No such file or directory') ||
    lsOutput.includes('Not a directory') ||
    lsOutput.includes('Permission denied')
  ) {
    const firstLine = lsOutput.split('\n').find((l) => l.trim().length > 0) || 'Unable to list directory';
    if (!lsOutput.includes('total ')) {
      throw new Error(firstLine.trim());
    }
  }

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

  const bookmarks: { label: string; path: string; kind?: string }[] = [
    { label: 'Internal Storage', path: '/sdcard', kind: 'internal' },
    { label: 'Downloads', path: '/sdcard/Download', kind: 'folder' },
    { label: 'DCIM', path: '/sdcard/DCIM', kind: 'folder' },
    { label: 'Pictures', path: '/sdcard/Pictures', kind: 'folder' },
    { label: 'Music', path: '/sdcard/Music', kind: 'folder' },
    { label: 'Movies', path: '/sdcard/Movies', kind: 'folder' },
    { label: 'Documents', path: '/sdcard/Documents', kind: 'folder' },
    { label: 'Android Media', path: '/sdcard/Android/media', kind: 'folder' },
  ];

  // Add detected external SD card or handheld game volumes to bookmarks
  for (const vol of volumes) {
    if (vol.kind === 'sdcard' && !bookmarks.some((b) => b.path === vol.path)) {
      bookmarks.push({
        label: vol.name,
        path: vol.path,
        kind: 'sdcard',
      });
    }
  }

  // Determine active volume for currentPath
  let activeVolume: StorageVolume | null = null;
  const kvVol = volumes.find((v) => v.path === '/sdcard/KV-GAMES' || v.path === '/mnt/kv_games');
  if (
    kvVol &&
    (currentPath.startsWith('/sdcard/KV-GAMES') ||
      currentPath.startsWith('/mnt/kv_games') ||
      currentPath.startsWith('/sdcard/Roms') ||
      currentPath.startsWith('/sdcard/BIOS') ||
      currentPath.startsWith('/sdcard/Imgs'))
  ) {
    activeVolume = kvVol;
  } else {
    const matched = volumes
      .filter((v) => currentPath === v.path || currentPath.startsWith(`${v.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (matched) {
      activeVolume = matched;
    } else {
      try {
        const dfOut = await runAdbShell(
          serial,
          `df -Pk ${escapeShellArg(currentPath)} 2>/dev/null || true`
        );
        activeVolume =
          parseDfLine(dfOut, 'Device Storage', currentPath, 'internal') ||
          volumes[0] ||
          null;
      } catch {
        activeVolume = volumes[0] || null;
      }
    }
  }

  return {
    currentPath,
    parentPath,
    entries,
    bookmarks,
    volume: activeVolume,
  };
}

export async function mkdirAndroid(serial: string, targetPath: string): Promise<void> {
  const normalized = path.posix.normalize(targetPath.trim());
  await runAdbShell(serial, `mkdir -p ${escapeShellArg(normalized)}`);
}

export async function renameAndroid(
  serial: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  const normOld = path.posix.normalize(oldPath.trim());
  const normNew = path.posix.normalize(newPath.trim());
  await runAdbShell(serial, `mv ${escapeShellArg(normOld)} ${escapeShellArg(normNew)}`);
}

export async function deleteAndroid(serial: string, paths: string[]): Promise<void> {
  if (!paths || paths.length === 0) return;
  const escaped = paths
    .map((p) => path.posix.normalize(p.trim()))
    .filter((p) => p.length > 1 && p !== '/' && p !== '/sdcard')
    .map(escapeShellArg);

  if (escaped.length === 0) {
    throw new Error('Refusing to delete root or empty paths');
  }

  await runAdbShell(serial, `rm -rf ${escaped.join(' ')}`, 60000);
}

export async function pushToAndroid(
  serial: string,
  localPaths: string[],
  remoteDir: string
): Promise<void> {
  if (!localPaths || localPaths.length === 0) return;
  const normalizedRemoteDir = path.posix.normalize(remoteDir.trim() || '/sdcard');
  const targetDirWithSlash = normalizedRemoteDir.endsWith('/')
    ? normalizedRemoteDir
    : `${normalizedRemoteDir}/`;

  // Push files via adb push (timeout 10 minutes for large transfers)
  await runAdb(['-s', serial, 'push', ...localPaths, targetDirWithSlash], 10 * 60 * 1000);

  // Trigger Android MediaScanner for pushed items (best-effort)
  try {
    const scanCommands = localPaths.map((localFile) => {
      const base = path.basename(localFile);
      const remoteFile = path.posix.join(normalizedRemoteDir, base);
      const fileUri = `file://${remoteFile}`;
      return `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${escapeShellArg(fileUri)} >/dev/null 2>&1 || true`;
    });
    if (scanCommands.length > 0 && scanCommands.length <= 25) {
      await runAdbShell(serial, scanCommands.join('; '), 10000);
    }
  } catch {
    // Non-fatal if media scanner fails
  }
}

export async function pullFromAndroid(
  serial: string,
  remotePaths: string[],
  localDir: string
): Promise<void> {
  if (!remotePaths || remotePaths.length === 0) return;
  const resolvedLocalDir = path.resolve(localDir.trim());

  for (const remotePath of remotePaths) {
    const normRemote = path.posix.normalize(remotePath.trim());
    await runAdb(['-s', serial, 'pull', '-a', normRemote, resolvedLocalDir], 10 * 60 * 1000);
  }
}

export async function installApkOnAndroid(
  serial: string,
  localApkPath: string
): Promise<string> {
  const resolvedApk = path.resolve(localApkPath.trim());
  const { stdout, stderr } = await runAdb(
    ['-s', serial, 'install', '-r', resolvedApk],
    5 * 60 * 1000
  );
  const combined = `${stdout}\n${stderr}`.trim();
  if (!/success/i.test(combined)) {
    throw new Error(combined || 'APK installation failed');
  }
  return combined;
}

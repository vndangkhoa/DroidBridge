import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AdbDiagnostics,
  AndroidDevice,
  DirectoryListingResponse,
  FileEntry,
  StorageVolume,
  WindowsUsbDeviceDiagnostic,
} from '../src/types';

export type { AdbDiagnostics, WindowsUsbDeviceDiagnostic };

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

const REQUIRED_ADB_VENDOR_IDS = ['0x1f3a', '0x18d1', '0x2207', '0x1d6b'];
let usbVendorIdsSeeded = false;
let lastAdbError: string | undefined;

export function ensureAdbUsbVendorIds(): void {
  if (usbVendorIdsSeeded) return;
  usbVendorIdsSeeded = true;
  try {
    const androidDir = path.join(os.homedir(), '.android');
    const iniPath = path.join(androidDir, 'adb_usb.ini');
    fs.mkdirSync(androidDir, { recursive: true });

    let existingContent = '';
    if (fs.existsSync(iniPath)) {
      existingContent = fs.readFileSync(iniPath, 'utf-8');
    }

    const existingLines = new Set(
      existingContent
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    );

    const missingIds = REQUIRED_ADB_VENDOR_IDS.filter(
      (id) => !existingLines.has(id.toLowerCase())
    );

    if (missingIds.length > 0) {
      const prefix =
        existingContent.length > 0 && !existingContent.endsWith('\n')
          ? '\n'
          : '';
      const header =
        existingContent.length === 0
          ? '# ANDROID 3RD PARTY USB VENDOR ID LIST -- MANAGED BY DROIDBRIDGE\n'
          : '';
      const addition = `${prefix}${header}${missingIds.join('\n')}\n`;
      fs.appendFileSync(iniPath, addition, 'utf-8');
    }
  } catch {
    // Ignore filesystem errors on restricted environments
  }
}

export function resolveAdbBinary(): string {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }

  const home = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;

  const candidates: string[] =
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/adb',
          '/usr/local/bin/adb',
          path.join(home, 'Library/Android/sdk/platform-tools/adb'),
        ]
      : process.platform === 'win32'
        ? [
            resourcesPath ? path.join(resourcesPath, 'bin/win32/adb.exe') : '',
            path.resolve(process.cwd(), 'resources/bin/win32/adb.exe'),
            path.resolve(__dirname, '../resources/bin/win32/adb.exe'),
            path.resolve(__dirname, '../../resources/bin/win32/adb.exe'),
            path.join(localAppData, 'Android/Sdk/platform-tools/adb.exe'),
            'C:\\platform-tools\\adb.exe',
            'C:\\Android\\platform-tools\\adb.exe',
            'C:\\Program Files (x86)\\Android\\android-sdk\\platform-tools\\adb.exe',
            'C:\\Program Files\\Android\\android-sdk\\platform-tools\\adb.exe',
            path.join(localAppData, 'Microsoft/WinGet/Links/adb.exe'),
            path.join(home, 'scoop/apps/adb/current/adb.exe'),
            path.join(home, 'scoop/shims/adb.exe'),
            'C:\\ProgramData\\chocolatey\\bin\\adb.exe',
          ]
        : [
            '/usr/bin/adb',
            '/usr/local/bin/adb',
            path.join(home, 'Android/Sdk/platform-tools/adb'),
          ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function runAdb(
  args: string[],
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string }> {
  ensureAdbUsbVendorIds();
  const { stdout, stderr } = await execFileAsync(resolveAdbBinary(), args, {
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    stdout: stdout.toString(),
    stderr: stderr.toString(),
  };
}

export async function runAdbShell(
  serial: string,
  command: string,
  timeoutMs = 20000
): Promise<string> {
  const { stdout } = await runAdb(['-s', serial, 'shell', command], timeoutMs);
  return stdout.replace(/\r\n/g, '\n');
}

export function parseDfLine(
  output: string,
  name: string,
  mountPath: string,
  kind: StorageVolume['kind']
): StorageVolume | null {
  const lines = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Filesystem') && !l.startsWith('df:'));

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

  // 1. Check standard Android /sdcard
  try {
    const sdcardDf = await runAdbShell(
      serial,
      '[ -e /sdcard ] && df -Pk /sdcard 2>/dev/null || true'
    );
    const internalVol = parseDfLine(sdcardDf, 'Internal Storage', '/sdcard', 'internal');
    if (internalVol) {
      volumes.push(internalVol);
    }
  } catch {
    // ignore
  }

  // 2. Check Linux Handheld / TrimUI /mnt/SDCARD
  try {
    const trimuiSdDf = await runAdbShell(
      serial,
      '[ -d /mnt/SDCARD ] && df -Pk /mnt/SDCARD 2>/dev/null || true'
    );
    const trimuiVol = parseDfLine(trimuiSdDf, 'SD Card (/mnt/SDCARD)', '/mnt/SDCARD', 'sdcard');
    if (
      trimuiVol &&
      trimuiVol.totalBytes > 0 &&
      !volumes.some((v) => v.path === trimuiVol.path)
    ) {
      volumes.push(trimuiVol);
    }
  } catch {
    // ignore
  }

  // 3. Check Android /storage/<UUID>
  try {
    const storageListRaw = await runAdbShell(
      serial,
      '[ -d /storage ] && ls -1 /storage 2>/dev/null || true'
    );
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

  // 4. Check handheld game partitions such as /mnt/kv_games
  try {
    const kvDf = await runAdbShell(
      serial,
      '[ -d /mnt/kv_games ] && df -Pk /mnt/kv_games 2>/dev/null || true'
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

  // 5. Fallback to Linux root filesystem (/) if no /sdcard volume was found
  if (!volumes.some((v) => v.kind === 'internal')) {
    try {
      const rootDf = await runAdbShell(serial, 'df -Pk / 2>/dev/null || true');
      const rootVol = parseDfLine(rootDf, 'Root System (/)', '/', 'system');
      if (rootVol) {
        volumes.push(rootVol);
      }
    } catch {
      // ignore
    }
  }

  return volumes;
}

export async function listDevices(): Promise<AndroidDevice[]> {
  let stdout = '';
  try {
    const res = await runAdb(['devices', '-l'], 10000);
    stdout = res.stdout;
    lastAdbError = undefined;
  } catch (err: unknown) {
    lastAdbError = err instanceof Error ? err.message : String(err);
    return [];
  }

  const lines = stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('List of devices') &&
        !line.startsWith('*')
    );

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
      osType: 'android',
      protocol: 'adb',
      defaultPath: '/sdcard',
      volumes: [],
    };

    if (state === 'device') {
      try {
        const probeCmd = [
          'echo "MODEL=$(getprop ro.product.model 2>/dev/null)"',
          'echo "MANUFACTURER=$(getprop ro.product.manufacturer 2>/dev/null)"',
          'echo "PRODUCT=$(getprop ro.product.name 2>/dev/null)"',
          'echo "RELEASE=$(getprop ro.build.version.release 2>/dev/null)"',
          'echo "SDK=$(getprop ro.build.version.sdk 2>/dev/null)"',
          'echo "ABI=$(getprop ro.product.cpu.abi 2>/dev/null)"',
          'echo "UNAME_M=$(uname -m 2>/dev/null)"',
          'echo "UNAME_R=$(uname -r 2>/dev/null)"',
          'echo "HOSTNAME=$(cat /etc/hostname 2>/dev/null | head -n 1)"',
          'echo "DT_MODEL=$(tr \'\\0\' \' \' < /proc/device-tree/model 2>/dev/null)"',
          'echo "OS_PRETTY=$(grep \'^PRETTY_NAME=\' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'\\"\')"',
          'echo "SYS_BAT=$(cat /sys/class/power_supply/axp2202-battery/capacity /sys/class/power_supply/BAT0/capacity /sys/class/power_supply/battery/capacity 2>/dev/null | head -n 1)"',
          'echo "HAS_SDCARD=$([ -e /sdcard ] && echo 1 || echo 0)"',
          'echo "HAS_MNT_SDCARD=$([ -d /mnt/SDCARD ] && echo 1 || echo 0)"',
          'echo "HAS_KVOS=$([ -x /mnt/SDCARD/.system/bin/gamma_launcher ] && echo 1 || echo 0)"',
        ].join('; ');

        const [propOut, batteryOut, volumes] = await Promise.all([
          runAdbShell(serial, probeCmd, 8000).catch(() => ''),
          runAdbShell(serial, 'dumpsys battery 2>/dev/null || true', 5000).catch(() => ''),
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

        const isAndroid = Boolean(propMap.RELEASE || propMap.SDK);

        if (isAndroid) {
          deviceInfo.osType = 'android';
          if (propMap.MODEL) deviceInfo.model = propMap.MODEL;
          if (propMap.MANUFACTURER) deviceInfo.manufacturer = propMap.MANUFACTURER;
          if (propMap.PRODUCT) deviceInfo.product = propMap.PRODUCT;
          if (propMap.RELEASE) deviceInfo.androidVersion = propMap.RELEASE;
          if (propMap.SDK) deviceInfo.sdkVersion = propMap.SDK;
          if (propMap.ABI) deviceInfo.abi = propMap.ABI;
          deviceInfo.defaultPath = '/sdcard';
        } else {
          // Linux device over ADB (e.g. TrimUI Smart Pro S / Brick Pro / Linux SBC)
          deviceInfo.osType = 'linux';
          const dtModel = (propMap.DT_MODEL || '').toLowerCase();
          const isSmartProS =
            dtModel.includes('sun55iw3') || dtModel.includes('tg5050');
          const isTrimuiBrickOrPro =
            dtModel.includes('sun50iw10') ||
            dtModel.includes('tg4040') ||
            dtModel.includes('tg3040') ||
            dtModel.includes('tg5040');

          if (isSmartProS) {
            deviceInfo.model = 'TrimUI Smart Pro S';
            deviceInfo.manufacturer = 'TrimUI';
            deviceInfo.product = 'TG5050';
          } else if (isTrimuiBrickOrPro) {
            deviceInfo.model = 'TrimUI Handheld';
            deviceInfo.manufacturer = 'TrimUI';
            deviceInfo.product = propMap.DT_MODEL || 'Allwinner A133P';
          } else {
            deviceInfo.model =
              propMap.DT_MODEL || propMap.HOSTNAME || serial;
            deviceInfo.manufacturer = 'Linux';
            deviceInfo.product = propMap.HOSTNAME || 'Linux Device';
          }

          deviceInfo.androidVersion =
            propMap.HAS_KVOS === '1'
              ? `KV-OS (${propMap.UNAME_R || 'Linux'})`
              : propMap.OS_PRETTY || `Linux ${propMap.UNAME_R || ''}`.trim();
          deviceInfo.abi = propMap.UNAME_M || '';
          deviceInfo.defaultPath =
            propMap.HAS_MNT_SDCARD === '1'
              ? '/mnt/SDCARD'
              : propMap.HAS_SDCARD === '1'
              ? '/sdcard'
              : '/';
        }

        // Battery parsing (Android dumpsys OR Linux /sys/class/power_supply)
        const batMatch = batteryOut.match(/level:\s*(\d+)/i);
        if (batMatch) {
          const parsedBat = Number.parseInt(batMatch[1], 10);
          if (!Number.isNaN(parsedBat)) {
            deviceInfo.batteryLevel = parsedBat;
          }
        } else if (propMap.SYS_BAT) {
          const parsedSysBat = Number.parseInt(propMap.SYS_BAT, 10);
          if (!Number.isNaN(parsedSysBat)) {
            deviceInfo.batteryLevel = parsedSysBat;
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

export async function getAdbDiagnostics(
  connectedCount = 0
): Promise<AdbDiagnostics> {
  const adbBinaryPath = resolveAdbBinary();
  let adbAvailable = false;

  if (path.isAbsolute(adbBinaryPath) && fs.existsSync(adbBinaryPath)) {
    adbAvailable = !lastAdbError || !/ENOENT|not found|not recognized/i.test(lastAdbError);
  } else if (!lastAdbError) {
    try {
      await execFileAsync(adbBinaryPath, ['version'], {
        timeout: 3000,
        windowsHide: true,
      });
      adbAvailable = true;
    } catch (err: unknown) {
      adbAvailable = false;
      lastAdbError = err instanceof Error ? err.message : String(err);
    }
  }

  let windowsUsbDevices: WindowsUsbDeviceDiagnostic[] | undefined;
  let usbHint: string | undefined;

  if (process.platform === 'win32' && connectedCount === 0) {
    try {
      const psCmd =
        "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_1F3A|VID_18D1|VID_2207' -or $_.FriendlyName -match 'TrimUI|Smart Pro|ADB|Android|MTP' } | Select-Object FriendlyName,InstanceId,Status,Class,ConfigManagerErrorCode | ConvertTo-Json -Compress";
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        {
          timeout: 4000,
          windowsHide: true,
        }
      );

      const trimmed = stdout.toString().trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed);
        const rawList = Array.isArray(parsed) ? parsed : [parsed];
        windowsUsbDevices = rawList
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const name = String(item.FriendlyName || 'USB Device');
            const instanceId = String(item.InstanceId || '');
            const status = String(item.Status || 'Unknown');
            const cls = String(item.Class || '');
            const errCode = Number(item.ConfigManagerErrorCode ?? 0);
            const needsDriver =
              errCode !== 0 || status.toLowerCase() !== 'ok';
            const isMtpOnly =
              !needsDriver &&
              (/\b(mtp|wpd)\b/i.test(name) ||
                /\b(wpd|portable)/i.test(cls) ||
                (instanceId.toUpperCase().includes('VID_1F3A') &&
                  !/adb|androidusbdeviceclass/i.test(`${name} ${cls}`)));

            return {
              name,
              instanceId,
              status,
              needsDriver,
              isMtpOnly,
            };
          });
      } else {
        windowsUsbDevices = [];
      }
    } catch {
      windowsUsbDevices = [];
    }
  }

  if (!adbAvailable) {
    usbHint =
      'ADB binary could not be executed. Check bundled resources/bin/win32/adb.exe or install Android SDK Platform-Tools.';
  } else if (process.platform === 'win32' && connectedCount === 0) {
    if (windowsUsbDevices?.some((d) => d.needsDriver)) {
      usbHint =
        'USB handheld detected in Windows Device Manager with a missing WinUSB ADB driver. Install the WinUSB driver for "ADB Interface" (VID_1F3A / VID_18D1) via Zadig or Windows Update, or connect wirelessly over Wi-Fi (SSH / P2P).';
    } else if (windowsUsbDevices?.some((d) => d.isMtpOnly)) {
      usbHint =
        'Device is connected in MTP-only mode without an active ADB USB interface. In KV-Android Control Center (Trung tâm nhanh via MENU), toggle "Cổng USB" from "Chỉ sạc" to "MTP + ADB" (blue), or connect wirelessly over Wi-Fi.';
    } else {
      usbHint =
        'No USB ADB device detected. On TrimUI Smart Pro S, plug a data-capable USB-C cable into the bottom USB-C port (labeled DC, next to the MicroSD slot — NOT the top HOST port) and toggle "Cổng USB" in KV-Android Control Center (Trung tâm nhanh) from "Chỉ sạc" to "MTP + ADB", or connect over Wi-Fi.';
    }
  } else if (connectedCount === 0) {
    usbHint =
      'No USB ADB device detected. On TrimUI Smart Pro S, plug a data-capable USB-C cable into the bottom USB-C port (labeled DC, next to the MicroSD slot — NOT the top HOST port) and toggle "Cổng USB" in KV-Android Control Center (Trung tâm nhanh) from "Chỉ sạc" to "MTP + ADB", or connect over Wi-Fi.';
  }

  return {
    adbBinaryPath,
    adbAvailable,
    adbError: lastAdbError,
    platform: process.platform,
    usbHint,
    windowsUsbDevices,
  };
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
      message:
        combined ||
        (ok ? `Connected to ${trimmed}` : `Failed to connect to ${trimmed}`),
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
  // 1. Check if standard Android screencap exists on the device
  const hasScreencap = await runAdbShell(
    serial,
    'command -v screencap >/dev/null 2>&1 && echo "yes" || echo "no"',
    5000
  ).catch(() => 'no');

  if (hasScreencap.trim() === 'yes') {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        resolveAdbBinary(),
        ['-s', serial, 'exec-out', 'screencap', '-p'],
        { windowsHide: true }
      );
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
          const errMsg =
            Buffer.concat(errChunks).toString() ||
            `screencap exited with code ${code}`;
          reject(new Error(errMsg.trim()));
          return;
        }
        resolve(buffer);
      });
    });
  }

  // 2. Fallback for Linux / TrimUI Smart Pro S (DRM Plane 93 dumb buffer or /dev/fb0)
  const tempId = crypto.randomUUID();
  const localRaw = path.join(os.tmpdir(), `droidbridge-fb-${tempId}.raw`);
  const localPng = path.join(os.tmpdir(), `droidbridge-fb-${tempId}.png`);
  const remoteRaw = `/tmp/droidbridge-fb.raw`;

  try {
    const dumpScript = `
      pid=$(pidof gamma_launcher 2>/dev/null | awk '{print $1}')
      if [ -n "$pid" ] && grep -q "/dev/dri/card0" /proc/$pid/maps 2>/dev/null; then
        addr_hex=$(grep "/dev/dri/card0" /proc/$pid/maps | head -n 1 | cut -d"-" -f1)
        dd if=/proc/$pid/mem of=${remoteRaw} bs=4096 skip=$((0x$addr_hex / 4096)) count=900 2>/dev/null
        echo "MODE=DRM_1280x720"
      elif [ -e /dev/fb0 ]; then
        dd if=/dev/fb0 of=${remoteRaw} bs=3686400 count=1 2>/dev/null
        echo "MODE=FB0_1280x720"
      else
        echo "MODE=NONE"
      fi
    `;
    const dumpOut = await runAdbShell(serial, dumpScript, 10000);
    if (dumpOut.includes('MODE=NONE')) {
      throw new Error('No Android screencap or Linux framebuffer found on device');
    }

    await runAdb(['-s', serial, 'pull', remoteRaw, localRaw], 15000);
    await runAdbShell(serial, `rm -f ${remoteRaw}`, 5000).catch(() => {});

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'rawvideo',
        '-pixel_format',
        'bgr0',
        '-video_size',
        '1280x720',
        '-i',
        localRaw,
        '-frames:v',
        '1',
        localPng,
      ],
      { windowsHide: true }
    );

    const pngBuffer = await fs.promises.readFile(localPng);
    return pngBuffer;
  } finally {
    await fs.promises.rm(localRaw, { force: true }).catch(() => {});
    await fs.promises.rm(localPng, { force: true }).catch(() => {});
  }
}

const MONTHS_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function parseLsLine(line: string, parentDir: string): FileEntry | null {
  // Strip any ANSI color escape sequences emitted by BusyBox/GNU ls
  const cleanedLine = line.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  const trimmed = cleanedLine.trim();
  if (!trimmed || trimmed.startsWith('total ')) return null;

  // Pattern 1: --time-style=+%s (Unix timestamp in seconds)
  // e.g. drwxrwx--- 2 u0_a48 u0_a48 4096 1793011190 Alarms
  const epochMatch = trimmed.match(
    /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+(?:\d+\s+)?\S+\s+\S+\s+(\d+)\s+(\d{9,12})\s+(.+)$/
  );

  // Pattern 2: ISO / --full-time (Toybox, GNU ls, or BusyBox --full-time)
  // e.g. drwxrwxrwx 27 root root 32768 2026-10-24 23:05:00 +0700 Apps
  const isoMatch = !epochMatch
    ? trimmed.match(
        /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+(?:\d+\s+)?\S+\s+\S+\s+(\d+)?\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s+[+-]\d{4})?)\s+(.+)$/
      )
    : null;

  // Pattern 3: BusyBox / traditional POSIX ls -la (MMM DD HH:MM or MMM DD YYYY)
  // e.g. drwxrwxrwx 27 root root 32768 Oct 24 23:05 Apps
  // e.g. drwxrwxrwx 2 root root 32768 Jan  1  2022 Books
  const traditionalMatch =
    !epochMatch && !isoMatch
      ? trimmed.match(
          /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+(?:\d+\s+)?\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}|\d{4})\s+(.+)$/
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
  } else if (traditionalMatch) {
    permissions = traditionalMatch[1];
    size = Number.parseInt(traditionalMatch[2], 10) || 0;
    const monthIdx = MONTHS_MAP[traditionalMatch[3].toLowerCase()] ?? 0;
    const day = Number.parseInt(traditionalMatch[4], 10) || 1;
    const timeOrYear = traditionalMatch[5];
    const nowYear = new Date().getFullYear();
    if (timeOrYear.includes(':')) {
      const [hh, mm] = timeOrYear.split(':').map((n) => Number.parseInt(n, 10) || 0);
      mtime = Math.floor(new Date(nowYear, monthIdx, day, hh, mm).getTime() / 1000);
    } else {
      const year = Number.parseInt(timeOrYear, 10) || nowYear;
      mtime = Math.floor(new Date(year, monthIdx, day, 0, 0).getTime() / 1000);
    }
    rawName = traditionalMatch[6];
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
  const ext =
    !isDirectory && name.includes('.')
      ? path.posix.extname(name).slice(1).toLowerCase()
      : undefined;

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
  dirPath?: string
): Promise<DirectoryListingResponse> {
  // Resolve default directory if dirPath is missing or if /sdcard does not exist on a Linux device
  let requestedPath = dirPath && dirPath.trim() ? dirPath.trim() : '';
  if (!requestedPath || requestedPath === '/sdcard') {
    const resolvedDefault = await runAdbShell(
      serial,
      `if [ -n ${escapeShellArg(requestedPath)} ] && [ -e ${escapeShellArg(
        requestedPath
      )} ]; then echo ${escapeShellArg(
        requestedPath
      )}; elif [ -d /mnt/SDCARD ]; then echo "/mnt/SDCARD"; elif [ -e /sdcard ]; then echo "/sdcard"; elif [ -d /root ]; then echo "/root"; else echo "/"; fi`,
      6000
    ).catch(() => requestedPath || '/sdcard');
    requestedPath = resolvedDefault.trim() || '/sdcard';
  }

  const normalized = path.posix.normalize(requestedPath);
  const currentPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const parentPath = currentPath === '/' ? null : path.posix.dirname(currentPath);

  const trailingSlashPath = currentPath.endsWith('/')
    ? currentPath
    : `${currentPath}/`;
  const escapedDir = escapeShellArg(trailingSlashPath);

  // Support Toybox/GNU (--time-style=+%s), BusyBox (--full-time), and standard POSIX ls -la
  const lsCmd = `ls -la -L --time-style=+%s ${escapedDir} 2>/dev/null || ls -la -L --full-time ${escapedDir} 2>/dev/null || ls -la -L ${escapedDir} 2>/dev/null || ls -la ${escapedDir}`;

  const [lsOutput, volumes] = await Promise.all([
    runAdbShell(serial, lsCmd, 20000),
    getAndroidVolumes(serial).catch(() => []),
  ]);

  if (
    lsOutput.includes('No such file or directory') ||
    lsOutput.includes('Not a directory') ||
    lsOutput.includes('Permission denied')
  ) {
    const firstLine =
      lsOutput.split('\n').find((l) => l.trim().length > 0) ||
      'Unable to list directory';
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
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  const isTrimuiOrLinux =
    volumes.some((v) => v.path === '/mnt/SDCARD') ||
    !volumes.some((v) => v.path === '/sdcard');

  const bookmarks: { label: string; path: string; kind?: string }[] = isTrimuiOrLinux
    ? [
        { label: 'SD Card', path: '/mnt/SDCARD', kind: 'sdcard' },
        { label: 'Roms', path: '/mnt/SDCARD/Roms', kind: 'folder' },
        { label: 'Apps', path: '/mnt/SDCARD/Apps', kind: 'folder' },
        { label: 'BIOS', path: '/mnt/SDCARD/BIOS', kind: 'folder' },
        { label: 'Saves', path: '/mnt/SDCARD/Saves', kind: 'folder' },
        { label: 'RetroArch', path: '/mnt/SDCARD/RetroArch', kind: 'folder' },
        { label: 'PortMaster', path: '/mnt/SDCARD/PortMaster', kind: 'folder' },
        { label: 'Imgs', path: '/mnt/SDCARD/Imgs', kind: 'folder' },
        { label: 'Movies', path: '/mnt/SDCARD/Movies', kind: 'folder' },
        { label: 'Root (/)', path: '/', kind: 'system' },
      ]
    : [
        { label: 'Internal Storage', path: '/sdcard', kind: 'internal' },
        { label: 'Downloads', path: '/sdcard/Download', kind: 'folder' },
        { label: 'DCIM', path: '/sdcard/DCIM', kind: 'folder' },
        { label: 'Pictures', path: '/sdcard/Pictures', kind: 'folder' },
        { label: 'Music', path: '/sdcard/Music', kind: 'folder' },
        { label: 'Movies', path: '/sdcard/Movies', kind: 'folder' },
        { label: 'Documents', path: '/sdcard/Documents', kind: 'folder' },
        { label: 'Android Media', path: '/sdcard/Android/media', kind: 'folder' },
      ];

  for (const vol of volumes) {
    if (vol.kind === 'sdcard' && !bookmarks.some((b) => b.path === vol.path)) {
      bookmarks.push({
        label: vol.name,
        path: vol.path,
        kind: 'sdcard',
      });
    }
  }

  let activeVolume: StorageVolume | null = null;
  const kvVol = volumes.find(
    (v) => v.path === '/sdcard/KV-GAMES' || v.path === '/mnt/kv_games'
  );
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
      .filter(
        (v) => currentPath === v.path || currentPath.startsWith(`${v.path}/`)
      )
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

export async function mkdirAndroid(
  serial: string,
  targetPath: string
): Promise<void> {
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
  await runAdbShell(
    serial,
    `mv ${escapeShellArg(normOld)} ${escapeShellArg(normNew)}`
  );
}

export async function deleteAndroid(
  serial: string,
  paths: string[]
): Promise<void> {
  if (!paths || paths.length === 0) return;
  const escaped = paths
    .map((p) => path.posix.normalize(p.trim()))
    .filter(
      (p) =>
        p.length > 1 &&
        p !== '/' &&
        p !== '/sdcard' &&
        p !== '/mnt/SDCARD' &&
        p !== '/root'
    )
    .map(escapeShellArg);

  if (escaped.length === 0) {
    throw new Error('Refusing to delete root or primary mount paths');
  }

  await runAdbShell(serial, `rm -rf ${escaped.join(' ')}`, 60000);
}

export async function pushToAndroid(
  serial: string,
  localPaths: string[],
  remoteDir: string
): Promise<void> {
  if (!localPaths || localPaths.length === 0) return;
  const normalizedRemoteDir = path.posix.normalize(
    remoteDir.trim() || '/sdcard'
  );
  const targetDirWithSlash = normalizedRemoteDir.endsWith('/')
    ? normalizedRemoteDir
    : `${normalizedRemoteDir}/`;

  // Push files via adb push (timeout 10 minutes for large transfers)
  await runAdb(
    ['-s', serial, 'push', ...localPaths, targetDirWithSlash],
    10 * 60 * 1000
  );

  // Trigger Android MediaScanner only if `am` command exists on device
  try {
    const scanCommands = localPaths.map((localFile) => {
      const base = path.basename(localFile);
      const remoteFile = path.posix.join(normalizedRemoteDir, base);
      const fileUri = `file://${remoteFile}`;
      return `command -v am >/dev/null 2>&1 && am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${escapeShellArg(
        fileUri
      )} >/dev/null 2>&1 || true`;
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
    await runAdb(
      ['-s', serial, 'pull', '-a', normRemote, resolvedLocalDir],
      10 * 60 * 1000
    );
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

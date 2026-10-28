import type {
  AdbDiagnostics,
  AndroidDevice,
  DirectoryListingResponse,
  P2pDiscoveredPeer,
  P2pNetworkStatus,
  P2pShareSession,
  RelativeUploadItem,
  TransferJob,
} from './types';

export interface DroidBridgeDesktopAPI {
  isDesktop?: boolean;
  platform?: string;
  selectDirectory?: () => Promise<string | null>;
  selectFiles?: () => Promise<string[]>;
  openExternalPath?: (targetPath: string) => Promise<void>;
  openExternal?: (url: string) => Promise<boolean>;
  getPathForFile?: (file: File) => string;
}

declare global {
  interface Window {
    droidBridgeDesktop?: DroidBridgeDesktopAPI;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMessage =
      (data && (data.error || data.message)) ||
      `Request failed (${response.status})`;
    throw new Error(errMessage);
  }
  return data as T;
}

export const api = {
  async getHealth(): Promise<{
    status: string;
    platform: string;
    hostname: string;
  }> {
    return requestJson('/api/health');
  },

  async listDevices(): Promise<AndroidDevice[]> {
    const data = await requestJson<{
      devices: AndroidDevice[];
      diagnostics?: AdbDiagnostics;
    }>('/api/devices');
    return data.devices ?? [];
  },

  async listDevicesWithDiagnostics(): Promise<{
    devices: AndroidDevice[];
    diagnostics?: AdbDiagnostics;
  }> {
    const data = await requestJson<{
      devices: AndroidDevice[];
      diagnostics?: AdbDiagnostics;
    }>('/api/devices');
    return {
      devices: data.devices ?? [],
      diagnostics: data.diagnostics,
    };
  },

  async autoDiscoverDevices(): Promise<{
    ok: boolean;
    connected: string[];
    peers: P2pDiscoveredPeer[];
    devices: AndroidDevice[];
  }> {
    return requestJson('/api/devices/auto-discover', {
      method: 'POST',
    });
  },

  async listSshPresets(): Promise<
    { alias: string; hostName?: string; user?: string; port?: string }[]
  > {
    const data = await requestJson<{
      presets: { alias: string; hostName?: string; user?: string; port?: string }[];
    }>('/api/ssh/presets');
    return data.presets ?? [];
  },

  async connectWifiDevice(
    address: string,
    options?: { protocol?: 'adb' | 'ssh'; password?: string }
  ): Promise<{ ok?: boolean; message?: string; output?: string; serial?: string }> {
    return requestJson('/api/devices/connect', {
      method: 'POST',
      body: JSON.stringify({
        address: address.trim(),
        protocol: options?.protocol,
        password: options?.password,
      }),
    });
  },

  async disconnectDevice(
    address: string
  ): Promise<{ ok?: boolean; message?: string }> {
    return requestJson('/api/devices/disconnect', {
      method: 'POST',
      body: JSON.stringify({ address: address.trim() }),
    });
  },

  getDeviceScreenshotUrl(serial: string, cacheBuster = Date.now()): string {
    return `/api/devices/${encodeURIComponent(serial)}/screenshot?t=${cacheBuster}`;
  },

  async listLocalDirectory(path?: string): Promise<DirectoryListingResponse> {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    const qs = params.toString();
    return requestJson<DirectoryListingResponse>(
      `/api/local/list${qs ? `?${qs}` : ''}`
    );
  },

  async localMkdir(path: string): Promise<{ ok: boolean }> {
    return requestJson('/api/local/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  async localRename(oldPath: string, newPath: string): Promise<{ ok: boolean }> {
    return requestJson('/api/local/rename', {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    });
  },

  async localDelete(paths: string[]): Promise<{ ok: boolean }> {
    return requestJson('/api/local/delete', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    });
  },

  getLocalDownloadUrl(path: string): string {
    const params = new URLSearchParams({ path });
    return `/api/local/download?${params.toString()}`;
  },

  async localCopy(
    sourcePaths: string[],
    targetDir: string
  ): Promise<{ ok: boolean; job?: TransferJob }> {
    return requestJson('/api/local/copy', {
      method: 'POST',
      body: JSON.stringify({ sourcePaths, targetDir }),
    });
  },

  async uploadToLocal(
    targetDir: string,
    items: FileList | File[] | RelativeUploadItem[]
  ): Promise<{ ok: boolean; uploaded?: number; job?: TransferJob }> {
    const formData = new FormData();
    formData.append('targetDir', targetDir);
    const list = Array.from(items as ArrayLike<File | RelativeUploadItem>);
    for (const item of list) {
      if ('file' in item && item.file instanceof File) {
        formData.append('files', item.file);
        formData.append(
          'relativePaths',
          item.relativePath || item.file.webkitRelativePath || item.file.name
        );
      } else {
        const f = item as File;
        formData.append('files', f);
        formData.append('relativePaths', f.webkitRelativePath || f.name);
      }
    }
    return requestJson('/api/local/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async listAndroidDirectory(
    serial: string,
    path?: string
  ): Promise<DirectoryListingResponse> {
    const params = new URLSearchParams({ serial });
    if (path) params.set('path', path);
    return requestJson<DirectoryListingResponse>(
      `/api/android/list?${params.toString()}`
    );
  },

  async androidMkdir(serial: string, path: string): Promise<{ ok: boolean }> {
    return requestJson('/api/android/mkdir', {
      method: 'POST',
      body: JSON.stringify({ serial, path }),
    });
  },

  async androidRename(
    serial: string,
    oldPath: string,
    newPath: string
  ): Promise<{ ok: boolean }> {
    return requestJson('/api/android/rename', {
      method: 'POST',
      body: JSON.stringify({ serial, oldPath, newPath }),
    });
  },

  async androidDelete(
    serial: string,
    paths: string[]
  ): Promise<{ ok: boolean }> {
    return requestJson('/api/android/delete', {
      method: 'POST',
      body: JSON.stringify({ serial, paths }),
    });
  },

  getAndroidDownloadUrl(serial: string, path: string): string {
    const params = new URLSearchParams({ serial, path });
    return `/api/android/download?${params.toString()}`;
  },

  async uploadToAndroid(
    serial: string,
    targetDir: string,
    items: FileList | File[] | RelativeUploadItem[]
  ): Promise<{ ok: boolean; uploaded?: number; job?: TransferJob }> {
    const formData = new FormData();
    formData.append('serial', serial);
    formData.append('targetDir', targetDir);
    const list = Array.from(items as ArrayLike<File | RelativeUploadItem>);
    for (const item of list) {
      if ('file' in item && item.file instanceof File) {
        formData.append('files', item.file);
        formData.append(
          'relativePaths',
          item.relativePath || item.file.webkitRelativePath || item.file.name
        );
      } else {
        const f = item as File;
        formData.append('files', f);
        formData.append('relativePaths', f.webkitRelativePath || f.name);
      }
    }
    return requestJson('/api/android/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async pushToAndroid(
    serial: string,
    sourcePaths: string[],
    targetDir: string
  ): Promise<{ job?: TransferJob; ok?: boolean }> {
    return requestJson('/api/transfer/push', {
      method: 'POST',
      body: JSON.stringify({ serial, sourcePaths, targetDir }),
    });
  },

  async pullToLocal(
    serial: string,
    sourcePaths: string[],
    targetDir: string
  ): Promise<{ job?: TransferJob; ok?: boolean }> {
    return requestJson('/api/transfer/pull', {
      method: 'POST',
      body: JSON.stringify({ serial, sourcePaths, targetDir }),
    });
  },

  async installApkFromPath(
    serial: string,
    apkPath: string
  ): Promise<{ job?: TransferJob; ok?: boolean; message?: string }> {
    return requestJson('/api/android/install-apk', {
      method: 'POST',
      body: JSON.stringify({ serial, apkPath }),
    });
  },

  async installApkFromFile(
    serial: string,
    apkFile: File
  ): Promise<{ job?: TransferJob; ok?: boolean; message?: string }> {
    const formData = new FormData();
    formData.append('serial', serial);
    formData.append('apk', apkFile);
    return requestJson('/api/android/install-apk', {
      method: 'POST',
      body: formData,
    });
  },

  async listTransferJobs(): Promise<TransferJob[]> {
    const data = await requestJson<{ jobs: TransferJob[] }>(
      '/api/transfer/jobs'
    );
    return data.jobs ?? [];
  },

  async getP2pStatus(): Promise<P2pNetworkStatus> {
    return requestJson('/api/p2p/status');
  },

  async discoverP2pPeers(): Promise<P2pDiscoveredPeer[]> {
    const data = await requestJson<{ peers: P2pDiscoveredPeer[] }>(
      '/api/p2p/peers'
    );
    return data.peers ?? [];
  },

  async listP2pShares(): Promise<P2pShareSession[]> {
    const data = await requestJson<{ shares: P2pShareSession[] }>(
      '/api/p2p/shares'
    );
    return data.shares ?? [];
  },

  async createP2pShare(payload: {
    sourceKind: 'ubuntu' | 'android';
    serial?: string;
    paths: string[];
    uploadTargetDir?: string;
    allowUpload?: boolean;
    pin?: string;
    title?: string;
  }): Promise<{ ok: boolean; share: P2pShareSession }> {
    return requestJson('/api/p2p/shares', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async revokeP2pShare(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/api/p2p/shares/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async toggleP2pHotspot(payload: {
    action: 'start' | 'stop';
    ssid?: string;
    password?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    hotspot: P2pNetworkStatus['hotspot'];
  }> {
    return requestJson('/api/p2p/hotspot', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatTimestamp(unixSeconds: number | undefined | null): string {
  if (!unixSeconds || unixSeconds <= 0) return '—';
  const date = new Date(unixSeconds * 1000);
  if (isNaN(date.getTime())) return '—';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[A-Za-z]:$/.test(p) || p.includes('\\');
}

export function joinPosixPath(dir: string, name: string): string {
  const cleanDir = dir.endsWith('/') && dir.length > 1 ? dir.slice(0, -1) : dir;
  const cleanName = name.replace(/^\/+/, '');
  return cleanDir === '/' ? `/${cleanName}` : `${cleanDir}/${cleanName}`;
}

export function joinPath(basePath: string, name: string): string {
  if (isWindowsPath(basePath)) {
    const cleanBase = basePath.replace(/[\\/]+$/, '');
    const cleanName = name.replace(/^[\\/]+/, '');
    return `${cleanBase}\\${cleanName}`;
  }
  return joinPosixPath(basePath, name);
}

export function getParentPath(filePath: string, fallbackDir = '/'): string {
  if (isWindowsPath(filePath)) {
    const clean = filePath.replace(/[\\/]+$/, '');
    const lastSep = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'));
    if (lastSep < 0) return fallbackDir;
    const parent = clean.substring(0, lastSep);
    if (/^[A-Za-z]:$/.test(parent)) {
      return `${parent}\\`;
    }
    return parent || fallbackDir;
  }
  const lastSep = filePath.lastIndexOf('/');
  if (lastSep <= 0) return '/';
  return filePath.substring(0, lastSep);
}

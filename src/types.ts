export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  size: number;
  mtime: number; // Unix timestamp in seconds
  permissions: string;
  extension?: string;
}

export interface StorageVolume {
  name: string;
  path: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  kind: 'internal' | 'sdcard' | 'system' | 'local';
}

export interface AndroidDevice {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | string;
  model: string;
  manufacturer: string;
  product: string;
  androidVersion: string;
  sdkVersion: string;
  abi: string;
  batteryLevel: number | null;
  transport: 'usb' | 'wifi' | 'ssh';
  osType?: 'android' | 'linux';
  protocol?: 'adb' | 'ssh';
  defaultPath?: string;
  volumes: StorageVolume[];
}

export interface DirectoryListingResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FileEntry[];
  bookmarks: { label: string; path: string; kind?: string }[];
  volume?: StorageVolume | null;
}

export interface TransferJob {
  id: string;
  direction: 'push' | 'pull' | 'apk-install' | 'p2p-share' | 'local-copy';
  serial: string;
  sourcePaths: string[];
  targetPath: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  totalBytes?: number;
  summary: string;
  error?: string;
}

export interface RelativeUploadItem {
  file: File;
  relativePath: string;
}

export interface P2pShareItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface P2pShareSession {
  id: string;
  token: string;
  sourceKind: 'ubuntu' | 'android';
  serial?: string;
  title: string;
  items: P2pShareItem[];
  uploadTargetDir: string;
  allowUpload: boolean;
  pin?: string;
  createdAt: number;
  expiresAt: number;
  downloadCount: number;
  uploadCount: number;
  urls: string[];
  qrSvg: string;
}

export interface P2pDiscoveredPeer {
  ip: string;
  hostname?: string;
  mac?: string;
  iface?: string;
  services: ('adb' | 'ssh' | 'http' | 'lan')[];
  adbPort?: number;
  sshPort?: number;
  source: 'mdns' | 'arp' | 'hotspot';
}

export interface P2pNetworkStatus {
  hostname: string;
  port: number;
  addresses: { ip: string; iface: string; isP2pOrHotspot: boolean }[];
  hotspot: {
    supported: boolean;
    active: boolean;
    ssid?: string;
    password?: string;
    iface?: string;
    ip?: string;
  };
}


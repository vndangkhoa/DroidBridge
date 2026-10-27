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
  transport: 'usb' | 'wifi';
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
  direction: 'push' | 'pull' | 'apk-install';
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

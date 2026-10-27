import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  DirectoryListingResponse,
  FileEntry,
  StorageVolume,
} from '../src/types';

function formatModePermissions(
  mode: number,
  isDirectory: boolean,
  isSymlink: boolean
): string {
  const typeChar = isSymlink ? 'l' : isDirectory ? 'd' : '-';
  const chars = [
    mode & 0o400 ? 'r' : '-',
    mode & 0o200 ? 'w' : '-',
    mode & 0o100 ? 'x' : '-',
    mode & 0o040 ? 'r' : '-',
    mode & 0o020 ? 'w' : '-',
    mode & 0o010 ? 'x' : '-',
    mode & 0o004 ? 'r' : '-',
    mode & 0o002 ? 'w' : '-',
    mode & 0o001 ? 'x' : '-',
  ];
  return typeChar + chars.join('');
}

export function resolveInputPath(dirPath?: string): string {
  const home = os.homedir();
  if (!dirPath || !dirPath.trim()) {
    return home;
  }
  const trimmed = dirPath.trim();
  if (trimmed === '~') {
    return home;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(home, trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export async function listLocalDirectory(
  dirPath?: string
): Promise<DirectoryListingResponse> {
  const currentPath = resolveInputPath(dirPath);
  const parsedRoot = path.parse(currentPath).root;
  const parentPath = currentPath === parsedRoot ? null : path.dirname(currentPath);

  const dirents = await fs.promises.readdir(currentPath, { withFileTypes: true });

  const entries: FileEntry[] = await Promise.all(
    dirents.map(async (dirent) => {
      const fullPath = path.join(currentPath, dirent.name);
      const isSymlink = dirent.isSymbolicLink();
      let stat: fs.Stats | null = null;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch {
        try {
          stat = await fs.promises.lstat(fullPath);
        } catch {
          stat = null;
        }
      }

      const isDirectory = stat ? stat.isDirectory() : dirent.isDirectory();
      const size = stat ? stat.size : 0;
      const mtime = stat ? Math.floor(stat.mtimeMs / 1000) : 0;
      const permissions = stat
        ? formatModePermissions(stat.mode, isDirectory, isSymlink)
        : isDirectory
          ? 'drwxr-xr-x'
          : '-rw-r--r--';
      const ext =
        !isDirectory && dirent.name.includes('.')
          ? path.extname(dirent.name).slice(1).toLowerCase()
          : undefined;

      return {
        name: dirent.name,
        path: fullPath,
        isDirectory,
        isSymlink: isSymlink || undefined,
        size,
        mtime,
        permissions,
        extension: ext || undefined,
      };
    })
  );

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  let volume: StorageVolume | null = null;
  try {
    const statFs = await fs.promises.statfs(currentPath);
    const totalBytes = Number(statFs.blocks) * Number(statFs.bsize);
    const freeBytes = Number(statFs.bavail) * Number(statFs.bsize);
    const usedBytes = Math.max(0, totalBytes - Number(statFs.bfree) * Number(statFs.bsize));
    volume = {
      name:
        process.platform === 'win32'
          ? 'Windows Host Disk'
          : process.platform === 'darwin'
            ? 'macOS Host Disk'
            : 'Ubuntu / Linux Host Disk',
      path: currentPath,
      totalBytes,
      usedBytes,
      freeBytes,
      kind: 'local',
    };
  } catch {
    volume = null;
  }

  const home = os.homedir();
  const bookmarks: { label: string; path: string; kind?: string }[] = [
    { label: 'Home', path: home, kind: 'home' },
    { label: 'Desktop', path: path.join(home, 'Desktop'), kind: 'folder' },
    { label: 'Downloads', path: path.join(home, 'Downloads'), kind: 'folder' },
    { label: 'Documents', path: path.join(home, 'Documents'), kind: 'folder' },
    { label: 'Pictures', path: path.join(home, 'Pictures'), kind: 'folder' },
  ];

  if (process.platform === 'win32') {
    for (let code = 67; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) {
          bookmarks.push({
            label: `Local Disk (${letter}:)`,
            path: drive,
            kind: letter === 'C' ? 'system' : 'sdcard',
          });
        }
      } catch {
        // ignore inaccessible drive
      }
    }
  } else if (process.platform === 'darwin') {
    bookmarks.push(
      { label: 'Volumes', path: '/Volumes', kind: 'sdcard' },
      { label: 'Applications', path: '/Applications', kind: 'system' },
      { label: 'Root (/)', path: '/', kind: 'system' }
    );
  } else {
    bookmarks.push(
      { label: '/tmp', path: '/tmp', kind: 'system' },
      { label: '/media', path: '/media', kind: 'sdcard' },
      { label: '/mnt', path: '/mnt', kind: 'sdcard' },
      { label: 'Root (/)', path: '/', kind: 'system' }
    );
  }

  return {
    currentPath,
    parentPath,
    entries,
    bookmarks,
    volume,
  };
}

export async function mkdirLocal(targetPath: string): Promise<void> {
  const resolved = resolveInputPath(targetPath);
  await fs.promises.mkdir(resolved, { recursive: true });
}

export async function renameLocal(oldPath: string, newPath: string): Promise<void> {
  const resolvedOld = resolveInputPath(oldPath);
  const resolvedNew = resolveInputPath(newPath);
  await fs.promises.rename(resolvedOld, resolvedNew);
}

export async function deleteLocal(paths: string[]): Promise<void> {
  if (!paths || paths.length === 0) return;
  for (const p of paths) {
    const resolved = resolveInputPath(p);
    if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
      throw new Error(`Refusing to delete protected path: ${resolved}`);
    }
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

async function sumPathBytesRecursive(targetPath: string, depth = 0): Promise<number> {
  if (depth > 10) return 0;
  try {
    const stat = await fs.promises.lstat(targetPath);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      let sum = 0;
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        sum += await sumPathBytesRecursive(path.join(targetPath, entry.name), depth + 1);
      }
      return sum;
    }
  } catch {
    // ignore permission or broken entry errors
  }
  return 0;
}

export async function calculateLocalTotalBytes(paths: string[]): Promise<number> {
  let total = 0;
  for (const p of paths) {
    const resolved = resolveInputPath(p);
    total += await sumPathBytesRecursive(resolved, 0);
  }
  return total;
}

export async function copyLocalEntries(
  sourcePaths: string[],
  targetDir: string
): Promise<number> {
  if (!sourcePaths || sourcePaths.length === 0) return 0;
  const resolvedTarget = resolveInputPath(targetDir);
  await fs.promises.mkdir(resolvedTarget, { recursive: true });

  let copiedCount = 0;
  for (const src of sourcePaths) {
    const resolvedSrc = resolveInputPath(src);
    const dest = path.join(resolvedTarget, path.basename(resolvedSrc));
    if (resolvedSrc !== dest) {
      await fs.promises.cp(resolvedSrc, dest, { recursive: true, force: true });
      copiedCount += 1;
    }
  }
  return copiedCount;
}

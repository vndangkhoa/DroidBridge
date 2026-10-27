import type { RelativeUploadItem } from '../types';

export interface ExtractedOsDrop {
  mode: 'native-paths' | 'web-files';
  nativePaths: string[];
  uploadItems: RelativeUploadItem[];
}

export function hasOsFiles(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes('Files') &&
    !types.includes('application/x-droidbridge-paths')
  );
}

export function fileListToUploadItems(
  files: FileList | File[]
): RelativeUploadItem[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  const allEntries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch || batch.length === 0) {
      break;
    }
    allEntries.push(...batch);
  }
  return allEntries;
}

async function traverseFileSystemEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: RelativeUploadItem[]
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    out.push({
      file,
      relativePath: prefix ? `${prefix}/${file.name}` : file.name,
    });
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const reader = dirEntry.createReader();
    const children = await readAllDirectoryEntries(reader);
    for (const child of children) {
      await traverseFileSystemEntry(child, nextPrefix, out);
    }
  }
}

export async function extractOsDrop(
  dataTransfer: DataTransfer
): Promise<ExtractedOsDrop> {
  // Capture File objects and FileSystemEntry objects synchronously BEFORE any await
  const fallbackFiles = Array.from(dataTransfer.files || []);
  const entries: FileSystemEntry[] = [];

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file' && typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  // Electron Desktop Mode: zero-copy native OS paths via webUtils.getPathForFile
  if (
    window.droidBridgeDesktop?.getPathForFile &&
    fallbackFiles.length > 0
  ) {
    const nativePaths = fallbackFiles
      .map((f) => {
        try {
          return window.droidBridgeDesktop?.getPathForFile?.(f) || '';
        } catch {
          return '';
        }
      })
      .filter((p): p is string => Boolean(p && p.trim()));

    if (nativePaths.length > 0) {
      return {
        mode: 'native-paths',
        nativePaths,
        uploadItems: [],
      };
    }
  }

  // Web Browser Mode: recursive directory traversal via webkitGetAsEntry
  const uploadItems: RelativeUploadItem[] = [];
  if (entries.length > 0) {
    for (const entry of entries) {
      await traverseFileSystemEntry(entry, '', uploadItems);
    }
  }

  if (uploadItems.length === 0 && fallbackFiles.length > 0) {
    return {
      mode: 'web-files',
      nativePaths: [],
      uploadItems: fileListToUploadItems(fallbackFiles),
    };
  }

  return {
    mode: 'web-files',
    nativePaths: [],
    uploadItems,
  };
}

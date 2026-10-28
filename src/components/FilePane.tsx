import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  HardDrive,
  Loader2,
  MoreVertical,
  PackagePlus,
  Pencil,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Smartphone,
  Square,
  Trash2,
  Upload,
  Usb,
  Wifi,
} from 'lucide-react';
import {
  api,
  formatBytes,
  formatTimestamp,
  getParentPath,
  isWindowsPath,
  joinPath,
  joinPosixPath,
} from '../api';
import type {
  AdbDiagnostics,
  AndroidDevice,
  DirectoryListingResponse,
  FileEntry,
  RelativeUploadItem,
  StorageVolume,
} from '../types';
import {
  extractOsDrop,
  fileListToUploadItems,
  hasOsFiles,
} from '../utils/dropzone';
import { PathPromptModal } from './DeviceModals';

interface FilePaneProps {
  kind: 'ubuntu' | 'android';
  title: string;
  subtitle?: string;
  listing: DirectoryListingResponse | null;
  loading: boolean;
  error: string | null;
  selectedPaths: Set<string>;
  onSelectChange: (next: Set<string>) => void;
  onNavigate: (targetPath: string) => void;
  onRefresh: () => void;
  onCreateFolder: (folderPath: string) => Promise<void>;
  onRenameEntry: (oldPath: string, newPath: string) => Promise<void>;
  onDeleteEntries: (paths: string[]) => Promise<void>;
  onInstallApk?: (apkPath: string) => void;
  onUploadFiles?: (files: FileList) => Promise<void>;
  onUploadItems?: (items: RelativeUploadItem[]) => Promise<void>;
  onDropOsPaths?: (paths: string[]) => Promise<void>;
  onDropFromOtherPane?: (sourcePaths: string[]) => void;
  onShareP2p?: (paths: string[]) => void;
  onTransferEntries?: (paths: string[]) => Promise<void> | void;
  device?: AndroidDevice | null;
  extraVolumes?: StorageVolume[];
  diagnostics?: AdbDiagnostics | null;
  onAutoDiscover?: () => Promise<void> | void;
  autoDiscovering?: boolean;
  onOpenWifiModal?: () => void;
}

type SortKey = 'name' | 'size' | 'mtime';
type SortDir = 'asc' | 'desc';

function getEntryIcon(entry: FileEntry, kind: 'ubuntu' | 'android') {
  if (entry.isDirectory) {
    return (
      <Folder
        size={15}
        color={
          kind === 'ubuntu' ? 'var(--accent-ubuntu)' : 'var(--accent-android)'
        }
        style={{ flexShrink: 0 }}
      />
    );
  }
  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.apk')) {
    return (
      <PackagePlus
        size={15}
        color="var(--accent-android)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(zip|tar|gz|7z|rar|xz|iso|chd)$/.test(lower)) {
    return (
      <FileArchive
        size={15}
        color="var(--accent-ubuntu)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(lower)) {
    return (
      <FileImage
        size={15}
        color="var(--accent-bridge)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(mp4|mkv|webm|mov|avi)$/.test(lower)) {
    return (
      <FileVideo
        size={15}
        color="#a855f7"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(mp3|wav|flac|ogg|m4a)$/.test(lower)) {
    return (
      <FileAudio
        size={15}
        color="#ec4899"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(json|js|ts|tsx|py|sh|xml|yaml|yml|cfg|ini|conf)$/.test(lower)) {
    return (
      <FileCode
        size={15}
        color="var(--accent-bridge)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(csv|tsv|xlsx)$/.test(lower)) {
    return (
      <FileSpreadsheet
        size={15}
        color="var(--accent-android)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  if (/\.(md|txt|log|pdf)$/.test(lower)) {
    return (
      <FileText
        size={15}
        color="var(--text-secondary)"
        style={{ flexShrink: 0 }}
      />
    );
  }
  return (
    <File
      size={15}
      color="var(--text-muted)"
      style={{ flexShrink: 0 }}
    />
  );
}

export const FilePane: React.FC<FilePaneProps> = ({
  kind,
  title,
  subtitle,
  listing,
  loading,
  error,
  selectedPaths,
  onSelectChange,
  onNavigate,
  onRefresh,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntries,
  onInstallApk,
  onUploadFiles,
  onUploadItems,
  onDropOsPaths,
  onDropFromOtherPane,
  onShareP2p,
  onTransferEntries,
  device,
  extraVolumes,
  diagnostics,
  onAutoDiscover,
  autoDiscovering,
  onOpenWifiModal,
}) => {
  const captionId = useId();
  const contextMenuId = useId();
  const fileUploadRef = useRef<HTMLInputElement | null>(null);
  const folderUploadRef = useRef<HTMLInputElement | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const menuPopoverRef = useRef<HTMLDivElement | null>(null);
  const focusGroupRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const menuOpenedAtRef = useRef<number>(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingPath, setEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [dragMode, setDragMode] = useState<'none' | 'pane' | 'os'>('none');
  const [uploading, setUploading] = useState(false);
  const [localScanning, setLocalScanning] = useState(false);
  const isScanningWifi = Boolean(autoDiscovering || localScanning);

  // Right-click / overflow context menu state (modern-web-guidance: menu)
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    entry: FileEntry | null;
  }>({
    open: false,
    x: 0,
    y: 0,
    entry: null,
  });

  // Modal state for New Folder or Rename
  const [promptState, setPromptState] = useState<{
    open: boolean;
    mode: 'mkdir' | 'rename';
    initialValue: string;
    targetEntry?: FileEntry;
  }>({
    open: false,
    mode: 'mkdir',
    initialValue: '',
  });

  const currentPath = listing?.currentPath || (kind === 'ubuntu' ? '/' : '/sdcard');
  const activeVolume = listing?.volume ?? extraVolumes?.[0] ?? null;
  const isWinPath = useMemo(
    () => kind === 'ubuntu' && isWindowsPath(currentPath),
    [kind, currentPath]
  );

  const breadcrumbs = useMemo(() => {
    const winDriveMatch = currentPath.match(/^([A-Za-z]:)(?:[\\/](.*))?$/);
    if (winDriveMatch) {
      const drive = winDriveMatch[1].toUpperCase();
      const rest = (winDriveMatch[2] || '').replace(/[\\/]+$/, '');
      const items: { label: string; path: string }[] = [
        { label: drive, path: `${drive}\\` },
      ];
      if (!rest) return items;
      const parts = rest.split(/[\\/]+/).filter(Boolean);
      let acc = drive;
      for (const part of parts) {
        acc += `\\${part}`;
        items.push({ label: part, path: acc });
      }
      return items;
    }

    const clean = currentPath.replace(/\/+$/, '');
    if (!clean || clean === '/') {
      return [{ label: '/', path: '/' }];
    }
    const parts = clean.split('/').filter(Boolean);
    const items: { label: string; path: string }[] = [{ label: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      items.push({ label: part, path: acc });
    }
    return items;
  }, [currentPath]);

  const combinedBookmarks = useMemo(() => {
    const list: { label: string; path: string; kind?: string }[] = [
      ...(listing?.bookmarks ?? []),
    ];
    if (extraVolumes) {
      for (const vol of extraVolumes) {
        if (!list.some((b) => b.path === vol.path)) {
          list.push({ label: vol.name, path: vol.path, kind: vol.kind });
        }
      }
    }
    return list;
  }, [listing?.bookmarks, extraVolumes]);

  const filteredAndSortedEntries = useMemo(() => {
    const entries = listing?.entries ?? [];
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q))
      : entries;

    return [...filtered].sort((a, b) => {
      // Directories always come first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
      } else if (sortKey === 'size') {
        cmp = (a.size || 0) - (b.size || 0);
      } else if (sortKey === 'mtime') {
        cmp = (a.mtime || 0) - (b.mtime || 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [listing?.entries, searchQuery, sortKey, sortDir]);

  const handleSortClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleSelectEntry = (entryPath: string) => {
    const next = new Set(selectedPaths);
    if (next.has(entryPath)) {
      next.delete(entryPath);
    } else {
      next.add(entryPath);
    }
    onSelectChange(next);
  };

  const allVisibleSelected =
    filteredAndSortedEntries.length > 0 &&
    filteredAndSortedEntries.every((e) => selectedPaths.has(e.path));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(filteredAndSortedEntries.map((e) => e.path)));
    }
  };

  const handleNativeFolderPick = async () => {
    if (!window.droidBridgeDesktop?.selectDirectory) return;
    const chosen = await window.droidBridgeDesktop.selectDirectory();
    if (chosen) {
      onNavigate(chosen);
    }
  };

  const triggerFileDownload = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) return;
      const url =
        kind === 'ubuntu'
          ? api.getLocalDownloadUrl(entry.path)
          : device
          ? api.getAndroidDownloadUrl(device.serial, entry.path)
          : '';
      if (!url) return;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = entry.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    },
    [kind, device]
  );

  const handleActivateEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onNavigate(entry.path);
        return;
      }
      if (kind === 'ubuntu' && window.droidBridgeDesktop?.openExternalPath) {
        void window.droidBridgeDesktop.openExternalPath(entry.path);
        return;
      }
      triggerFileDownload(entry);
    },
    [kind, onNavigate, triggerFileDownload]
  );

  const closeContextMenu = useCallback((fromPointer = true) => {
    const popover = menuPopoverRef.current;
    if (lastTriggerRef.current) {
      try {
        (lastTriggerRef.current as any).focus({
          preventScroll: true,
          focusVisible: !fromPointer,
        });
      } catch {
        lastTriggerRef.current.focus({ preventScroll: true });
      }
    }
    if (popover) {
      if (typeof popover.hidePopover === 'function') {
        try {
          if (popover.matches(':popover-open')) {
            popover.hidePopover();
          }
        } catch {
          // ignore
        }
      }
      popover.classList.remove(':popover-open');
    }
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const openContextMenuAt = useCallback(
    (
      clientX: number,
      clientY: number,
      entry: FileEntry | null,
      triggerEl?: HTMLElement | null
    ) => {
      menuOpenedAtRef.current = performance.now();
      // Only store triggerEl when opened from the explicit overflow (⋮) button.
      // Storing document.activeElement here would capture .table-wrapper/body and prevent outside clicks from closing the menu!
      lastTriggerRef.current = triggerEl ?? null;
      window.dispatchEvent(
        new CustomEvent('droidbridge:contextmenu-open', {
          detail: contextMenuId,
        })
      );
      setContextMenu({
        open: true,
        x: triggerEl ? clientX : clientX + 2,
        y: triggerEl ? clientY : clientY + 2,
        entry,
      });
    },
    [contextMenuId]
  );

  // Progressive enhancement & fallbacks for Popover + focusgroup (modern-web-guidance: menu)
  useEffect(() => {
    if (
      typeof HTMLElement !== 'undefined' &&
      !('popover' in HTMLElement.prototype)
    ) {
      const polyfillUrl: string =
        'https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js';
      import(/* @vite-ignore */ polyfillUrl).catch(() => {});
    }

    const popover = menuPopoverRef.current;
    const group = focusGroupRef.current;
    if (!popover || !group) return;

    let cleanupKeyDown: (() => void) | undefined;
    if (!('focusGroup' in HTMLElement.prototype)) {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button:not([role])').forEach((item) => {
        item.setAttribute('role', 'menuitem');
      });
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeContextMenu(false);
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          return;
        }
        // Own items only: a nested submenu has its own focusgroup, a role="group" wrapper does not.
        const items = Array.from(
          group.querySelectorAll<HTMLButtonElement>('button')
        )
          .filter((item) => item.closest('[focusgroup]') === group)
          .filter(
            (item) =>
              !item.disabled && item.getAttribute('aria-disabled') !== 'true'
          );
        if (items.length === 0) return;
        const current = items.indexOf(
          document.activeElement as HTMLButtonElement
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? items.length - 1
            : current < 0
            ? event.key === 'ArrowUp'
              ? items.length - 1
              : 0
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
              items.length;
        event.preventDefault();
        event.stopImmediatePropagation();
        items[next].focus({ preventScroll: true });
      };
      group.addEventListener('keydown', handleKeyDown, true);
      cleanupKeyDown = () =>
        group.removeEventListener('keydown', handleKeyDown, true);
    }

    return () => {
      cleanupKeyDown?.();
    };
  }, [closeContextMenu]);

  // Windows Explorer-style light-dismiss: any left/middle click outside closes immediately; right-clicking another row moves the menu
  useEffect(() => {
    if (!contextMenu.open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const popover = menuPopoverRef.current;
      const target = event.target as Node | null;
      if (popover && target && popover.contains(target)) {
        return;
      }
      if (
        lastTriggerRef.current &&
        target &&
        lastTriggerRef.current.contains(target)
      ) {
        return;
      }
      // If right-clicking inside our own file table wrapper, let onContextMenu reposition the menu directly
      if (
        event.button === 2 &&
        tableWrapperRef.current &&
        target &&
        tableWrapperRef.current.contains(target)
      ) {
        return;
      }
      closeContextMenu(true);
    };

    const handleGlobalContextMenu = (event: MouseEvent) => {
      const popover = menuPopoverRef.current;
      const target = event.target as Node | null;
      if (popover && target && popover.contains(target)) {
        return;
      }
      if (
        tableWrapperRef.current &&
        target &&
        tableWrapperRef.current.contains(target)
      ) {
        return;
      }
      closeContextMenu(true);
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu(false);
      } else if (event.key === 'Tab') {
        closeContextMenu(false);
      }
    };

    const handleOtherMenuOpen = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      if (customEvent.detail !== contextMenuId) {
        closeContextMenu(true);
      }
    };

    const handleDismissOnScrollOrBlur = () => {
      closeContextMenu(true);
    };

    const wrapper = tableWrapperRef.current;
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('contextmenu', handleGlobalContextMenu, true);
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    window.addEventListener('resize', handleDismissOnScrollOrBlur);
    window.addEventListener('blur', handleDismissOnScrollOrBlur);
    window.addEventListener(
      'droidbridge:contextmenu-open',
      handleOtherMenuOpen as EventListener
    );
    wrapper?.addEventListener('scroll', handleDismissOnScrollOrBlur, {
      passive: true,
    });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('contextmenu', handleGlobalContextMenu, true);
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('resize', handleDismissOnScrollOrBlur);
      window.removeEventListener('blur', handleDismissOnScrollOrBlur);
      window.removeEventListener(
        'droidbridge:contextmenu-open',
        handleOtherMenuOpen as EventListener
      );
      wrapper?.removeEventListener('scroll', handleDismissOnScrollOrBlur);
    };
  }, [contextMenu.open, closeContextMenu, contextMenuId]);

  // Open/close popover, sync fallback roles, and clamp coordinates to viewport
  useEffect(() => {
    const popover = menuPopoverRef.current;
    const group = focusGroupRef.current;
    if (!popover || !group) return;

    if (!('focusGroup' in HTMLElement.prototype)) {
      group.setAttribute('role', 'menu');
      group.querySelectorAll('button:not([role])').forEach((item) => {
        item.setAttribute('role', 'menuitem');
      });
    }

    if (!contextMenu.open) {
      if (typeof popover.hidePopover === 'function') {
        try {
          if (popover.matches(':popover-open')) {
            popover.hidePopover();
          }
        } catch {
          // ignore
        }
      }
      popover.classList.remove(':popover-open');
      return;
    }

    if (typeof popover.showPopover === 'function') {
      try {
        if (!popover.matches(':popover-open')) {
          popover.showPopover();
        }
      } catch {
        popover.classList.add(':popover-open');
      }
    } else {
      popover.classList.add(':popover-open');
    }

    popover.style.left = `${contextMenu.x}px`;
    popover.style.top = `${contextMenu.y}px`;

    const rect = popover.getBoundingClientRect();
    const pad = 8;
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad);
    const clampedLeft = Math.min(Math.max(pad, contextMenu.x), maxLeft);
    const clampedTop = Math.min(Math.max(pad, contextMenu.y), maxTop);

    popover.style.left = `${clampedLeft}px`;
    popover.style.top = `${clampedTop}px`;

    // Focus the menu container itself (like Windows Explorer) so no item is pre-highlighted until hovered or arrow-keyed
    group.focus({ preventScroll: true });
  }, [contextMenu]);

  const contextEntry = contextMenu.entry;
  const contextTargetPaths = useMemo(() => {
    if (contextEntry) {
      if (selectedPaths.has(contextEntry.path) && selectedPaths.size > 0) {
        return Array.from(selectedPaths);
      }
      return [contextEntry.path];
    }
    if (selectedPaths.size > 0) {
      return Array.from(selectedPaths);
    }
    return [currentPath];
  }, [contextEntry, selectedPaths, currentPath]);

  const contextDeletePaths = useMemo(() => {
    if (contextEntry) {
      if (selectedPaths.has(contextEntry.path) && selectedPaths.size > 1) {
        return Array.from(selectedPaths);
      }
      return [contextEntry.path];
    }
    return Array.from(selectedPaths);
  }, [contextEntry, selectedPaths]);

  const handleFileUploadChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0 || (!onUploadItems && !onUploadFiles)) {
      return;
    }
    setUploading(true);
    try {
      if (onUploadItems) {
        await onUploadItems(fileListToUploadItems(files));
      } else if (onUploadFiles) {
        await onUploadFiles(files);
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const storagePercent =
    activeVolume && activeVolume.totalBytes > 0
      ? Math.min(
          100,
          Math.round((activeVolume.usedBytes / activeVolume.totalBytes) * 100)
        )
      : 0;

  return (
    <section
      className={`file-pane${dragMode !== 'none' ? ' drag-over' : ''}`}
      aria-label={title}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-droidbridge-paths')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (dragMode !== 'pane') setDragMode('pane');
        } else if (hasOsFiles(e.dataTransfer)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (dragMode !== 'os') setDragMode('os');
        }
      }}
      onDragLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const isOutside =
          e.clientX <= rect.left ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom;
        if (
          isOutside ||
          (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node))
        ) {
          setDragMode('none');
        }
      }}
      onDrop={async (e) => {
        setDragMode('none');
        if (e.dataTransfer.types.includes('application/x-droidbridge-paths')) {
          const raw = e.dataTransfer.getData('application/x-droidbridge-paths');
          if (!raw || !onDropFromOtherPane) return;
          try {
            const parsed = JSON.parse(raw) as {
              sourceKind: 'ubuntu' | 'android';
              paths: string[];
            };
            if (parsed.sourceKind !== kind && parsed.paths?.length > 0) {
              e.preventDefault();
              onDropFromOtherPane(parsed.paths);
            }
          } catch {
            // Ignore invalid drag payload
          }
          return;
        }

        if (hasOsFiles(e.dataTransfer)) {
          e.preventDefault();
          if (kind === 'android' && !device) return;
          setUploading(true);
          try {
            const extracted = await extractOsDrop(e.dataTransfer);
            if (
              extracted.mode === 'native-paths' &&
              extracted.nativePaths.length > 0 &&
              onDropOsPaths
            ) {
              await onDropOsPaths(extracted.nativePaths);
            } else if (extracted.uploadItems.length > 0 && onUploadItems) {
              await onUploadItems(extracted.uploadItems);
            } else if (
              extracted.uploadItems.length > 0 &&
              onUploadFiles &&
              e.dataTransfer.files.length > 0
            ) {
              await onUploadFiles(e.dataTransfer.files);
            }
          } finally {
            setUploading(false);
          }
        }
      }}
    >
      {dragMode !== 'none' && (
        <div className="pane-drop-banner">
          <Upload size={14} />
          <span>
            {dragMode === 'os'
              ? `Drop files or folders from your OS here to transfer into ${title} (${currentPath})`
              : `Drop items here to transfer into ${title} (${currentPath})`}
          </span>
        </div>
      )}
      {/* Pane Header */}
      <header className="pane-header">
        <div className="pane-title-group">
          <span className={`pane-indicator ${kind}`} />
          <div style={{ minWidth: 0 }}>
            <h2 className="pane-title">{title}</h2>
            {subtitle && <div className="pane-subtitle">{subtitle}</div>}
          </div>
        </div>

        {activeVolume && activeVolume.totalBytes > 0 && (
          <div className="storage-meter">
            <span className="storage-meter-label">
              {formatBytes(activeVolume.usedBytes)} /{' '}
              {formatBytes(activeVolume.totalBytes)} ({storagePercent}%)
            </span>
            <div className="storage-meter-track">
              <div
                className={`storage-meter-fill ${kind}`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Quick Bookmarks Strip */}
      {combinedBookmarks.length > 0 && (
        <nav className="bookmarks-bar" aria-label={`${title} quick bookmarks`}>
          {combinedBookmarks.map((bm) => {
            const isRootBookmark =
              bm.path === '/' || /^[A-Za-z]:[\\/]?$/.test(bm.path);
            const isActive =
              currentPath === bm.path ||
              (!isRootBookmark &&
                (currentPath.startsWith(`${bm.path}/`) ||
                  currentPath.startsWith(`${bm.path}\\`)));
            return (
              <button
                key={`${bm.label}-${bm.path}`}
                type="button"
                className={`bookmark-chip ${kind}${isActive ? ' active' : ''}`}
                onClick={() => onNavigate(bm.path)}
                title={bm.path}
              >
                {bm.kind === 'sdcard' ? (
                  <Smartphone size={12} />
                ) : (
                  <HardDrive size={12} />
                )}
                <span>{bm.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Path & Action Controls */}
      <div className="path-toolbar">
        <div className="path-row">
          <button
            type="button"
            className="btn btn-icon-only btn-xs"
            onClick={() => listing?.parentPath && onNavigate(listing.parentPath)}
            disabled={!listing?.parentPath || loading}
            title="Up to parent directory"
            aria-label="Up to parent directory"
          >
            <ArrowUp size={14} />
          </button>

          {editingPath ? (
            <form
              className="path-input-form"
              onSubmit={(e) => {
                e.preventDefault();
                setEditingPath(false);
                if (pathInputValue.trim()) {
                  onNavigate(pathInputValue.trim());
                }
              }}
            >
              <input
                type="text"
                className="text-input mono"
                value={pathInputValue}
                onChange={(e) => setPathInputValue(e.target.value)}
                onBlur={() => setEditingPath(false)}
                autoFocus
              />
            </form>
          ) : (
            <div
              className="breadcrumbs-scroll"
              onDoubleClick={() => {
                setPathInputValue(currentPath);
                setEditingPath(true);
              }}
              title="Click a segment to navigate, or double-click to edit path"
            >
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.path}>
                  {idx > 0 && (
                    <span className="crumb-sep">{isWinPath ? '\\' : '/'}</span>
                  )}
                  <button
                    type="button"
                    className={`crumb-btn${
                      idx === breadcrumbs.length - 1 ? ' current' : ''
                    }`}
                    onClick={() => onNavigate(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          <button
            type="button"
            className="btn btn-xs"
            onClick={() => {
              setPathInputValue(currentPath);
              setEditingPath((prev) => !prev);
            }}
            title="Edit path manually"
          >
            <Pencil size={12} />
            <span>Path</span>
          </button>

          <button
            type="button"
            className="btn btn-icon-only btn-xs"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh directory"
            aria-label="Refresh directory"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <div className="filter-actions-row">
          <div className="search-box">
            <Search size={13} />
            <input
              type="search"
              className="text-input"
              placeholder={`Filter ${
                listing?.entries.length ?? 0
              } items in current folder...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {kind === 'ubuntu' && window.droidBridgeDesktop?.selectDirectory && (
              <button
                type="button"
                className="btn btn-xs btn-ubuntu"
                onClick={handleNativeFolderPick}
                title={`Open native ${title} folder chooser`}
              >
                <FolderOpen size={13} />
                <span>Pick Native Folder</span>
              </button>
            )}

            {(onUploadItems || onUploadFiles) && (
              <>
                <input
                  ref={fileUploadRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileUploadChange}
                />
                <input
                  ref={folderUploadRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileUploadChange}
                  {...({ webkitdirectory: '', directory: '' } as any)}
                />
                <button
                  type="button"
                  className={`btn btn-xs ${
                    kind === 'android' ? 'btn-android' : 'btn-ubuntu'
                  }`}
                  onClick={() => fileUploadRef.current?.click()}
                  disabled={(kind === 'android' && !device) || uploading}
                  title={`Upload files (or drag & drop from OS) to ${title}`}
                >
                  {uploading ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <Upload size={13} />
                  )}
                  <span>Upload Files</span>
                </button>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => folderUploadRef.current?.click()}
                  disabled={(kind === 'android' && !device) || uploading}
                  title={`Upload an entire folder recursively to ${title}`}
                >
                  {uploading ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <FolderUp size={13} />
                  )}
                  <span>Upload Folder</span>
                </button>
              </>
            )}

            {onShareP2p && (
              <button
                type="button"
                className="btn btn-xs btn-bridge"
                onClick={() =>
                  onShareP2p(
                    selectedPaths.size > 0
                      ? Array.from(selectedPaths)
                      : [currentPath]
                  )
                }
                disabled={kind === 'android' && !device}
                title="Share selected files/folders (or current directory) over Wi-Fi P2P QR & LAN link"
              >
                <Share2 size={13} />
                <span>
                  Share P2P
                  {selectedPaths.size > 0 ? ` (${selectedPaths.size})` : ''}
                </span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-xs"
              onClick={() =>
                setPromptState({
                  open: true,
                  mode: 'mkdir',
                  initialValue: '',
                })
              }
              disabled={kind === 'android' && !device}
            >
              <FolderPlus size={13} />
              <span>New Folder</span>
            </button>

            {selectedPaths.size > 0 && (
              <button
                type="button"
                className="btn btn-xs btn-danger"
                onClick={() => onDeleteEntries(Array.from(selectedPaths))}
              >
                <Trash2 size={13} />
                <span>Delete ({selectedPaths.size})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File Table or Empty/Error State */}
      {kind === 'android' && !device ? (
        <div className="pane-empty-state assistant-empty-state">
          <div className="assistant-header">
            <div className="assistant-title-row">
              <Smartphone size={22} color="var(--accent-android)" />
              <h4>No Android / Handheld Device Connected</h4>
            </div>

            {diagnostics && (
              <span
                className={`meta-badge ${
                  diagnostics.adbAvailable ? 'online' : ''
                }`}
                style={
                  !diagnostics.adbAvailable
                    ? {
                        color: 'var(--accent-danger)',
                        borderColor: 'rgba(244, 63, 94, 0.35)',
                        backgroundColor: 'var(--accent-danger-soft)',
                      }
                    : undefined
                }
                title={diagnostics.adbBinaryPath}
              >
                {diagnostics.adbAvailable ? (
                  <CheckCircle2 size={11} />
                ) : (
                  <AlertTriangle size={11} />
                )}
                <span>
                  {diagnostics.adbAvailable
                    ? 'ADB Engine Ready'
                    : 'ADB Binary Missing'}
                </span>
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="assistant-actions">
            {onAutoDiscover && (
              <button
                type="button"
                className="btn btn-android"
                disabled={isScanningWifi}
                onClick={async () => {
                  setLocalScanning(true);
                  try {
                    await onAutoDiscover();
                  } finally {
                    setLocalScanning(false);
                  }
                }}
              >
                {isScanningWifi ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Radio size={13} />
                )}
                <span>
                  {isScanningWifi
                    ? 'Scanning Wi-Fi LAN...'
                    : 'Auto-Scan Wi-Fi Handheld'}
                </span>
              </button>
            )}

            {onOpenWifiModal && (
              <button
                type="button"
                className="btn btn-bridge"
                onClick={onOpenWifiModal}
              >
                <Wifi size={13} />
                <span>Connect Wi-Fi / SSH</span>
              </button>
            )}

            <button
              type="button"
              className="btn"
              onClick={onRefresh}
              disabled={loading}
            >
              <Usb size={13} />
              <span>Rescan USB (adb devices)</span>
            </button>
          </div>

          {/* Windows USB Device Manager Diagnostics Warning */}
          {diagnostics?.windowsUsbDevices &&
            diagnostics.windowsUsbDevices.length > 0 && (
              <div className="assistant-usb-alert">
                <div className="assistant-usb-alert-header">
                  <AlertTriangle size={14} color="var(--accent-ubuntu)" />
                  <span>
                    Windows USB Device Detected — Action Required for USB ADB:
                  </span>
                </div>
                <ul className="assistant-usb-list">
                  {diagnostics.windowsUsbDevices.map((usb, idx) => (
                    <li key={`${usb.instanceId}-${idx}`}>
                      <strong>{usb.name}</strong>{' '}
                      <code className="mono-num">({usb.status})</code> —{' '}
                      {usb.needsDriver
                        ? "Windows detected your USB handheld in Device Manager, but the WinUSB ADB driver is missing. Install WinUSB via Zadig for 'ADB Interface' or click Auto-Scan Wi-Fi above."
                        : usb.isMtpOnly
                        ? 'Connected in MTP-only mode — enable MTP + ADB on the handheld.'
                        : 'USB device present; ensure MTP + ADB is enabled on the handheld.'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* 3-Step TrimUI Smart Pro S & Windows Connection Assistant */}
          <div className="assistant-card">
            <div className="assistant-card-title">
              TrimUI Smart Pro S (KV-Android / KV-OS) &amp; Windows Connection
              Checklist
            </div>
            <ol className="assistant-steps">
              <li>
                <strong>
                  1. Enable <code className="mono-num">MTP + ADB</code> on
                  Handheld:
                </strong>{' '}
                Press <code className="mono-num">MENU</code> to open{' '}
                <strong>Trung tâm nhanh (Control Center)</strong> and tap{' '}
                <strong>
                  <code className="mono-num">Cổng USB</code>
                </strong>{' '}
                so it switches from{' '}
                <code className="mono-num">Chỉ sạc (Charge only)</code> to{' '}
                <strong>
                  <code className="mono-num">MTP + ADB</code>
                </strong>{' '}
                (highlighted blue).
              </li>
              <li>
                <strong>2. Use Bottom USB-C Port + Data Cable:</strong> Plug a{' '}
                <strong>data-capable</strong> USB-C cable into the{' '}
                <strong>
                  BOTTOM USB-C port (<code className="mono-num">DC</code>)
                </strong>{' '}
                next to the MicroSD slot (never the top{' '}
                <code className="mono-num">HOST</code> port, and avoid
                charge-only cables).
              </li>
              <li>
                <strong>
                  3. Windows USB Driver / Zero-Driver Wi-Fi:
                </strong>{' '}
                If Windows Device Manager lacks the Allwinner (
                <code className="mono-num">VID_1F3A</code>) ADB WinUSB driver,
                use <strong>Auto-Scan Wi-Fi Handheld</strong> or{' '}
                <strong>Connect Wi-Fi / SSH</strong> above to transfer files
                over Wi-Fi without any Windows USB drivers.
              </li>
            </ol>
          </div>
        </div>
      ) : error ? (
        <div className="pane-empty-state">
          <h4 style={{ color: 'var(--accent-danger)' }}>
            Unable to Load Directory
          </h4>
          <p>{error}</p>
          <button type="button" className="btn btn-xs" onClick={onRefresh}>
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      ) : (
        <div
          ref={tableWrapperRef}
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="table-wrapper"
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('tr.file-entry-row')) return;
            e.preventDefault();
            e.stopPropagation();
            openContextMenuAt(e.clientX, e.clientY, null);
          }}
        >
          <table className="file-table">
            <caption id={captionId} className="sr-only-caption">
              {title} directory listing for {currentPath}
            </caption>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                    aria-label="Select all visible items"
                  >
                    {allVisibleSelected ? (
                      <CheckSquare size={14} color="var(--accent-bridge)" />
                    ) : (
                      <Square size={14} />
                    )}
                  </button>
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSortClick('name')}
                >
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Name <ArrowUpDown size={11} />
                  </span>
                </th>
                <th
                  className="sortable"
                  style={{ width: 92, textAlign: 'right' }}
                  onClick={() => handleSortClick('size')}
                >
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Size <ArrowUpDown size={11} />
                  </span>
                </th>
                <th
                  className="sortable"
                  style={{ width: 132 }}
                  onClick={() => handleSortClick('mtime')}
                >
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Modified <ArrowUpDown size={11} />
                  </span>
                </th>
                <th style={{ width: 96 }}>Mode</th>
                <th style={{ width: 146, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {listing?.parentPath && (
                <tr
                  className="parent-dir-row"
                  onDoubleClick={() =>
                    listing.parentPath && onNavigate(listing.parentPath)
                  }
                  title={`Double-click to go up to parent directory (${listing.parentPath})`}
                >
                  <td>
                    <span
                      style={{
                        display: 'inline-flex',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <ArrowUp size={13} />
                    </span>
                  </td>
                  <th scope="row">
                    <div className="entry-name-cell is-dir">
                      <FolderOpen
                        size={15}
                        color={
                          kind === 'ubuntu'
                            ? 'var(--accent-ubuntu)'
                            : 'var(--accent-android)'
                        }
                        style={{ flexShrink: 0 }}
                      />
                      <span className="entry-name-text">..</span>
                    </div>
                  </th>
                  <td
                    className="mono-num"
                    style={{
                      textAlign: 'right',
                      color: 'var(--text-muted)',
                      fontSize: 11,
                    }}
                  >
                    PARENT
                  </td>
                  <td
                    className="mono-num"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 11.5,
                    }}
                  >
                    —
                  </td>
                  <td
                    className="mono-num"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 11,
                    }}
                  >
                    —
                  </td>
                  <td style={{ textAlign: 'right' }} />
                </tr>
              )}
              {filteredAndSortedEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: 'center',
                      padding: '28px 12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {loading
                      ? 'Reading directory entries...'
                      : searchQuery
                      ? 'No files match your filter.'
                      : 'This folder is empty.'}
                  </td>
                </tr>
              ) : (
                filteredAndSortedEntries.map((entry) => {
                  const isSelected = selectedPaths.has(entry.path);
                  const isContextTarget =
                    contextMenu.open && contextMenu.entry?.path === entry.path;
                  const isApk =
                    !entry.isDirectory &&
                    entry.name.toLowerCase().endsWith('.apk');

                  return (
                    <tr
                      key={entry.path}
                      className={`file-entry-row${
                        isSelected ? ' is-selected' : ''
                      }${isContextTarget ? ' is-context-target' : ''}`}
                      draggable
                      onDoubleClick={(e) => {
                        if (
                          (e.target as HTMLElement).closest('button, a, input')
                        ) {
                          return;
                        }
                        handleActivateEntry(entry);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openContextMenuAt(e.clientX, e.clientY, entry);
                      }}
                      onDragStart={(e) => {
                        const pathsToDrag = isSelected
                          ? Array.from(selectedPaths)
                          : [entry.path];
                        e.dataTransfer.setData(
                          'application/x-droidbridge-paths',
                          JSON.stringify({
                            sourceKind: kind,
                            paths: pathsToDrag,
                          })
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <td>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectEntry(entry.path);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isSelected
                              ? 'var(--accent-bridge)'
                              : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 4,
                            margin: -4,
                            display: 'flex',
                          }}
                          aria-label={`Select ${entry.name}`}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? (
                            <CheckSquare size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </button>
                      </td>

                      <th scope="row">
                        <div
                          className={`entry-name-cell${
                            entry.isDirectory ? ' is-dir' : ''
                          }`}
                          title={
                            entry.isDirectory
                              ? `Double-click row to open ${entry.name} • Right-click for actions`
                              : `${entry.path} • Double-click to open/download • Right-click for actions`
                          }
                        >
                          {getEntryIcon(entry, kind)}
                          <span className="entry-name-text">{entry.name}</span>
                        </div>
                      </th>

                      <td
                        className="mono-num"
                        style={{
                          textAlign: 'right',
                          color: 'var(--text-secondary)',
                          fontSize: 11.5,
                        }}
                      >
                        {entry.isDirectory ? 'DIR' : formatBytes(entry.size)}
                      </td>

                      <td
                        className="mono-num"
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: 11.5,
                        }}
                      >
                        {formatTimestamp(entry.mtime)}
                      </td>

                      <td
                        className="mono-num"
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: 11,
                        }}
                      >
                        {entry.permissions || '—'}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div className="row-actions">
                          {kind === 'ubuntu' && isApk && onInstallApk && (
                            <button
                              type="button"
                              className="btn btn-xs btn-android"
                              onClick={() => onInstallApk(entry.path)}
                              disabled={!device}
                              title="Sideload APK onto connected Android device"
                            >
                              <PackagePlus size={12} />
                              <span>Install APK</span>
                            </button>
                          )}

                          {kind === 'android' &&
                            !entry.isDirectory &&
                            device && (
                              <a
                                href={api.getAndroidDownloadUrl(
                                  device.serial,
                                  entry.path
                                )}
                                download={entry.name}
                                className="btn btn-xs"
                                style={{ textDecoration: 'none' }}
                                title={`Download ${entry.name}`}
                              >
                                <Download size={12} />
                              </a>
                            )}

                          {onShareP2p && (
                            <button
                              type="button"
                              className="btn btn-icon-only btn-xs"
                              onClick={() => onShareP2p([entry.path])}
                              title={`Share ${entry.name} over Wi-Fi P2P`}
                              aria-label={`Share ${entry.name} over Wi-Fi P2P`}
                            >
                              <Share2 size={12} />
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn btn-icon-only btn-xs"
                            onClick={() =>
                              setPromptState({
                                open: true,
                                mode: 'rename',
                                initialValue: entry.name,
                                targetEntry: entry,
                              })
                            }
                            title={`Rename ${entry.name}`}
                            aria-label={`Rename ${entry.name}`}
                          >
                            <Pencil size={12} />
                          </button>

                          <button
                            type="button"
                            className="btn btn-icon-only btn-xs btn-danger"
                            onClick={() => onDeleteEntries([entry.path])}
                            title={`Delete ${entry.name}`}
                            aria-label={`Delete ${entry.name}`}
                          >
                            <Trash2 size={12} />
                          </button>

                          <button
                            type="button"
                            className="btn btn-icon-only btn-xs"
                            aria-haspopup="menu"
                            aria-expanded={isContextTarget}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isContextTarget) {
                                closeContextMenu(true);
                                return;
                              }
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              openContextMenuAt(
                                rect.right,
                                rect.bottom + 4,
                                entry,
                                e.currentTarget
                              );
                            }}
                            title={`Context menu for ${entry.name} (or right-click row)`}
                            aria-label={`More actions for ${entry.name}`}
                          >
                            <MoreVertical size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Right-Click / Overflow Context Menu (modern-web-guidance: menu) */}
      <div
        ref={menuPopoverRef}
        id={contextMenuId}
        className="db-context-popover"
        {...({ popover: 'manual' } as any)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="db-context-menu-header">
          {contextEntry ? contextEntry.name : currentPath}
        </div>
        {/* Nested inside popover: Chromium otherwise drops focusgroup keyboard behavior */}
        <div
          ref={focusGroupRef}
          tabIndex={-1}
          className="db-context-menu"
          {...({ focusgroup: 'menu nomemory' } as any)}
          aria-label={`${title} context menu`}
          onPointerLeave={() => {
            if (
              focusGroupRef.current &&
              focusGroupRef.current.contains(document.activeElement) &&
              document.activeElement !== focusGroupRef.current
            ) {
              focusGroupRef.current.focus({ preventScroll: true });
            }
          }}
        >
          {contextEntry?.isDirectory && (
            <button
              type="button"
              onClick={(e) => {
                closeContextMenu(e.detail > 0);
                onNavigate(contextEntry.path);
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                <FolderOpen size={14} />
              </span>
              <span>Open Folder</span>
              <span className="hint" aria-hidden="true">
                Double-click
              </span>
            </button>
          )}

          {contextEntry &&
            !contextEntry.isDirectory &&
            kind === 'ubuntu' &&
            Boolean(window.droidBridgeDesktop?.openExternalPath) && (
              <button
                type="button"
                onClick={(e) => {
                  closeContextMenu(e.detail > 0);
                  void window.droidBridgeDesktop?.openExternalPath?.(
                    contextEntry.path
                  );
                }}
              >
                <span className="menu-item-icon" aria-hidden="true">
                  <ExternalLink size={14} />
                </span>
                <span>Open File</span>
                <span className="hint" aria-hidden="true">
                  Double-click
                </span>
              </button>
            )}

          {contextEntry && !contextEntry.isDirectory && (
            <button
              type="button"
              disabled={kind === 'android' && !device}
              onClick={(e) => {
                closeContextMenu(e.detail > 0);
                triggerFileDownload(contextEntry);
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                <Download size={14} />
              </span>
              <span>Download File</span>
            </button>
          )}

          {onTransferEntries && (
            <button
              type="button"
              disabled={
                !device ||
                device.state !== 'device' ||
                (!contextEntry && selectedPaths.size === 0)
              }
              onClick={(e) => {
                const paths = contextEntry
                  ? contextTargetPaths
                  : Array.from(selectedPaths);
                closeContextMenu(e.detail > 0);
                if (paths.length > 0) {
                  void onTransferEntries(paths);
                }
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                {kind === 'ubuntu' ? (
                  <ArrowRight size={14} />
                ) : (
                  <ArrowLeft size={14} />
                )}
              </span>
              <span>
                {kind === 'ubuntu'
                  ? `Push to ${
                      device?.osType === 'linux' ? 'Linux' : 'Device'
                    }${
                      contextTargetPaths.length > 1
                        ? ` (${contextTargetPaths.length})`
                        : ''
                    }`
                  : `Pull to Host${
                      contextTargetPaths.length > 1
                        ? ` (${contextTargetPaths.length})`
                        : ''
                    }`}
              </span>
              <span className="hint" aria-hidden="true">
                {kind === 'ubuntu' ? '→' : '←'}
              </span>
            </button>
          )}

          {kind === 'ubuntu' &&
            contextEntry &&
            !contextEntry.isDirectory &&
            contextEntry.name.toLowerCase().endsWith('.apk') &&
            onInstallApk && (
              <button
                type="button"
                disabled={
                  !device ||
                  device.state !== 'device' ||
                  device.osType === 'linux'
                }
                onClick={(e) => {
                  closeContextMenu(e.detail > 0);
                  onInstallApk(contextEntry.path);
                }}
              >
                <span className="menu-item-icon" aria-hidden="true">
                  <PackagePlus size={14} />
                </span>
                <span>Install APK on Device</span>
              </button>
            )}

          {onShareP2p && (
            <button
              type="button"
              disabled={kind === 'android' && !device}
              onClick={(e) => {
                closeContextMenu(e.detail > 0);
                onShareP2p(contextTargetPaths);
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                <Share2 size={14} />
              </span>
              <span>
                Share over Wi-Fi P2P
                {contextTargetPaths.length > 1
                  ? ` (${contextTargetPaths.length})`
                  : ''}
              </span>
              <span className="hint" aria-hidden="true">
                QR / Link
              </span>
            </button>
          )}

          <hr />

          {contextEntry && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={selectedPaths.has(contextEntry.path)}
              onClick={(e) => {
                toggleSelectEntry(contextEntry.path);
                closeContextMenu(e.detail > 0);
              }}
            >
              <span>Select &ldquo;{contextEntry.name}&rdquo;</span>
            </button>
          )}

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allVisibleSelected}
            disabled={filteredAndSortedEntries.length === 0}
            onClick={(e) => {
              toggleSelectAll();
              closeContextMenu(e.detail > 0);
            }}
          >
            <span>
              {allVisibleSelected
                ? 'Deselect All Visible'
                : `Select All (${filteredAndSortedEntries.length})`}
            </span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              const pathToCopy = contextEntry ? contextEntry.path : currentPath;
              void navigator.clipboard?.writeText(pathToCopy);
              closeContextMenu(e.detail > 0);
            }}
          >
            <span className="menu-item-icon" aria-hidden="true">
              <Copy size={14} />
            </span>
            <span>Copy Path</span>
          </button>

          {kind === 'ubuntu' &&
            Boolean(window.droidBridgeDesktop?.openExternalPath) && (
              <button
                type="button"
                onClick={(e) => {
                  const folderToOpen = contextEntry?.isDirectory
                    ? contextEntry.path
                    : currentPath;
                  closeContextMenu(e.detail > 0);
                  void window.droidBridgeDesktop?.openExternalPath?.(
                    folderToOpen
                  );
                }}
              >
                <span className="menu-item-icon" aria-hidden="true">
                  <FolderOpen size={14} />
                </span>
                <span>Open in System File Manager</span>
              </button>
            )}

          <hr />

          <button
            type="button"
            disabled={kind === 'android' && !device}
            onClick={(e) => {
              closeContextMenu(e.detail > 0);
              setPromptState({
                open: true,
                mode: 'mkdir',
                initialValue: '',
              });
            }}
          >
            <span className="menu-item-icon" aria-hidden="true">
              <FolderPlus size={14} />
            </span>
            <span>New Folder…</span>
          </button>

          {contextEntry && (
            <button
              type="button"
              onClick={(e) => {
                closeContextMenu(e.detail > 0);
                setPromptState({
                  open: true,
                  mode: 'rename',
                  initialValue: contextEntry.name,
                  targetEntry: contextEntry,
                });
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                <Pencil size={14} />
              </span>
              <span>Rename…</span>
            </button>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={(e) => {
              closeContextMenu(e.detail > 0);
              onRefresh();
            }}
          >
            <span className="menu-item-icon" aria-hidden="true">
              <RefreshCw size={14} />
            </span>
            <span>Refresh Directory</span>
          </button>

          {contextDeletePaths.length > 0 && (
            <>
              <hr />
              <button
                type="button"
                className="danger-item"
                onClick={(e) => {
                  const toDelete = [...contextDeletePaths];
                  closeContextMenu(e.detail > 0);
                  void onDeleteEntries(toDelete);
                }}
              >
                <span className="menu-item-icon" aria-hidden="true">
                  <Trash2 size={14} />
                </span>
                <span>
                  {contextDeletePaths.length === 1 && contextEntry
                    ? `Delete "${contextEntry.name}"`
                    : `Delete Selected (${contextDeletePaths.length})`}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pane Footer */}
      <footer className="pane-footer">
        <span className="mono-num">
          {filteredAndSortedEntries.length} items shown
          {selectedPaths.size > 0 ? ` • ${selectedPaths.size} selected` : ''}
        </span>
        <span className="mono-num" style={{ color: 'var(--text-muted)' }}>
          {currentPath}
        </span>
      </footer>

      {/* New Folder / Rename Native Dialog */}
      <PathPromptModal
        open={promptState.open}
        mode={promptState.mode}
        initialValue={promptState.initialValue}
        targetLabel={
          promptState.mode === 'mkdir'
            ? currentPath
            : promptState.targetEntry?.path || currentPath
        }
        onClose={() => setPromptState((prev) => ({ ...prev, open: false }))}
        onConfirm={async (newName) => {
          const usePosix = kind === 'android';
          if (promptState.mode === 'mkdir') {
            const fullPath = usePosix
              ? joinPosixPath(currentPath, newName)
              : joinPath(currentPath, newName);
            await onCreateFolder(fullPath);
          } else if (promptState.targetEntry) {
            const parentDir = usePosix
              ? promptState.targetEntry.path.substring(
                  0,
                  promptState.targetEntry.path.lastIndexOf('/')
                ) || '/'
              : getParentPath(promptState.targetEntry.path, currentPath);
            const newPath = usePosix
              ? joinPosixPath(parentDir, newName)
              : joinPath(parentDir, newName);
            await onRenameEntry(promptState.targetEntry.path, newPath);
          }
        }}
      />
    </section>
  );
};

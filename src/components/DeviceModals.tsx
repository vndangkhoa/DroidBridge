import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Camera,
  Download,
  FolderPlus,
  Loader2,
  PackagePlus,
  Pencil,
  RefreshCw,
  Terminal,
  Wifi,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { AndroidDevice } from '../types';

interface LightDismissDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}

export const LightDismissDialog: React.FC<LightDismissDialogProps> = ({
  open,
  onClose,
  title,
  icon,
  wide,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback for browsers without closedBy in HTMLDialogElement.prototype
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };

      dialog.addEventListener('click', handleClick);
      return () => dialog.removeEventListener('click', handleClick);
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`db-dialog${wide ? ' wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: 'any' } as any)}
    >
      <div className="dialog-header">
        <h2 id={titleId}>
          {icon}
          <span>{title}</span>
        </h2>
        <button
          type="button"
          className="btn btn-icon-only btn-xs"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
        >
          <X size={14} />
        </button>
      </div>
      {children}
    </dialog>
  );
};

interface WifiAdbModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (msg: string) => void;
}

export const WifiAdbModal: React.FC<WifiAdbModalProps> = ({
  open,
  onClose,
  onConnected,
}) => {
  const [protocol, setProtocol] = useState<'adb' | 'ssh'>('adb');
  const [address, setAddress] = useState('192.168.31.100:5555');
  const [password, setPassword] = useState('');
  const [sshPresets, setSshPresets] = useState<
    { alias: string; hostName?: string; user?: string; port?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      api
        .listSshPresets()
        .then(setSshPresets)
        .catch(() => {});
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.connectWifiDevice(address.trim(), {
        protocol,
        password: password || undefined,
      });
      onConnected(res.message || res.output || `Connected to ${address.trim()}`);
      onClose();
    } catch (err: any) {
      setError(
        err?.message ||
          (protocol === 'ssh'
            ? 'Failed to connect to Linux SSH host'
            : 'Failed to connect over Wireless ADB')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <LightDismissDialog
      open={open}
      onClose={onClose}
      title="Connect Wireless ADB or Linux SSH"
      icon={
        protocol === 'ssh' ? (
          <Terminal size={16} color="var(--accent-bridge)" />
        ) : (
          <Wifi size={16} color="var(--accent-bridge)" />
        )
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`btn ${protocol === 'adb' ? 'btn-bridge' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setProtocol('adb');
                setError(null);
                if (address.includes('@') || !address.includes(':')) {
                  setAddress('192.168.31.100:5555');
                }
              }}
            >
              <Wifi size={13} />
              <span>Wi-Fi ADB (Android / Handheld)</span>
            </button>
            <button
              type="button"
              className={`btn ${protocol === 'ssh' ? 'btn-bridge' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setProtocol('ssh');
                setError(null);
                if (address.endsWith(':5555')) {
                  setAddress('root@192.168.31.100:22');
                }
              }}
            >
              <Terminal size={13} />
              <span>Linux SSH / SFTP</span>
            </button>
          </div>

          {protocol === 'adb' ? (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
              Enter your Android device or TrimUI handheld IP address and ADB port
              (default <code className="mono-num">5555</code>).
            </p>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
              Connect to any Linux handheld, Raspberry Pi, NAS, or server via SSH (
              <code className="mono-num">user@host:port</code> or{' '}
              <code className="mono-num">~/.ssh/config</code> host alias).
            </p>
          )}

          {protocol === 'ssh' && sshPresets.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                SSH Config Presets:
              </span>
              {sshPresets.map((p) => (
                <button
                  key={p.alias}
                  type="button"
                  className="btn btn-xs"
                  onClick={() => setAddress(p.alias)}
                  title={`${p.user ? `${p.user}@` : ''}${p.hostName || p.alias}${
                    p.port ? `:${p.port}` : ''
                  }`}
                >
                  <Terminal size={11} />
                  <span>
                    {p.alias}
                    {p.hostName ? ` (${p.hostName}${p.port ? `:${p.port}` : ''})` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>
              {protocol === 'ssh'
                ? 'SSH Target (user@host:port or alias)'
                : 'Device IP : Port'}
            </span>
            <input
              type="text"
              className="text-input mono"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={
                protocol === 'ssh' ? 'root@192.168.31.88:22 or trimui' : '192.168.31.50:5555'
              }
              required
              autoFocus
            />
          </label>

          {protocol === 'ssh' && (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>SSH Password (optional — leave blank for SSH key)</span>
              <input
                type="password"
                className="text-input mono"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••• (optional)"
              />
            </label>
          )}

          {error && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-danger-soft)',
                color: '#fecdd3',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-bridge" disabled={busy}>
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : protocol === 'ssh' ? (
              <Terminal size={14} />
            ) : (
              <Wifi size={14} />
            )}
            <span>{protocol === 'ssh' ? 'Connect SSH' : 'Connect ADB'}</span>
          </button>
        </div>
      </form>
    </LightDismissDialog>
  );
};

interface ScreenPreviewModalProps {
  open: boolean;
  onClose: () => void;
  device: AndroidDevice | null;
}

export const ScreenPreviewModal: React.FC<ScreenPreviewModalProps> = ({
  open,
  onClose,
  device,
}) => {
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (open && device) {
      setTimestamp(Date.now());
      setLoading(true);
      setImgError(false);
    }
  }, [open, device]);

  const screenshotUrl = device
    ? api.getDeviceScreenshotUrl(device.serial, timestamp)
    : '';

  const handleRefresh = () => {
    setTimestamp(Date.now());
    setLoading(true);
    setImgError(false);
  };

  return (
    <LightDismissDialog
      open={open}
      onClose={onClose}
      title={
        device
          ? `Live Screen Capture — ${device.model} (${device.serial})`
          : 'Live Screen Capture'
      }
      icon={<Camera size={16} color="var(--accent-android)" />}
      wide
    >
      <div className="dialog-body">
        {!device ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            No Android device selected.
          </p>
        ) : (
          <div className="screen-preview-frame">
            {imgError ? (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p style={{ margin: '0 0 8px' }}>
                  Could not capture framebuffer from {device.model}. Ensure the screen is
                  unlocked and USB debugging is authorized.
                </p>
                <button type="button" className="btn btn-xs" onClick={handleRefresh}>
                  <RefreshCw size={12} />
                  <span>Retry Capture</span>
                </button>
              </div>
            ) : (
              <img
                src={screenshotUrl}
                alt={`Screen capture from ${device.model}`}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setImgError(true);
                }}
              />
            )}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        {device && !imgError && (
          <a
            href={screenshotUrl}
            download={`screenshot-${device.serial}-${timestamp}.png`}
            className="btn"
            style={{ textDecoration: 'none' }}
          >
            <Download size={14} />
            <span>Save PNG</span>
          </a>
        )}
        <button
          type="button"
          className="btn btn-android"
          onClick={handleRefresh}
          disabled={!device || loading}
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>Refresh Frame</span>
        </button>
      </div>
    </LightDismissDialog>
  );
};

interface ApkInstallModalProps {
  open: boolean;
  onClose: () => void;
  device: AndroidDevice | null;
  onInstalled: (msg: string) => void;
}

export const ApkInstallModal: React.FC<ApkInstallModalProps> = ({
  open,
  onClose,
  device,
  onInstalled,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localApkPath, setLocalApkPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      if (selectedFile) {
        await api.installApkFromFile(device.serial, selectedFile);
        onInstalled(`Installed ${selectedFile.name} on ${device.model}`);
      } else if (localApkPath.trim()) {
        await api.installApkFromPath(device.serial, localApkPath.trim());
        onInstalled(`Installed ${localApkPath.trim()} on ${device.model}`);
      } else {
        setError('Choose an .apk file or enter an Ubuntu path.');
        setBusy(false);
        return;
      }
      setSelectedFile(null);
      setLocalApkPath('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'APK installation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <LightDismissDialog
      open={open}
      onClose={onClose}
      title={
        device ? `Install APK on ${device.model}` : 'Sideload Android Package (.apk)'
      }
      icon={<PackagePlus size={16} color="var(--accent-android)" />}
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog-body">
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
            Select an <code className="mono-num">.apk</code> package from your browser or
            specify a full Ubuntu host path to sideload with{' '}
            <code className="mono-num">adb install -r</code>.
          </p>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>Select APK File</span>
            <input
              type="file"
              accept=".apk"
              className="text-input"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>Or Ubuntu Local APK Path</span>
            <input
              type="text"
              className="text-input mono"
              placeholder="/home/user/Downloads/app-release.apk"
              value={localApkPath}
              onChange={(e) => setLocalApkPath(e.target.value)}
            />
          </label>
          {error && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-danger-soft)',
                color: '#fecdd3',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-android"
            disabled={busy || !device || (!selectedFile && !localApkPath.trim())}
          >
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <PackagePlus size={14} />
            )}
            <span>Install APK</span>
          </button>
        </div>
      </form>
    </LightDismissDialog>
  );
};

interface PathPromptModalProps {
  open: boolean;
  mode: 'mkdir' | 'rename';
  initialValue: string;
  targetLabel: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void>;
}

export const PathPromptModal: React.FC<PathPromptModalProps> = ({
  open,
  mode,
  initialValue,
  targetLabel,
  onClose,
  onConfirm,
}) => {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <LightDismissDialog
      open={open}
      onClose={onClose}
      title={mode === 'mkdir' ? 'Create New Folder' : 'Rename Item'}
      icon={
        mode === 'mkdir' ? (
          <FolderPlus size={16} color="var(--accent-bridge)" />
        ) : (
          <Pencil size={16} color="var(--accent-bridge)" />
        )
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog-body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Location: <code className="mono-num">{targetLabel}</code>
          </div>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>{mode === 'mkdir' ? 'Folder Name' : 'New Name'}</span>
            <input
              type="text"
              className="text-input mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'mkdir' ? 'NewFolder' : 'filename.ext'}
              required
              autoFocus
            />
          </label>
          {error && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-danger-soft)',
                color: '#fecdd3',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-bridge" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />}
            <span>{mode === 'mkdir' ? 'Create Folder' : 'Rename'}</span>
          </button>
        </div>
      </form>
    </LightDismissDialog>
  );
};

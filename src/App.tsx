import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Battery,
  Camera,
  Cpu,
  Globe,
  Loader2,
  Monitor,
  PackagePlus,
  RefreshCw,
  Smartphone,
  Unplug,
  Usb,
  Wifi,
  X,
} from 'lucide-react';
import { api } from './api';
import type {
  AndroidDevice,
  DirectoryListingResponse,
  TransferJob,
} from './types';
import { FilePane } from './components/FilePane';
import {
  ApkInstallModal,
  ScreenPreviewModal,
  WifiAdbModal,
} from './components/DeviceModals';
import { TransferDrawer } from './components/TransferDrawer';

export const App: React.FC = () => {
  const isDesktopApp = Boolean(window.droidBridgeDesktop?.isDesktop);

  const [hostname, setHostname] = useState<string>('ubuntu-host');
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [devicesLoading, setDevicesLoading] = useState<boolean>(false);

  // Ubuntu Pane state
  const [localListing, setLocalListing] =
    useState<DirectoryListingResponse | null>(null);
  const [localLoading, setLocalLoading] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());

  // Android Pane state
  const [androidListing, setAndroidListing] =
    useState<DirectoryListingResponse | null>(null);
  const [androidLoading, setAndroidLoading] = useState<boolean>(false);
  const [androidError, setAndroidError] = useState<string | null>(null);
  const [androidSelected, setAndroidSelected] = useState<Set<string>>(
    new Set()
  );

  // Transfer Queue & Banner state
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [transferBusy, setTransferBusy] = useState<boolean>(false);
  const [banner, setBanner] = useState<{
    type: 'info' | 'error';
    text: string;
  } | null>(null);

  // Modals state
  const [wifiModalOpen, setWifiModalOpen] = useState(false);
  const [screenModalOpen, setScreenModalOpen] = useState(false);
  const [apkModalOpen, setApkModalOpen] = useState(false);

  const selectedDevice =
    devices.find((d) => d.serial === selectedSerial) ?? null;

  const showBanner = useCallback((type: 'info' | 'error', text: string) => {
    setBanner({ type, text });
  }, []);

  const loadLocalDirectory = useCallback(async (targetPath?: string) => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const data = await api.listLocalDirectory(targetPath);
      setLocalListing(data);
      setLocalSelected(new Set());
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to read Ubuntu directory');
    } finally {
      setLocalLoading(false);
    }
  }, []);

  const loadAndroidDirectory = useCallback(
    async (serial: string, targetPath?: string) => {
      if (!serial) {
        setAndroidListing(null);
        return;
      }
      setAndroidLoading(true);
      setAndroidError(null);
      try {
        const data = await api.listAndroidDirectory(serial, targetPath);
        setAndroidListing(data);
        setAndroidSelected(new Set());
      } catch (err: any) {
        setAndroidError(err?.message || 'Failed to read Android directory');
      } finally {
        setAndroidLoading(false);
      }
    },
    []
  );

  const loadDevices = useCallback(
    async (preservePath = true) => {
      setDevicesLoading(true);
      try {
        const list = await api.listDevices();
        setDevices(list);
        if (list.length === 0) {
          setSelectedSerial('');
          setAndroidListing(null);
        } else {
          const onlineDevice =
            list.find((d) => d.serial === selectedSerial) ||
            list.find((d) => d.state === 'device') ||
            list[0];
          if (onlineDevice) {
            const serialChanged = onlineDevice.serial !== selectedSerial;
            setSelectedSerial(onlineDevice.serial);
            if (onlineDevice.state === 'device') {
              await loadAndroidDirectory(
                onlineDevice.serial,
                !serialChanged && preservePath
                  ? androidListing?.currentPath
                  : undefined
              );
            }
          }
        }
      } catch (err: any) {
        showBanner('error', err?.message || 'Failed to query ADB devices');
      } finally {
        setDevicesLoading(false);
      }
    },
    [selectedSerial, androidListing?.currentPath, loadAndroidDirectory, showBanner]
  );

  const loadJobs = useCallback(async () => {
    try {
      const list = await api.listTransferJobs();
      setJobs(list);
    } catch {
      // Ignore background poll error
    }
  }, []);

  // Initial boot
  useEffect(() => {
    api
      .getHealth()
      .then((h) => {
        if (h.hostname) setHostname(h.hostname);
      })
      .catch(() => {});
    loadLocalDirectory();
    loadDevices(false);
    loadJobs();
  }, []);

  // Poll jobs when any job is running
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === 'running');
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      loadJobs();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  // Transfer handlers
  const handlePushToAndroid = async (pathsToPush?: string[]) => {
    const sources = pathsToPush ?? Array.from(localSelected);
    if (!selectedDevice || sources.length === 0) return;
    const targetDir = androidListing?.currentPath || '/sdcard';
    setTransferBusy(true);
    try {
      await api.pushToAndroid(selectedDevice.serial, sources, targetDir);
      showBanner(
        'info',
        `Pushed ${sources.length} ${
          sources.length === 1 ? 'item' : 'items'
        } to ${selectedDevice.model}:${targetDir}`
      );
      setLocalSelected(new Set());
      await Promise.all([
        loadAndroidDirectory(selectedDevice.serial, targetDir),
        loadJobs(),
      ]);
    } catch (err: any) {
      showBanner('error', err?.message || 'ADB Push transfer failed');
      await loadJobs();
    } finally {
      setTransferBusy(false);
    }
  };

  const handlePullToLocal = async (pathsToPull?: string[]) => {
    const sources = pathsToPull ?? Array.from(androidSelected);
    if (!selectedDevice || sources.length === 0) return;
    const targetDir = localListing?.currentPath || '/';
    setTransferBusy(true);
    try {
      await api.pullToLocal(selectedDevice.serial, sources, targetDir);
      showBanner(
        'info',
        `Pulled ${sources.length} ${
          sources.length === 1 ? 'item' : 'items'
        } to Ubuntu:${targetDir}`
      );
      setAndroidSelected(new Set());
      await Promise.all([loadLocalDirectory(targetDir), loadJobs()]);
    } catch (err: any) {
      showBanner('error', err?.message || 'ADB Pull transfer failed');
      await loadJobs();
    } finally {
      setTransferBusy(false);
    }
  };

  const handleDirectInstallApk = async (apkPath: string) => {
    if (!selectedDevice) {
      showBanner('error', 'Connect an Android device before installing an APK.');
      return;
    }
    setTransferBusy(true);
    showBanner('info', `Installing ${apkPath.split('/').pop()} on ${selectedDevice.model}...`);
    try {
      await api.installApkFromPath(selectedDevice.serial, apkPath);
      showBanner(
        'info',
        `Successfully installed ${apkPath.split('/').pop()} on ${selectedDevice.model}`
      );
      await loadJobs();
    } catch (err: any) {
      showBanner('error', err?.message || 'APK installation failed');
      await loadJobs();
    } finally {
      setTransferBusy(false);
    }
  };

  const handleDisconnectWifi = async () => {
    if (!selectedDevice) return;
    try {
      await api.disconnectDevice(selectedDevice.serial);
      showBanner('info', `Disconnected ${selectedDevice.serial}`);
      await loadDevices(false);
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to disconnect device');
    }
  };

  return (
    <div className="app-shell">
      {/* Top Workbench Header */}
      <header className="top-header">
        <div className="brand-cluster">
          <img
            src="/logo.svg"
            alt="DroidBridge Logo"
            className="brand-logo"
            width={30}
            height={30}
          />
          <h1 className="brand-title">DroidBridge</h1>
          <span
            className={`runtime-pill ${isDesktopApp ? 'is-desktop' : 'is-web'}`}
            title={
              isDesktopApp
                ? 'Running inside native Ubuntu Electron Desktop shell'
                : 'Running in Web Browser Mode'
            }
          >
            {isDesktopApp ? <Monitor size={12} /> : <Globe size={12} />}
            <span>{isDesktopApp ? 'Ubuntu Desktop App' : 'Web App Mode'}</span>
          </span>
        </div>

        <div className="device-toolbar">
          {/* Device Selector Group */}
          <div className="device-selector-group">
            <Smartphone
              size={14}
              color={
                selectedDevice?.state === 'device'
                  ? 'var(--accent-android)'
                  : 'var(--text-muted)'
              }
            />
            <select
              className="device-select"
              aria-label="Select connected Android device"
              value={selectedSerial}
              onChange={(e) => {
                const nextSerial = e.target.value;
                setSelectedSerial(nextSerial);
                if (nextSerial) {
                  loadAndroidDirectory(nextSerial);
                }
              }}
            >
              {devices.length === 0 ? (
                <option value="">No ADB devices detected</option>
              ) : (
                devices.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.model || d.serial} ({d.serial}) — {d.state.toUpperCase()}
                  </option>
                ))
              )}
            </select>

            {selectedDevice && (
              <div className="device-meta-pills">
                <span
                  className={`meta-badge${
                    selectedDevice.state === 'device' ? ' online' : ''
                  }`}
                >
                  {selectedDevice.transport === 'wifi' ? (
                    <Wifi size={11} />
                  ) : (
                    <Usb size={11} />
                  )}
                  <span>{selectedDevice.transport.toUpperCase()}</span>
                </span>

                {selectedDevice.androidVersion && (
                  <span className="meta-badge" title="Android Version & ABI">
                    <Cpu size={11} />
                    <span>
                      Android {selectedDevice.androidVersion}
                      {selectedDevice.abi ? ` • ${selectedDevice.abi}` : ''}
                    </span>
                  </span>
                )}

                {selectedDevice.batteryLevel !== null &&
                  selectedDevice.batteryLevel !== undefined && (
                    <span className="meta-badge" title="Device Battery Level">
                      <Battery size={11} />
                      <span>{selectedDevice.batteryLevel}%</span>
                    </span>
                  )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => loadDevices(true)}
            disabled={devicesLoading}
            title="Rescan connected USB & Wireless ADB devices"
          >
            <RefreshCw size={13} className={devicesLoading ? 'spin' : ''} />
            <span>Refresh Devices</span>
          </button>

          <button
            type="button"
            className="btn btn-bridge"
            onClick={() => setWifiModalOpen(true)}
          >
            <Wifi size={13} />
            <span>Connect Wi-Fi ADB</span>
          </button>

          {selectedDevice &&
            (selectedDevice.transport === 'wifi' ||
              selectedDevice.serial.includes(':')) && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDisconnectWifi}
                title={`Disconnect ${selectedDevice.serial}`}
              >
                <Unplug size={13} />
                <span>Disconnect</span>
              </button>
            )}

          <button
            type="button"
            className="btn"
            onClick={() => setScreenModalOpen(true)}
            disabled={!selectedDevice || selectedDevice.state !== 'device'}
          >
            <Camera size={13} />
            <span>Screen Preview</span>
          </button>

          <button
            type="button"
            className="btn btn-android"
            onClick={() => setApkModalOpen(true)}
            disabled={!selectedDevice || selectedDevice.state !== 'device'}
          >
            <PackagePlus size={13} />
            <span>Install APK</span>
          </button>
        </div>
      </header>

      {/* Notification Strip */}
      {banner && (
        <div className={`notification-strip ${banner.type}`} role="status">
          <span>{banner.text}</span>
          <button
            type="button"
            className="btn btn-icon-only btn-xs"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Dual-Pane Commander Grid */}
      <main className="workbench-grid">
        {/* Left Pane: Ubuntu Host */}
        <FilePane
          kind="ubuntu"
          title="Ubuntu Host"
          subtitle={hostname}
          listing={localListing}
          loading={localLoading}
          error={localError}
          selectedPaths={localSelected}
          onSelectChange={setLocalSelected}
          onNavigate={(p) => loadLocalDirectory(p)}
          onRefresh={() => loadLocalDirectory(localListing?.currentPath)}
          onCreateFolder={async (folderPath) => {
            await api.localMkdir(folderPath);
            await loadLocalDirectory(localListing?.currentPath);
          }}
          onRenameEntry={async (oldPath, newPath) => {
            await api.localRename(oldPath, newPath);
            await loadLocalDirectory(localListing?.currentPath);
          }}
          onDeleteEntries={async (paths) => {
            await api.localDelete(paths);
            showBanner('info', `Deleted ${paths.length} Ubuntu item(s)`);
            await loadLocalDirectory(localListing?.currentPath);
          }}
          onInstallApk={handleDirectInstallApk}
          onDropFromOtherPane={(sourcePaths) => handlePullToLocal(sourcePaths)}
        />

        {/* Center Transfer Bridge Column */}
        <aside className="bridge-column" aria-label="ADB Transfer Bridge">
          <button
            type="button"
            className="bridge-btn"
            disabled={
              !selectedDevice ||
              selectedDevice.state !== 'device' ||
              localSelected.size === 0 ||
              transferBusy
            }
            onClick={() => handlePushToAndroid()}
            title="Push selected Ubuntu files/folders to current Android directory"
          >
            {transferBusy ? (
              <Loader2 size={16} className="spin" color="var(--accent-bridge)" />
            ) : (
              <ArrowRight size={16} color="var(--accent-bridge)" />
            )}
            <span>Push to Android →</span>
            <span className="count-pill">{localSelected.size} selected</span>
          </button>

          <div className="bridge-divider" />

          <button
            type="button"
            className="bridge-btn"
            disabled={
              !selectedDevice ||
              selectedDevice.state !== 'device' ||
              androidSelected.size === 0 ||
              transferBusy
            }
            onClick={() => handlePullToLocal()}
            title="Pull selected Android files/folders to current Ubuntu directory"
          >
            {transferBusy ? (
              <Loader2 size={16} className="spin" color="var(--accent-bridge)" />
            ) : (
              <ArrowLeft size={16} color="var(--accent-bridge)" />
            )}
            <span>← Pull to Ubuntu</span>
            <span className="count-pill">{androidSelected.size} selected</span>
          </button>

          <div className="bridge-divider" />

          <div className="bridge-hint">
            Select items or drag rows between panes to transfer via high-speed
            ADB.
          </div>
        </aside>

        {/* Right Pane: Android Device */}
        <FilePane
          kind="android"
          title={selectedDevice ? selectedDevice.model : 'Android Device'}
          subtitle={
            selectedDevice
              ? `${selectedDevice.manufacturer || ''} • ${selectedDevice.serial}`.replace(
                  /^ • /,
                  ''
                )
              : 'Disconnected'
          }
          listing={androidListing}
          loading={androidLoading}
          error={androidError}
          selectedPaths={androidSelected}
          onSelectChange={setAndroidSelected}
          onNavigate={(p) =>
            selectedDevice && loadAndroidDirectory(selectedDevice.serial, p)
          }
          onRefresh={() =>
            selectedDevice &&
            loadAndroidDirectory(
              selectedDevice.serial,
              androidListing?.currentPath
            )
          }
          onCreateFolder={async (folderPath) => {
            if (!selectedDevice) return;
            await api.androidMkdir(selectedDevice.serial, folderPath);
            await loadAndroidDirectory(
              selectedDevice.serial,
              androidListing?.currentPath
            );
          }}
          onRenameEntry={async (oldPath, newPath) => {
            if (!selectedDevice) return;
            await api.androidRename(selectedDevice.serial, oldPath, newPath);
            await loadAndroidDirectory(
              selectedDevice.serial,
              androidListing?.currentPath
            );
          }}
          onDeleteEntries={async (paths) => {
            if (!selectedDevice) return;
            await api.androidDelete(selectedDevice.serial, paths);
            showBanner('info', `Deleted ${paths.length} Android item(s)`);
            await loadAndroidDirectory(
              selectedDevice.serial,
              androidListing?.currentPath
            );
          }}
          onUploadFiles={async (files) => {
            if (!selectedDevice) return;
            const targetDir = androidListing?.currentPath || '/sdcard';
            await api.uploadToAndroid(selectedDevice.serial, targetDir, files);
            showBanner(
              'info',
              `Uploaded ${files.length} file(s) to ${selectedDevice.model}:${targetDir}`
            );
            await Promise.all([
              loadAndroidDirectory(selectedDevice.serial, targetDir),
              loadJobs(),
            ]);
          }}
          onDropFromOtherPane={(sourcePaths) =>
            handlePushToAndroid(sourcePaths)
          }
          device={selectedDevice}
          extraVolumes={selectedDevice?.volumes}
        />
      </main>

      {/* Bottom Transfer Queue & Activity Bar */}
      <TransferDrawer jobs={jobs} onRefreshJobs={loadJobs} />

      {/* Modals */}
      <WifiAdbModal
        open={wifiModalOpen}
        onClose={() => setWifiModalOpen(false)}
        onConnected={(msg) => {
          showBanner('info', msg);
          loadDevices(false);
        }}
      />

      <ScreenPreviewModal
        open={screenModalOpen}
        onClose={() => setScreenModalOpen(false)}
        device={selectedDevice}
      />

      <ApkInstallModal
        open={apkModalOpen}
        onClose={() => setApkModalOpen(false)}
        device={selectedDevice}
        onInstalled={(msg) => {
          showBanner('info', msg);
          loadJobs();
        }}
      />
    </div>
  );
};

export default App;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  Lock,
  QrCode,
  Radio,
  RefreshCw,
  Share2,
  Smartphone,
  Terminal,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import { api, formatBytes } from '../api';
import type {
  AndroidDevice,
  P2pDiscoveredPeer,
  P2pNetworkStatus,
  P2pShareSession,
} from '../types';
import { LightDismissDialog } from './DeviceModals';

export interface P2pShareModalProps {
  open: boolean;
  onClose: () => void;
  initialSourceKind: 'ubuntu' | 'android';
  initialPaths: string[];
  localCurrentPath: string;
  androidCurrentPath: string;
  selectedDevice: AndroidDevice | null;
  onConnectedPeer: (msg: string) => void;
  onNotify: (type: 'info' | 'error', msg: string) => void;
}

export const P2pShareModal: React.FC<P2pShareModalProps> = ({
  open,
  onClose,
  initialSourceKind,
  initialPaths,
  localCurrentPath,
  androidCurrentPath,
  selectedDevice,
  onConnectedPeer,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'share' | 'peers'>('share');

  // Share creation form state
  const [sourceKind, setSourceKind] = useState<'ubuntu' | 'android'>(
    initialSourceKind
  );
  const [customPaths, setCustomPaths] = useState<string[]>(initialPaths);
  const [shareTitle, setShareTitle] = useState('');
  const [allowUpload, setAllowUpload] = useState(true);
  const [pin, setPin] = useState('');
  const [creatingShare, setCreatingShare] = useState(false);

  // Active shares & network status
  const [shares, setShares] = useState<P2pShareSession[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Hotspot & peer discovery state
  const [netStatus, setNetStatus] = useState<P2pNetworkStatus | null>(null);
  const [hotspotSsid, setHotspotSsid] = useState('DroidBridge-P2P');
  const [hotspotPassword, setHotspotPassword] = useState('droidbridge123');
  const [hotspotBusy, setHotspotBusy] = useState(false);

  const [peers, setPeers] = useState<P2pDiscoveredPeer[]>([]);
  const [peersLoading, setPeersLoading] = useState(false);
  const [peerScanError, setPeerScanError] = useState<string | null>(null);
  const [connectingPeerKey, setConnectingPeerKey] = useState<string | null>(
    null
  );

  const onNotifyRef = useRef(onNotify);
  useEffect(() => {
    onNotifyRef.current = onNotify;
  }, [onNotify]);

  const wasOpenRef = useRef(false);
  const hasAutoScannedPeersRef = useRef(false);

  const loadSharesAndStatus = useCallback(async () => {
    setSharesLoading(true);
    try {
      const [shareList, status] = await Promise.all([
        api.listP2pShares(),
        api.getP2pStatus(),
      ]);
      setShares(shareList);
      setNetStatus(status);
      if (status.hotspot?.ssid) {
        setHotspotSsid(status.hotspot.ssid);
      }
      if (status.hotspot?.password) {
        setHotspotPassword(status.hotspot.password);
      }
    } catch {
      // Ignore background fetch error
    } finally {
      setSharesLoading(false);
    }
  }, []);

  const scanPeers = useCallback(async (showToastOnError = false) => {
    setPeersLoading(true);
    setPeerScanError(null);
    try {
      const [discovered, status] = await Promise.all([
        api.discoverP2pPeers(),
        api.getP2pStatus(),
      ]);
      setPeers(discovered);
      setNetStatus(status);
    } catch (err: any) {
      const msg = err?.message || 'Failed to scan nearby Wi-Fi peers';
      setPeerScanError(msg);
      if (showToastOnError) {
        onNotifyRef.current('error', msg);
      }
    } finally {
      setPeersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      hasAutoScannedPeersRef.current = false;
      setSourceKind(initialSourceKind);
      setCustomPaths(initialPaths);
      setShareTitle('');
      setPin('');
      setAllowUpload(true);
      setPeerScanError(null);
      loadSharesAndStatus();
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [open, initialSourceKind, initialPaths, loadSharesAndStatus]);

  useEffect(() => {
    if (open && activeTab === 'peers' && !hasAutoScannedPeersRef.current) {
      hasAutoScannedPeersRef.current = true;
      scanPeers(false);
    }
  }, [open, activeTab, scanPeers]);

  // Periodically refresh active share stats while modal is open
  useEffect(() => {
    if (!open || activeTab !== 'share' || shares.length === 0) return;
    const timer = window.setInterval(() => {
      api
        .listP2pShares()
        .then(setShares)
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, activeTab, shares.length]);

  const effectiveDirectory =
    sourceKind === 'ubuntu'
      ? localCurrentPath || '/'
      : androidCurrentPath || selectedDevice?.defaultPath || '/sdcard';

  const effectivePaths =
    customPaths.length > 0 ? customPaths : [effectiveDirectory];

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sourceKind === 'android' && !selectedDevice) {
      onNotify('error', 'No remote Android/Linux device is connected.');
      return;
    }
    setCreatingShare(true);
    try {
      const res = await api.createP2pShare({
        sourceKind,
        serial: sourceKind === 'android' ? selectedDevice?.serial : undefined,
        paths: effectivePaths,
        uploadTargetDir: effectiveDirectory,
        allowUpload,
        pin: pin.trim() || undefined,
        title: shareTitle.trim() || undefined,
      });
      setShares((prev) => [res.share, ...prev.filter((s) => s.id !== res.share.id)]);
      onNotify(
        'info',
        `Created Wi-Fi P2P share "${res.share.title}" (${res.share.items.length} item(s))`
      );
      setShareTitle('');
      setPin('');
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to create Wi-Fi P2P share');
    } finally {
      setCreatingShare(false);
    }
  };

  const handleRevokeShare = async (id: string) => {
    try {
      await api.revokeP2pShare(id);
      setShares((prev) => prev.filter((s) => s.id !== id));
      onNotify('info', 'Stopped Wi-Fi P2P share session');
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to stop P2P share');
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((prev) => (prev === url ? null : prev));
      }, 1800);
    } catch {
      onNotify('error', 'Unable to copy link to clipboard');
    }
  };

  const handleToggleHotspot = async (action: 'start' | 'stop') => {
    setHotspotBusy(true);
    try {
      const res = await api.toggleP2pHotspot({
        action,
        ssid: hotspotSsid.trim() || 'DroidBridge-P2P',
        password: hotspotPassword.trim() || 'droidbridge123',
      });
      onNotify(res.ok ? 'info' : 'error', res.message);
      await loadSharesAndStatus();
    } catch (err: any) {
      onNotify('error', err?.message || 'Wi-Fi P2P Hotspot action failed');
    } finally {
      setHotspotBusy(false);
    }
  };

  const handleConnectPeer = async (
    peer: P2pDiscoveredPeer,
    protocol: 'adb' | 'ssh'
  ) => {
    const targetAddress =
      protocol === 'adb'
        ? `${peer.ip}:${peer.adbPort || 5555}`
        : `root@${peer.ip}:${peer.sshPort || 22}`;
    const key = `${peer.ip}-${protocol}`;
    setConnectingPeerKey(key);
    try {
      const res = await api.connectWifiDevice(targetAddress, { protocol });
      onConnectedPeer(
        res.message || res.output || `Connected to ${targetAddress}`
      );
    } catch (err: any) {
      onNotify(
        'error',
        err?.message || `Failed to connect ${protocol.toUpperCase()} to ${targetAddress}`
      );
    } finally {
      setConnectingPeerKey(null);
    }
  };

  return (
    <LightDismissDialog
      open={open}
      onClose={onClose}
      title="Wi-Fi P2P File & Folder Share + Peer Discovery"
      icon={<QrCode size={16} color="var(--accent-bridge)" />}
      wide
    >
      <div className="dialog-body p2p-modal-body">
        {/* Modal Tabs */}
        <div className="p2p-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'share'}
            className={`p2p-tab-btn${activeTab === 'share' ? ' active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            <QrCode size={14} />
            <span>Share Files & Folders (QR / HTTP P2P)</span>
            {shares.length > 0 && (
              <span className="p2p-tab-badge">{shares.length}</span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'peers'}
            className={`p2p-tab-btn${activeTab === 'peers' ? ' active' : ''}`}
            onClick={() => setActiveTab('peers')}
          >
            <Radio size={14} />
            <span>Nearby Peers & Wi-Fi Direct Hotspot</span>
            {peers.length > 0 && (
              <span className="p2p-tab-badge">{peers.length}</span>
            )}
          </button>
        </div>

        {activeTab === 'share' ? (
          <div className="p2p-section-stack">
            {/* Create Share Card */}
            <form className="p2p-card" onSubmit={handleCreateShare}>
              <div className="p2p-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Share2 size={14} color="var(--accent-bridge)" />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                    Create Instant Wi-Fi P2P Share (Zero App Required on Peer)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 5 }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${
                      sourceKind === 'ubuntu' ? 'btn-ubuntu' : ''
                    }`}
                    onClick={() => {
                      setSourceKind('ubuntu');
                      setCustomPaths([]);
                    }}
                  >
                    <HardDrive size={11} />
                    <span>Local Host</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${
                      sourceKind === 'android' ? 'btn-android' : ''
                    }`}
                    disabled={!selectedDevice || selectedDevice.state !== 'device'}
                    onClick={() => {
                      setSourceKind('android');
                      setCustomPaths([]);
                    }}
                  >
                    <Smartphone size={11} />
                    <span>{selectedDevice?.model || 'Remote Device'}</span>
                  </button>
                </div>
              </div>

              {/* Ready to share summary */}
              <div className="p2p-selection-summary">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FolderOpen
                      size={14}
                      color={
                        sourceKind === 'ubuntu'
                          ? 'var(--accent-ubuntu)'
                          : 'var(--accent-android)'
                      }
                    />
                    {customPaths.length > 0 ? (
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {customPaths.length} selected item(s) from{' '}
                        {sourceKind === 'ubuntu'
                          ? 'Local Host'
                          : selectedDevice?.model || 'Remote Device'}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        Sharing active folder:{' '}
                        <code className="mono-num">{effectiveDirectory}</code>
                      </span>
                    )}
                  </div>

                  {customPaths.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => setCustomPaths([])}
                      title="Switch to sharing the entire current directory"
                    >
                      Share Entire Folder Instead
                    </button>
                  )}
                </div>

                {customPaths.length > 0 && (
                  <div className="p2p-selected-pills">
                    {customPaths.slice(0, 6).map((p) => {
                      const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                      return (
                        <span key={p} className="meta-badge" title={p}>
                          {name}
                        </span>
                      );
                    })}
                    {customPaths.length > 6 && (
                      <span className="meta-badge">
                        +{customPaths.length - 6} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="p2p-form-grid">
                <label className="p2p-field">
                  <span>Share Label / Title (optional)</span>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="e.g. Photos, ROM Pack, Project Build..."
                    value={shareTitle}
                    onChange={(e) => setShareTitle(e.target.value)}
                  />
                </label>

                <label className="p2p-field">
                  <span>4-Digit PIN Protection (optional)</span>
                  <input
                    type="text"
                    className="text-input mono"
                    placeholder="Open (no PIN)"
                    maxLength={8}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <label className="p2p-checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowUpload}
                    onChange={(e) => setAllowUpload(e.target.checked)}
                  />
                  <span>
                    Allow peers to upload / drop files & folders back into{' '}
                    <code className="mono-num">{effectiveDirectory}</code>
                  </span>
                </label>

                <button
                  type="submit"
                  className="btn btn-bridge"
                  disabled={creatingShare}
                >
                  {creatingShare ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <QrCode size={14} />
                  )}
                  <span>Create Wi-Fi P2P Share Link & QR</span>
                </button>
              </div>
            </form>

            {/* Active Shares List */}
            <div className="p2p-active-shares-header">
              <span style={{ fontWeight: 700, fontSize: 12 }}>
                Active Wi-Fi P2P Shares ({shares.length})
              </span>
              <button
                type="button"
                className="btn btn-xs"
                onClick={loadSharesAndStatus}
                disabled={sharesLoading}
              >
                <RefreshCw size={11} className={sharesLoading ? 'spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>

            {shares.length === 0 ? (
              <div className="p2p-empty-box">
                <QrCode size={26} color="var(--text-muted)" />
                <p style={{ margin: 0 }}>
                  No active P2P shares yet. Click{' '}
                  <strong>Create Wi-Fi P2P Share Link & QR</strong> above to
                  generate a scannable QR code and LAN link for any phone,
                  tablet, laptop, or handheld on your Wi-Fi!
                </p>
              </div>
            ) : (
              <div className="p2p-shares-list">
                {shares.map((share) => (
                  <div key={share.id} className="p2p-share-item-card">
                    <div
                      className="p2p-qr-frame"
                      title="Scan with any phone or tablet camera"
                      dangerouslySetInnerHTML={{ __html: share.qrSvg }}
                    />

                    <div className="p2p-share-details">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <strong style={{ fontSize: 13 }}>{share.title}</strong>
                          <span
                            className={`meta-badge ${
                              share.sourceKind === 'android' ? 'online' : ''
                            }`}
                          >
                            {share.sourceKind === 'ubuntu'
                              ? 'LOCAL'
                              : `DEVICE (${share.serial || 'ADB'})`}
                          </span>
                          <span className="meta-badge">
                            {share.items.length}{' '}
                            {share.items.length === 1 ? 'item' : 'items'}
                          </span>
                          {share.allowUpload && (
                            <span className="meta-badge">
                              <Upload size={10} />
                              <span>Bi-Directional Dropzone</span>
                            </span>
                          )}
                          {share.pin && (
                            <span className="meta-badge">
                              <Lock size={10} />
                              <span>PIN: {share.pin}</span>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn btn-xs btn-danger"
                          onClick={() => handleRevokeShare(share.id)}
                        >
                          <Trash2 size={11} />
                          <span>Stop Sharing</span>
                        </button>
                      </div>

                      <div className="p2p-url-list">
                        {share.urls.map((url) => (
                          <div key={url} className="p2p-url-row">
                            <code className="mono-num p2p-url-code">{url}</code>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                type="button"
                                className="btn btn-xs"
                                onClick={() => handleCopyUrl(url)}
                              >
                                {copiedUrl === url ? (
                                  <>
                                    <Check size={11} color="var(--accent-android)" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={11} />
                                    <span>Copy Link</span>
                                  </>
                                )}
                              </button>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-xs"
                                style={{ textDecoration: 'none' }}
                                title="Open P2P portal in browser"
                              >
                                <ExternalLink size={11} />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="p2p-share-meta-row">
                        <span>
                          {share.downloadCount} downloads • {share.uploadCount}{' '}
                          uploads
                        </span>
                        <span>
                          Items:{' '}
                          {share.items
                            .slice(0, 3)
                            .map(
                              (it) =>
                                `${it.name}${
                                  it.isDirectory ? '/' : ` (${formatBytes(it.size)})`
                                }`
                            )
                            .join(', ')}
                          {share.items.length > 3
                            ? ` +${share.items.length - 3} more`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p2p-section-stack">
            {/* Direct Wi-Fi P2P Hotspot Card */}
            <div className="p2p-card">
              <div className="p2p-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wifi size={14} color="var(--accent-bridge)" />
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                    Direct Wi-Fi P2P Hotspot & Local Network Interfaces
                  </span>
                </div>
                {netStatus?.hotspot.active && (
                  <span className="meta-badge online">
                    HOTSPOT ACTIVE ({netStatus.hotspot.ip || netStatus.hotspot.iface})
                  </span>
                )}
              </div>

              {netStatus && netStatus.addresses.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                    }}
                  >
                    Host LAN / P2P IPs:
                  </span>
                  {netStatus.addresses.map((addr) => (
                    <span
                      key={`${addr.iface}-${addr.ip}`}
                      className={`meta-badge${addr.isP2pOrHotspot ? ' online' : ''}`}
                    >
                      {addr.ip} ({addr.iface})
                    </span>
                  ))}
                </div>
              )}

              <p
                style={{
                  margin: 0,
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                }}
              >
                No Wi-Fi router nearby? Start a direct Wi-Fi P2P Hotspot on your
                Linux/Windows host so phones or handhelds can connect directly
                with zero internet required.
              </p>

              <div className="p2p-form-grid">
                <label className="p2p-field">
                  <span>Hotspot SSID</span>
                  <input
                    type="text"
                    className="text-input mono"
                    value={hotspotSsid}
                    onChange={(e) => setHotspotSsid(e.target.value)}
                    placeholder="DroidBridge-P2P"
                  />
                </label>

                <label className="p2p-field">
                  <span>WPA2 Password (min 8 chars)</span>
                  <input
                    type="text"
                    className="text-input mono"
                    value={hotspotPassword}
                    onChange={(e) => setHotspotPassword(e.target.value)}
                    placeholder="droidbridge123"
                  />
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                }}
              >
                {netStatus?.hotspot.active ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={hotspotBusy}
                    onClick={() => handleToggleHotspot('stop')}
                  >
                    {hotspotBusy ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Wifi size={13} />
                    )}
                    <span>Stop Hotspot</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-bridge"
                    disabled={hotspotBusy || netStatus?.hotspot.supported === false}
                    onClick={() => handleToggleHotspot('start')}
                  >
                    {hotspotBusy ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Wifi size={13} />
                    )}
                    <span>Start P2P Hotspot</span>
                  </button>
                )}
              </div>
            </div>

            {/* Auto-Discovered Wi-Fi / LAN Peers */}
            <div className="p2p-active-shares-header">
              <span style={{ fontWeight: 700, fontSize: 12 }}>
                Auto-Discovered Wi-Fi / LAN Peers ({peers.length})
              </span>
              <button
                type="button"
                className="btn btn-xs btn-bridge"
                onClick={() => scanPeers(true)}
                disabled={peersLoading}
              >
                <RefreshCw size={11} className={peersLoading ? 'spin' : ''} />
                <span>Scan Nearby Peers</span>
              </button>
            </div>

            {peerScanError && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  backgroundColor: 'var(--accent-danger-soft)',
                  color: '#fecdd3',
                  fontSize: 12,
                }}
              >
                {peerScanError}
              </div>
            )}

            {peersLoading && peers.length === 0 ? (
              <div className="p2p-empty-box">
                <Loader2 size={22} className="spin" color="var(--accent-bridge)" />
                <p style={{ margin: 0 }}>
                  Scanning local Wi-Fi, ARP neighbor table, and mDNS services for
                  Android ADB & Linux SSH devices...
                </p>
              </div>
            ) : peers.length === 0 ? (
              <div className="p2p-empty-box">
                <Radio size={24} color="var(--text-muted)" />
                <p style={{ margin: 0 }}>
                  No nearby Wi-Fi peers found in ARP/mDNS table yet. Ensure your
                  device is on the same Wi-Fi network or connected to the P2P
                  Hotspot, then click <strong>Scan Nearby Peers</strong>.
                </p>
              </div>
            ) : (
              <div className="p2p-peers-list">
                {peers.map((peer) => {
                  const adbBusy = connectingPeerKey === `${peer.ip}-adb`;
                  const sshBusy = connectingPeerKey === `${peer.ip}-ssh`;
                  return (
                    <div key={peer.ip} className="p2p-peer-row">
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <strong className="mono-num" style={{ fontSize: 13 }}>
                            {peer.ip}
                          </strong>
                          {peer.hostname && (
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                                fontWeight: 600,
                              }}
                            >
                              ({peer.hostname})
                            </span>
                          )}
                          <span className="meta-badge">
                            {peer.source.toUpperCase()}
                          </span>
                          {peer.services.includes('adb') && (
                            <span className="meta-badge online">
                              ADB :{peer.adbPort || 5555}
                            </span>
                          )}
                          {peer.services.includes('ssh') && (
                            <span className="meta-badge online">
                              SSH :{peer.sshPort || 22}
                            </span>
                          )}
                          {peer.services.includes('lan') &&
                            !peer.services.includes('adb') &&
                            !peer.services.includes('ssh') && (
                              <span className="meta-badge">LAN</span>
                            )}
                        </div>

                        <div
                          className="mono-num"
                          style={{ fontSize: 11, color: 'var(--text-muted)' }}
                        >
                          {peer.iface ? `Interface: ${peer.iface}` : 'LAN Peer'}
                          {peer.mac ? ` • MAC: ${peer.mac}` : ''}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        <button
                          type="button"
                          className={`btn btn-xs ${
                            peer.services.includes('adb') ? 'btn-android' : ''
                          }`}
                          disabled={adbBusy || sshBusy}
                          onClick={() => handleConnectPeer(peer, 'adb')}
                          title={`Connect Wireless ADB to ${peer.ip}:${
                            peer.adbPort || 5555
                          }`}
                        >
                          {adbBusy ? (
                            <Loader2 size={11} className="spin" />
                          ) : (
                            <Wifi size={11} />
                          )}
                          <span>Connect ADB</span>
                        </button>

                        <button
                          type="button"
                          className={`btn btn-xs ${
                            peer.services.includes('ssh') ? 'btn-bridge' : ''
                          }`}
                          disabled={adbBusy || sshBusy}
                          onClick={() => handleConnectPeer(peer, 'ssh')}
                          title={`Connect Linux SSH to root@${peer.ip}:${
                            peer.sshPort || 22
                          }`}
                        >
                          {sshBusy ? (
                            <Loader2 size={11} className="spin" />
                          ) : (
                            <Terminal size={11} />
                          )}
                          <span>Connect SSH</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="dialog-footer">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </LightDismissDialog>
  );
};

<p align="center">
  <img src="public/logo.svg" alt="DroidBridge Logo" width="110" height="110" style="border-radius: 24px; box-shadow: 0 12px 32px rgba(56,189,248,0.25);">
</p>

<h1 align="center">DroidBridge</h1>

<p align="center">
  <strong>The Dual-Pane Desktop &harr; Android / Linux Handheld Workstation &amp; P2P File Bridge.</strong><br>
  Fusing <b>Total Commander dual-pane precision</b> with <b>recursive folder drag-and-drop</b>, <b>Wi-Fi P2P QR sharing</b>, and <b>direct USB / Wi-Fi ADB &amp; SSH transfers</b>.<br>
  <i>Available as a 2-in-1 Web App &amp; Native Desktop App for Linux (<code>.deb</code> / <code>.AppImage</code>), Windows (<code>.exe</code>), and macOS (<code>.dmg</code>).</i>
</p>

<p align="center">
  <a href="https://vndangkhoa.github.io/DroidBridge/"><img src="https://img.shields.io/badge/Website-Live_Demo-38BDF8?style=for-the-badge&logo=googlechrome&logoColor=black" alt="Live Website"></a>
  <a href="https://github.com/vndangkhoa/DroidBridge/releases"><img src="https://img.shields.io/github/v/release/vndangkhoa/DroidBridge?style=for-the-badge&label=Releases&color=F59E0B" alt="GitHub Releases"></a>
  <a href="https://git.khoavo.myds.me/vndangkhoa/DroidBridge"><img src="https://img.shields.io/badge/Forgejo-MyDS_Mirror-success?style=for-the-badge&logo=forgejo&logoColor=white" alt="Forgejo Repository"></a>
  <a href="https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge"><img src="https://img.shields.io/badge/GitLab-Self--Hosted-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white" alt="GitLab Repository"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/Frontend-React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Desktop-Electron_34-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 34"></a>
  <a href="#-license"><img src="https://img.shields.io/badge/License-MIT-gray?style=for-the-badge" alt="License MIT"></a>
</p>

<p align="center">
  <a href="https://vndangkhoa.github.io/DroidBridge/"><b>🌐 Website</b></a> •
  <a href="#-quick-start-30-seconds"><b>Quick Start</b></a> •
  <a href="#-why-droidbridge"><b>Why DroidBridge?</b></a> •
  <a href="#-competitive-comparison"><b>Comparison</b></a> •
  <a href="#-interface--layout-highlights"><b>Interface</b></a> •
  <a href="#-killer-features"><b>Features</b></a> •
  <a href="#-architecture--directory-structure"><b>Architecture</b></a> •
  <a href="#-rest-api-reference"><b>API Reference</b></a>
</p>

---

## ⚡ Why DroidBridge?

Managing files between your workstation and Android devices or Linux handhelds—such as the **TrimUI Smart Pro S (`TG5050`)**, **Retroid Pocket**, **Odin**, or **Anbernic**—is notoriously frustrating. Standard MTP mounts (`gvfs-mtp`, Android File Transfer) lock up on nested directories, drop connections mid-transfer, and hide external MicroSD partitions, while raw `adb` and `scp` terminal commands are tedious for multi-folder operations.

**DroidBridge** replaces flaky MTP mounts with a fast, multi-protocol dual-pane workstation:

- 🖱️ **Recursive File & Folder Drag-and-Drop**: Drag files or deeply nested folder trees across panes (`Local ↔ Android/SSH`) or drop folders directly from **Ubuntu Files, Windows Explorer, or macOS Finder** onto either pane.
- 📡 **Wi-Fi P2P File & Folder Sharing (QR + Hotspot)**: Share any local or device files/folders via an instant **QR code & HTTP LAN portal (`/p2p/s/:token`)** with on-the-fly `.tar.gz` folder streaming, optional **4-digit PIN lock**, **2-way browser uploads**, and a built-in **Linux Wi-Fi Hotspot (`DroidBridge-P2P`)** when no router is nearby.
- 🔌 **USB ADB, Wireless ADB & Linux/Termux SSH**: Connect over USB ADB, Wireless ADB (`:5555`), or SSH/SFTP (`ssh://user@host:port`, `:8022` Termux, `~/.ssh/config` presets) with **zero-config LAN peer discovery** (mDNS + ARP + port scan).
- 🖥️ **Cross-Platform 2-in-1 Runtime**: Run as a local web server (`http://localhost:3456`) from any browser or launch as a native desktop app on **Linux (`.deb`, `.AppImage`)**, **Windows (`.exe`)**, and **macOS (`.dmg`)**.
- 📦 **1-Click `.apk` Sideloader & Live Screen Capture**: Install APKs directly from the local pane or via drag-and-drop (`adb install -r`), and capture live PNG device screenshots (`screencap -p` on Android + DRM/framebuffer capture on Linux handhelds).

---

## 📊 Competitive Comparison

| Capability | 🌉 **DroidBridge** | 📁 Linux MTP / OpenMTP | 💻 Raw `adb` / `scp` CLI |
| :--- | :---: | :---: | :---: |
| **Transfer Protocols** | **✅ Direct ADB + SSH/SFTP + HTTP P2P** | ❌ Slow, single-threaded MTP | ✅ Direct CLI only |
| **Dual-Pane Commander UI** | **✅ Side-by-Side Local & Remote** | ⚠️ Limited / MTP only | ❌ Terminal only |
| **Recursive Folder Drag & Drop** | **✅ Cross-Pane & OS File Manager Drops** | ⚠️ Often freezes on large trees | ❌ Manual paths |
| **Wi-Fi P2P QR Share & Folder Streaming** | **✅ Instant QR + `.tar.gz` + PIN + Upload** | ❌ No | ❌ No |
| **Built-in Linux Wi-Fi Hotspot** | **✅ 1-Click `nmcli` Hotspot (`10.42.0.1`)** | ❌ No | ❌ No |
| **LAN Auto-Discovery (`:5555` / `:22`)** | **✅ mDNS + ARP + TCP Port Scanner** | ❌ USB cable required | ❌ Manual IP lookup |
| **External MicroSD Detection** | **✅ Auto-detects `/storage/XXXX-XXXX` & `/mnt/SDCARD`** | ⚠️ Frequently hidden | ⚠️ Manual path lookup |
| **1-Click `.apk` Sideloading & Screen Capture** | **✅ Inline APK Install + PNG Preview** | ❌ No | ⚠️ Manual CLI pipes |

---

## 📸 Interface & Layout Highlights

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [⇄] DroidBridge  [Desktop / Web]   [📱 TG5050 (USB • Android 13 / KV-OS • arm64-v8a • 92%)]          │
│                                    [⟳ Refresh] [📡 P2P Share & QR] [📶 Wi-Fi / SSH] [📷 Screen] [APK]│
├───────────────────────────────────────────┬──────────────┬───────────────────────────────────────────┤
│ 🟠 LOCAL HOST (workstation)               │              │ 🟢 REMOTE DEVICE (TG5050 • USB / SSH)     │
│ [🏠 Home] [⬇ Downloads] [📄 Docs] [/mnt]  │  Drag & Drop │ [💾 Internal] [🎮 RetroArch] [💳 SD Card] │
│ [/mnt/data/Projects/roms]  [🔍 Filter...] │  Folders ⇄   │ [/storage/3A1F-8B2E/roms]  [🔍 Filter...] │
├───────────────────────────────────────────┼──────────────┼───────────────────────────────────────────┤
│ ☑ 📁 psx                     4 items [P2P]│  [Push →]    │ ☐ 📁 ..                                   │
│ ☑ 📁 gba                    18 items [P2P]│  2 selected  │ ☐ 📁 bios                     12 items    │
│ ☐ 📦 RetroArch_aarch64.apk   142.8 MB [APK]│  ──────────  │ ☐ 📁 saves                    34 items    │
│ ☐ 📄 config.cfg                4.2 KB [P2P]│  [← Pull]    │ ☐ 📄 retroarch.cfg             38.1 KB    │
│                                           │  0 selected  │                                           │
├───────────────────────────────────────────┴──────────────┴───────────────────────────────────────────┤
│ ⇅ TRANSFER QUEUE & ACTIVITY LOG (3 completed • 0 running)                                            │
│  ✅ PUSH  psx, gba -> /storage/3A1F-8B2E/roms                              648.4 MB • 1.8s • COMPLETED│
│  ✅ P2P   Shared folder /mnt/data/Projects/roms/psx via QR (PIN locked)             •LAN  • ACTIVE   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Killer Features

### 1. 🖱️ Recursive File & Folder Drag-and-Drop
- **Cross-Pane Drag & Drop**: Drag selected files or folders directly between the Local Host pane and the Android/Linux Device pane to trigger instant `adb push`, `adb pull`, or `scp` transfers.
- **External OS File Manager Drops**: Drag files and deeply nested folders straight from **Ubuntu Files (Nautilus)**, **Windows Explorer**, or **macOS Finder** onto either pane. Uses zero-copy native paths (`webUtils.getPathForFile`) in Electron Desktop mode and recursive `webkitGetAsEntry` directory traversal in Web mode.
- **Dedicated Upload Buttons**: Includes both **Upload Files** and **Upload Folder** (`webkitdirectory`) buttons in both panes.

### 2. 📡 Wi-Fi P2P Share Portal, QR Code & Linux Hotspot
- **Instant QR & HTTP Share Links (`/p2p/s/:token`)**: Click the **P2P Share** button on any file, folder, or multi-selection to generate a scannable QR code and LAN URL (`http://<lan-ip>:3456/p2p/s/<token>`).
- **On-the-Fly `.tar.gz` Folder Streaming**: Shared directories are streamed dynamically as compressed `.tar.gz` archives without writing temporary zip files to disk.
- **Bi-Directional Dropzone & PIN Security**: Optionally enable **Allow visitors to upload files & folders** (turning any phone browser into a wireless dropzone back to your PC/device) and protect shares with a **4-digit PIN** and expiration timer.
- **1-Click Linux Wi-Fi Hotspot (`DroidBridge-P2P`)**: No router? Start a local NetworkManager Wi-Fi hotspot (`10.42.0.1`) directly inside the P2P modal so phones and handhelds can connect peer-to-peer anywhere.

### 3. 🔍 Zero-Config LAN Peer Discovery & Multi-Protocol Bridge
- **Auto-Discovery Scanner**: Scans your local subnet using mDNS (`avahi-browse`), ARP tables, and fast TCP port probing to discover nearby Android Wireless ADB (`:5555`), Termux SSH (`:8022`), and Linux handheld SSH (`:22`) devices for 1-click connection.
- **Android ADB + KV-OS Linux ADB + SSH/SFTP**: Seamlessly switch between standard Android devices, Linux-based ADB handhelds (such as **TrimUI Smart Pro S / KV-OS**), and SSH/SFTP targets (`~/.ssh/config` presets or `user@host:port` with key/password support).

### 4. 🎮 Handheld & Multi-Volume Storage Bookmarks
- Automatically scans `/storage` and `/mnt` to detect removable FAT32/exFAT MicroSD cards (`/storage/XXXX-XXXX`, `/mnt/SDCARD`, `/roms`) and mounts them as 1-click volume pills with live capacity bars.
- Built-in quick-jump pills for `Internal`, `Download`, `DCIM`, `Pictures`, and `RetroArch`.

### 5. 📦 One-Click `.apk` Sideloader & Dual-Engine Screen Capture
- **Inline APK Button**: Any `.apk` file in the Local Host pane displays an **`[APK]`** quick-install button (`adb install -r`).
- **Live Screen Preview**: Captures lossless PNG screenshots via `adb exec-out screencap -p` on Android devices, with automatic fallback to Linux DRM/framebuffer (`/dev/fb0` / `ffmpeg`) capture on Linux handhelds.

---

## 🏗️ Architecture & Directory Structure

```text
DroidBridge/
├── docs/                          # Minimalist GitHub Pages promotional website & interactive demo
│   ├── index.html                 # Interactive Dual-Pane Workbench, Drag & Drop + P2P QR showcase
│   ├── styles.css                 # Tactile Dark Workbench responsive stylesheet
│   ├── app.js                     # HTML5 drag-and-drop, P2P modal & device switcher simulation
│   └── logo.svg                   # Vector emblem for GitHub Pages
├── public/
│   ├── logo.svg                   # Primary vector app logo
│   ├── icon.png                   # 512x512 desktop & installer icon
│   └── favicon.png                # 64x64 browser favicon
├── electron/
│   ├── main.cjs                   # Electron main process (manages Express lifecycle & native dialogs)
│   └── preload.cjs                # Context-isolated desktop bridge + webUtils.getPathForFile
├── server/
│   ├── index.ts                   # Express REST API server, recursive upload handler & static SPA host
│   ├── adb.ts                     # Android & KV-OS Linux ADB engine (devices, ls, push/pull, APK, screencap)
│   ├── ssh.ts                     # Linux & Termux SSH/SFTP engine (ssh/scp, ~/.ssh/config presets)
│   ├── p2p.ts                     # Wi-Fi P2P share portal (/p2p/s/:token), LAN peer scanner & nmcli hotspot
│   └── localFs.ts                 # Cross-platform local filesystem engine (Linux, Windows, macOS)
├── src/
│   ├── components/
│   │   ├── FilePane.tsx           # Dual-pane commander table with recursive OS & cross-pane drag-and-drop
│   │   ├── P2pShareModal.tsx      # P2P QR share studio, LAN peer scanner & Wi-Fi hotspot controller
│   │   ├── DeviceModals.tsx       # Native <dialog> modals for Wi-Fi ADB / SSH, Screen Preview & APK Install
│   │   └── TransferDrawer.tsx     # Bottom collapsible transfer queue & history drawer
│   ├── utils/
│   │   └── dropzone.ts            # Recursive DataTransferItem / FileSystemDirectoryReader traversal
│   ├── App.tsx                    # Top workbench header, dual-pane grid & transfer state coordinator
│   ├── api.ts                     # Typed frontend REST client
│   ├── types.ts                   # Shared TypeScript interfaces for entries, devices, P2P & transfer jobs
│   └── index.css                  # Tactile Dark Workbench design system
├── .github/workflows/
│   └── release.yml                # Automated multi-OS GitHub Release builder (Linux, Windows, macOS)
├── DESIGN.md                      # Tactile Dark Workbench visual & aesthetic specification
├── PRODUCT.md                     # Product capabilities & workflow specification
└── package.json                   # Project dependencies, scripts & electron-builder targets
```

---

## 🚀 Quick Start (30 Seconds)

### Option A: Download Pre-Built Desktop Installers
Grab the latest release for your OS from [**GitHub Releases**](https://github.com/vndangkhoa/DroidBridge/releases/latest):
- **Linux (`x64`)**: `.deb` package or standalone `.AppImage`
- **Windows (`x64`)**: `.exe` installer / portable `.zip`
- **macOS (`arm64` & `x64`)**: `.dmg` disk image / `.zip`

### Option B: Run from Source (Web App or Desktop App)

Ensure **Node.js `>= 20.x`** and **Android Platform Tools (`adb`)** are installed:

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y adb

# Clone and install
git clone https://github.com/vndangkhoa/DroidBridge.git
cd DroidBridge
npm install
```

- **Run as a Web App (`http://localhost:3456`)**:
  ```bash
  ./scripts/start-web.sh
  # Or: npm run build && npm start
  ```
- **Run as a Native Desktop App (Electron)**:
  ```bash
  ./scripts/start-desktop.sh
  # Or: npm run desktop
  ```
- **Build Distributable Packages Locally**:
  ```bash
  npm run dist:linux   # Builds .deb and .AppImage in release/
  npm run dist:win     # Builds Windows package in release/
  npm run dist:mac     # Builds macOS x64/arm64 packages in release/
  ```

---

## 📡 REST API Reference

DroidBridge exposes its JSON/multipart REST API and P2P share portal on port `3456`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check returning server status, OS platform, and hostname |
| `GET` | `/api/devices` | Lists connected USB ADB, Wi-Fi ADB, and SSH devices with telemetry & storage volumes |
| `GET` | `/api/ssh/presets` | Lists SSH host presets parsed from `~/.ssh/config` |
| `POST` | `/api/devices/connect` | Connects to a wireless ADB (`ip:port`) or SSH (`ssh://user@host:port`) device |
| `POST` | `/api/devices/disconnect` | Disconnects an active wireless ADB or SSH session |
| `GET` | `/api/devices/:serial/screenshot` | Streams a live PNG screen capture (Android `screencap` or Linux `fb0`/DRM) |
| `GET` | `/api/local/list?path=...` | Lists entries, permissions, sizes, and quick bookmarks for a local directory |
| `POST` | `/api/local/copy` | Copies local files/folders dropped from the OS file manager into the active local folder |
| `POST` | `/api/local/upload` | Uploads browser files and recursive folder structures (`relativePaths`) to a local folder |
| `POST` | `/api/local/mkdir` \| `rename` \| `delete` | Creates, renames, or deletes local files and directories |
| `GET` | `/api/android/list?serial=...&path=...` | Lists entries, permissions, sizes, and volumes for an Android or SSH directory |
| `POST` | `/api/android/upload` | Uploads browser files and recursive folders (`relativePaths`) to the remote device |
| `GET` | `/api/android/download?serial=...&path=...` | Streams a remote file (or `.tar.gz` directory) as a browser download |
| `POST` | `/api/transfer/push` | Recursively transfers selected local files/folders to the remote device |
| `POST` | `/api/transfer/pull` | Recursively transfers selected remote files/folders to the local host |
| `POST` | `/api/android/install-apk` | Sideloads an `.apk` from a local path or multipart upload (`adb install -r`) |
| `GET` | `/api/p2p/status` | Returns LAN IPv4 addresses, active P2P shares, and Linux Wi-Fi hotspot state |
| `POST` | `/api/p2p/shares` | Creates a new P2P share link + SVG QR code with optional PIN and 2-way upload support |
| `GET` | `/p2p/s/:token` | Mobile-friendly Web P2P Portal for downloading shared files/folders (`.tar.gz`) & uploading |
| `POST` | `/api/p2p/discover` | Scans the LAN via mDNS, ARP, and TCP port probing (`:5555`, `:8022`, `:22`) for nearby devices |
| `POST` | `/api/p2p/hotspot/start` \| `stop` | Starts or stops a local NetworkManager Wi-Fi hotspot (`DroidBridge-P2P`) |

---

## 🌟 Official Website & Mirrors

| Platform | URL |
| :--- | :--- |
| **Promotional Website** | [`https://vndangkhoa.github.io/DroidBridge/`](https://vndangkhoa.github.io/DroidBridge/) |
| **GitHub Repository** | [`https://github.com/vndangkhoa/DroidBridge`](https://github.com/vndangkhoa/DroidBridge) |
| **Forgejo (Self-Hosted)** | [`https://git.khoavo.myds.me/vndangkhoa/DroidBridge`](https://git.khoavo.myds.me/vndangkhoa/DroidBridge) |
| **GitLab (Self-Hosted)** | [`https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge`](https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge) |

---

## 📄 License

Distributed under the **MIT License**.

Developed with ❤️ by **Khoa Vo ([@vndangkhoa](https://github.com/vndangkhoa))**.

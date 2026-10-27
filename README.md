<h1 align="center">DroidBridge</h1>

<p align="center">
  <strong>The Dual-Pane Ubuntu &harr; Android Workstation &amp; High-Speed ADB File Manager.</strong><br>
  Fusing <b>Total Commander dual-pane precision</b> with <b>direct USB &amp; Wireless ADB transfers</b> in a 2-in-1 Web App &amp; Native Ubuntu Desktop App.<br>
  <i>Powered by a Node.js + Express + TypeScript ADB engine, React 19 + Vite frontend, and Electron 34 native Ubuntu desktop shell.</i>
</p>

<p align="center">
  <a href="https://git.khoavo.myds.me/vndangkhoa/DroidBridge"><img src="https://img.shields.io/badge/Forgejo-MyDS_Mirror-success?style=for-the-badge&logo=forgejo&logoColor=white" alt="Forgejo Repository"></a>
  <a href="https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge"><img src="https://img.shields.io/badge/GitLab-Self--Hosted-FC6D26?style=for-the-badge&logo=gitlab&logoColor=white" alt="GitLab Repository"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/Frontend-React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Desktop-Electron_34-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 34"></a>
  <a href="https://developer.android.com/tools/adb"><img src="https://img.shields.io/badge/Bridge-Android_ADB-10B981?style=for-the-badge&logo=android&logoColor=white" alt="Android ADB"></a>
  <a href="#-license"><img src="https://img.shields.io/badge/License-MIT-gray?style=for-the-badge" alt="License MIT"></a>
</p>

<p align="center">
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

Managing files between Ubuntu/Linux and Android devices—whether smartphones, tablets, or Android-powered retro handhelds like the **TrimUI Smart Pro S (`TG5050`)**—is notoriously frustrating. Standard Linux MTP mounts (`gvfs-mtp`) lock up on large directories, drop connections mid-transfer, and hide external MicroSD partitions, while raw `adb push`/`adb pull` terminal commands are tedious for multi-folder operations.

**DroidBridge** replaces flaky MTP mounts with a rock-solid, hardware-accelerated ADB workstation:

- 🖥️ **2-in-1 Dual Runtime (Web App + Ubuntu Desktop App)**: Run as a standalone local web server (`http://localhost:3456`) accessible from any browser, or launch as a native Ubuntu desktop application (`electron` + `.desktop` launcher) with zero configuration.
- ⚡ **True Dual-Pane Commander Workflow**: Browse your **Ubuntu Host** (`$HOME`, `Downloads`, `/media`, `/mnt`) on the left and your **Android Device** (`/sdcard`, `Download`, `DCIM`, `RetroArch`, and external MicroSD `/storage/XXXX-XXXX`) on the right.
- 🚀 **Full-Speed ADB Push & Pull Bridge**: Select multiple files or entire directories and transfer them across panes with a single click—or drag and drop rows directly between Ubuntu and Android.
- 📶 **Wireless ADB & Multi-Device Hot-Switching**: Pair and switch between USB and Wi-Fi ADB (`<ip>:<port>`) devices on the fly with live telemetry badges (Android OS version, CPU ABI, transport mode, and battery percentage).
- 📦 **1-Click `.apk` Sideloader & Live Screen Capture**: Install APKs directly from the Ubuntu file pane or via browser drag-and-drop (`adb install -r`), and capture live PNG device screenshots (`adb exec-out screencap -p`) with instant download.

---

## 📊 Competitive Comparison

| Capability | 🌉 **DroidBridge** | 📁 Linux MTP (`GVFS / Nautilus`) | 💻 Raw `adb` CLI | 🤖 Android File Transfer |
| :--- | :---: | :---: | :---: | :---: |
| **Transfer Protocol** | **✅ Direct `adb push` / `adb pull`** | ❌ Slow, single-threaded MTP | ✅ Direct ADB | ❌ Legacy MTP |
| **Dual-Pane Commander UI** | **✅ Side-by-Side Ubuntu & Android** | ❌ Separate windows | ❌ Terminal only | ❌ Single window |
| **2-in-1 Execution Mode** | **✅ Web Browser + Ubuntu Desktop App** | ⚠️ Desktop file manager only | ❌ CLI only | ⚠️ Desktop only |
| **Wireless Transfer Support** | **✅ Built-in Wi-Fi ADB (`ip:port`)** | ❌ USB cable required | ✅ Manual `adb connect` | ❌ USB cable required |
| **External MicroSD Detection** | **✅ Auto-detects `/storage/XXXX-XXXX`** | ⚠️ Frequently hidden or locked | ⚠️ Manual path lookup | ⚠️ Inconsistent |
| **1-Click `.apk` Sideloading** | **✅ Inline from Ubuntu Pane or Upload** | ❌ No | ⚠️ Manual `adb install -r` | ❌ No |
| **Live Device Screen Preview** | **✅ Instant PNG Capture & Download** | ❌ No | ⚠️ Manual pipe required | ❌ No |

---

## 📸 Interface & Layout Highlights

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [⇄] DroidBridge  [Ubuntu Desktop App]     [📱 TG5050 (USB • Android 13 • arm64-v8a • 92%)]          │
│                                           [⟳ Refresh] [📶 Wi-Fi ADB] [📷 Screen] [📦 Install APK]    │
├───────────────────────────────────────────┬──────────────┬───────────────────────────────────────────┤
│ 🟠 UBUNTU HOST (workstation)              │              │ 🟢 ANDROID DEVICE (TG5050 • USB)          │
│ [🏠 Home] [⬇ Downloads] [📄 Docs] [/mnt]  │              │ [💾 Internal] [⬇ Download] [🎮 RetroArch] │
│ [/mnt/data/Projects/roms]  [🔍 Filter...] │              │ [/storage/3A1F-8B2E/roms]  [🔍 Filter...] │
├───────────────────────────────────────────┼──────────────┼───────────────────────────────────────────┤
│ ☑ 📁 psx                     4 items      │  [Push →]    │ ☐ 📁 ..                                   │
│ ☑ 📁 gba                    18 items      │  2 selected  │ ☐ 📁 bios                     12 items    │
│ ☐ 📦 RetroArch_aarch64.apk   142.8 MB [APK]│  ──────────  │ ☐ 📁 saves                    34 items    │
│ ☐ 📄 config.cfg                4.2 KB     │  [← Pull]    │ ☐ 📄 retroarch.cfg             38.1 KB    │
│                                           │  0 selected  │                                           │
├───────────────────────────────────────────┴──────────────┴───────────────────────────────────────────┤
│ ⇅ TRANSFER QUEUE & ACTIVITY LOG (2 completed • 0 running)                                            │
│  ✅ PUSH  psx, gba -> /storage/3A1F-8B2E/roms                              648.4 MB • 1.8s • COMPLETED│
│  ✅ APK   Install APK RetroArch_aarch64.apk                                         • 3.1s • COMPLETED│
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Left Pane — Ubuntu Host (`#f59e0b` Warm Amber Accent)**: Navigate local Linux directories with quick bookmarks (`Home`, `Downloads`, `Documents`, `Desktop`, `/media`, `/mnt`), inspect POSIX permissions/sizes/timestamps, create/rename/delete folders, and one-click install `.apk` packages directly onto the active Android device.
- **Center ADB Transfer Bridge (`#38bdf8` Cyan Accent)**: Dedicated transfer action column displaying active selection counts, directional `Push to Android →` and `← Pull to Ubuntu` triggers, and cross-pane HTML5 drag-and-drop support.
- **Right Pane — Android Device (`#10b981` Emerald Mint Accent)**: Browse `/sdcard`, `Download`, `DCIM`, `Pictures`, `Music`, `Movies`, `RetroArch`, and dynamically discovered external SD cards (`/storage/XXXX-XXXX`), plus direct browser file upload and single-file download.
- **Bottom Transfer Queue Drawer**: Real-time job tracker recording transfer direction (`PUSH`, `PULL`, `APK-INSTALL`), byte volume, elapsed duration, and completion status.

---

## 🎯 Killer Features

### 1. 🖥️ 2-in-1 Dual Runtime (Web App + Native Ubuntu Desktop App)
DroidBridge runs seamlessly in two modes from a single codebase:
- **Web App Mode (`http://localhost:3456`)**: Access the full dual-pane workstation from Chrome, Firefox, Brave, or remotely over your LAN.
- **Ubuntu Desktop Mode (`Electron 34`)**: Launches a native dark-themed Ubuntu desktop window that automatically manages the embedded Express/ADB server lifecycle and integrates with your GNOME/KDE application launcher via [`droidbridge.desktop`](droidbridge.desktop).

### 2. ⚡ High-Throughput ADB Push & Pull Engine
Built directly on native `adb push` and `adb pull` child-process streams in [`server/adb.ts`](server/adb.ts). Preserves filenames, supports spaces and Unicode characters safely via POSIX single-quote escaping, and recursively calculates local directory byte totals prior to transfer.

### 3. 🎮 Handheld & Multi-Volume Storage Bookmarks
Tailored for both everyday Android smartphones and gaming handhelds (such as **TrimUI Smart Pro S**, **Odin**, **Retroid Pocket**, and **Anbernic**):
- Automatically scans `/storage` to detect removable FAT32/exFAT MicroSD cards (`/storage/XXXX-XXXX`) and mounts them as 1-click volume pills in the Android pane.
- Dedicated quick-jump pill for `/sdcard/RetroArch` alongside standard Android media directories.

### 4. 📶 Wireless ADB Pairing & Device Telemetry
Connect over Wi-Fi (`adb connect <ip>:<port>`, defaulting to port `5555`) directly from the top toolbar modal. Queries device properties (`ro.product.model`, `ro.product.manufacturer`, `ro.build.version.release`, `ro.product.cpu.abi`, and `dumpsys battery`) in parallel.

### 5. 📦 One-Click `.apk` Sideloader & Live Screen Preview
- **Inline APK Button**: Any `.apk` file in the Ubuntu Host pane displays a dedicated **`[APK]`** quick-install button that executes `adb install -r` immediately.
- **Modal APK Uploader**: Sideload `.apk` files from any browser client or enter an Ubuntu file path directly.
- **Live Screen Preview**: Captures a lossless PNG framebuffer snapshot (`adb exec-out screencap -p`) in a responsive modal with 1-click refresh and timestamped PNG download.

---

## 🏗️ Architecture & Directory Structure

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                        DroidBridge Dual-Runtime Workstation                              │
│                                                                                          │
│  ┌────────────────────────────────────────┐    ┌──────────────────────────────────────┐  │
│  │   Web Browser (http://localhost:3456)  │    │  Ubuntu Desktop Shell (Electron 34)  │  │
│  └───────────────────┬────────────────────┘    └──────────────────┬───────────────────┘  │
│                      └────────────────────┬───────────────────────┘                      │
│                                           ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │             React 19 + TypeScript Dual-Pane Workbench UI (src/)                    │  │
│  │  • FilePane (Ubuntu & Android)   • TransferDrawer   • DeviceModals (Wi-Fi/APK/Scr) │  │
│  └───────────────────┬────────────────────────────────────────────┬───────────────────┘  │
│                      │ REST API (/api/local/*, /api/transfer/*)   │ REST API (/api/android/*)
│                      ▼                                            ▼                      │
│  ┌────────────────────────────────────────┐    ┌──────────────────────────────────────┐  │
│  │   Ubuntu Host FS Engine (localFs.ts)   │    │     Android ADB Bridge (adb.ts)      │  │
│  │  • Node.js fs.promises + stat          │    │  • Child-process `adb` execution     │  │
│  │  • POSIX permissions & byte sizing     │    │  • GNU/Toybox `ls -la` parser        │  │
│  │  • Bookmark & mount discovery          │    │  • USB & Wireless ADB transport      │  │
│  └────────────────────────────────────────┘    └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

```text
DroidBridge/
├── electron/
│   ├── main.cjs                   # Electron main process (auto-starts Express server & native dialogs)
│   └── preload.cjs                # Context-isolated desktop bridge (window.droidBridgeDesktop)
├── scripts/
│   ├── start-web.sh               # Production Web App launcher (builds dist/ if needed & runs port 3456)
│   ├── start-desktop.sh           # Native Ubuntu Electron Desktop launcher
│   └── install-desktop-entry.sh   # Installs droidbridge.desktop into ~/.local/share/applications
├── server/
│   ├── index.ts                   # Express REST API server, Multer upload handler & static SPA host
│   ├── adb.ts                     # Android ADB wrapper (devices, ls parser, push/pull, APK, screencap)
│   └── localFs.ts                 # Ubuntu filesystem engine (list, mkdir, rename, delete, byte size)
├── src/
│   ├── components/
│   │   ├── FilePane.tsx           # Reusable dual-pane commander table with filter, sort & drag-drop
│   │   ├── DeviceModals.tsx       # Native <dialog> modals for Wi-Fi ADB, Screen Preview & APK Install
│   │   └── TransferDrawer.tsx     # Bottom collapsible transfer queue & history drawer
│   ├── App.tsx                    # Top workbench header, dual-pane grid & transfer state coordinator
│   ├── api.ts                     # Typed frontend REST client
│   ├── types.ts                   # Shared TypeScript interfaces for entries, devices & transfer jobs
│   ├── index.css                  # Tactile Dark Workbench design system & responsive container queries
│   └── main.tsx                   # React 19 entry point
├── DESIGN.md                      # Tactile Dark Workbench visual & aesthetic specification
├── PRODUCT.md                     # Product capabilities & user workflow specification
├── droidbridge.desktop            # Ubuntu/GNOME desktop launcher specification
├── package.json                   # Project dependencies and npm scripts
└── vite.config.ts                 # Vite 6 bundler & /api development proxy configuration
```

---

## 🚀 Quick Start (30 Seconds)

### Prerequisites

Ensure **Node.js `>= 20.x`** and **Android Platform Tools (`adb`)** are installed on your Ubuntu system:

```bash
sudo apt update && sudo apt install -y adb
```

Clone and install dependencies:

```bash
git clone https://git.khoavo.myds.me/vndangkhoa/DroidBridge.git
cd DroidBridge
npm install
```

---

### Option A: Run as a Web App (`http://localhost:3456`)

```bash
./scripts/start-web.sh
# Or via npm:
npm run build && npm start
```

Open **`http://localhost:3456`** in any browser.

---

### Option B: Run as a Native Ubuntu Desktop App (Electron)

```bash
./scripts/start-desktop.sh
# Or via npm:
npm run desktop
```

To install **DroidBridge** into your Ubuntu Applications menu (`~/.local/share/applications/droidbridge.desktop`):

```bash
./scripts/install-desktop-entry.sh
```

---

### Option C: Live Development Mode (Hot Reload)

Run the Express ADB backend (`:3456`) and Vite HMR frontend (`:5173`) concurrently:

```bash
# Terminal 1: Start ADB Express backend on port 3456
npm run dev:server

# Terminal 2: Start Vite dev server on port 5173
npm run dev:client
```

---

## 📡 REST API Reference

DroidBridge exposes a clean JSON/multipart REST API on port `3456`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check returning server status, OS platform, and Ubuntu hostname |
| `GET` | `/api/devices` | Lists connected USB & Wi-Fi ADB devices with model, Android version, ABI, battery %, and storage volumes |
| `POST` | `/api/devices/connect` | Connects to a wireless Android device via `adb connect <ip>:<port>` |
| `POST` | `/api/devices/disconnect` | Disconnects an active wireless ADB session (`adb disconnect <address>`) |
| `GET` | `/api/devices/:serial/screenshot` | Streams a live PNG screen capture (`adb exec-out screencap -p`) |
| `GET` | `/api/local/list?path=...` | Lists entries, permissions, sizes, and quick bookmarks for an Ubuntu directory |
| `POST` | `/api/local/mkdir` | Creates a directory on the Ubuntu host |
| `POST` | `/api/local/rename` | Renames or moves a file/folder on the Ubuntu host |
| `POST` | `/api/local/delete` | Deletes selected files or directories on the Ubuntu host |
| `GET` | `/api/android/list?serial=...&path=...` | Lists entries, permissions, sizes, and volumes for an Android directory via `adb shell ls -la` |
| `POST` | `/api/android/mkdir` | Creates a directory on the Android device (`adb shell mkdir -p`) |
| `POST` | `/api/android/rename` | Renames or moves an entry on the Android device (`adb shell mv`) |
| `POST` | `/api/android/delete` | Deletes selected paths on the Android device (`adb shell rm -rf`) |
| `GET` | `/api/android/download?serial=...&path=...` | Pulls a remote Android file and streams it as a browser file download |
| `POST` | `/api/android/upload` | Uploads browser files via `multipart/form-data` and pushes them to the target Android folder |
| `POST` | `/api/transfer/push` | Transfers selected Ubuntu files/folders directly to the Android pane (`adb push`) |
| `POST` | `/api/transfer/pull` | Transfers selected Android files/folders directly to the Ubuntu pane (`adb pull`) |
| `POST` | `/api/android/install-apk` | Sideloads an `.apk` from an Ubuntu path or multipart upload (`adb install -r`) |
| `GET` | `/api/transfer/jobs` | Returns the 50 most recent `push`, `pull`, and `apk-install` transfer jobs |

---

## 🌟 Official Repositories & Mirrors

| Platform | Repository URL |
| :--- | :--- |
| **Forgejo (Primary)** | [`https://git.khoavo.myds.me/vndangkhoa/DroidBridge`](https://git.khoavo.myds.me/vndangkhoa/DroidBridge) |
| **GitLab (Mirror)** | [`https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge`](https://gitlab.khoavo.myds.me/vndangkhoa/DroidBridge) |

---

## 📄 License

Distributed under the **MIT License**.

Developed with ❤️ by **Khoa Vo ([@vndangkhoa](https://github.com/vndangkhoa))**.

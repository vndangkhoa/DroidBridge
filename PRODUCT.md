# PRODUCT.md — DroidBridge

## Overview
**DroidBridge** is a dual-mode (Web App + Ubuntu Native Desktop App) dual-pane file manager and device workstation that connects Ubuntu/Linux systems with Android devices (phones, tablets, and portable gaming handhelds like the TrimUI Smart Pro S) over USB or Wireless ADB.

## Core Capabilities
1. **Dual-Runtime Execution (2-in-1 App):**
   - **Web App Mode:** Served via local Express + Vite/React server (`http://localhost:3456`) accessible from any desktop or local browser.
   - **Ubuntu Desktop Mode:** Runs as a native Ubuntu desktop window via Electron (`npm run desktop` or `.desktop` launcher) with native Ubuntu file dialog integration and automatic background server lifecycle.
2. **Dual-Pane Commander Interface:**
   - **Left Pane — Ubuntu Host:** Browse local Linux directories (`$HOME`, `Downloads`, `Documents`, `Desktop`, `/media`, `/mnt`), inspect file sizes/permissions/timestamps, filter, sort, create/rename/delete folders, and push selected items directly to Android.
   - **Right Pane — Android Device (`adb`):** Browse `/sdcard`, `Download`, `DCIM`, `RetroArch`, and external microSD volumes (`/storage/XXXX-XXXX`), inspect sizes/permissions/timestamps, create/rename/delete folders, upload/download via browser, and pull selected items directly to Ubuntu.
3. **High-Speed ADB Transfer & Device Management:**
   - Direct `adb push` and `adb pull` transfers between panes with transfer queue tracking.
   - **External OS File & Folder Drag-and-Drop:** Drag files and recursive folders directly from Ubuntu Files, Windows Explorer, or macOS Finder into either the Local Host pane or Android/Linux pane (using zero-copy `webUtils.getPathForFile` in Electron Desktop Mode and recursive `webkitGetAsEntry` directory traversal in Web Mode), plus dedicated **Upload Files** and **Upload Folder** controls.
   - **Wi-Fi P2P File & Folder Sharing + Auto-Discovery:**
     - Instant **QR Code & HTTP P2P Share Portal** (`/p2p/s/:token`) to share any selected files or folders (with on-the-fly `.tar.gz` folder streaming and bi-directional browser dropzone uploads) with any phone, tablet, handheld, or PC over Wi-Fi without needing ADB or SSH.
     - **Zero-Config Peer Discovery** combining mDNS (`avahi-browse`), ARP neighbor scanning, and fast TCP port probing (`5555` ADB / `22` SSH) for 1-click wireless connection.
     - **Direct Wi-Fi P2P Hotspot** controller via NetworkManager (`nmcli`) for router-less peer-to-peer transfers.
   - One-click `.apk` sideloading from either the Ubuntu pane or browser file upload (`adb install -r`).
   - Wireless ADB & Linux SSH connection dialog (`adb connect <ip>:<port>` / `ssh://user@host:port`).
   - Live Android & Linux handheld (`DRM` / `fb0`) screen capture preview modal.

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
   - One-click `.apk` sideloading from either the Ubuntu pane or browser file upload (`adb install -r`).
   - Wireless ADB connection dialog (`adb connect <ip>:<port>`).
   - Live Android screen capture preview modal (`adb exec-out screencap -p`).

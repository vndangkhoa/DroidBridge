(() => {
  // 1. Copy Quick Start Command
  const copyCliBtn = document.getElementById('copy-cli-btn');
  if (copyCliBtn) {
    copyCliBtn.addEventListener('click', async () => {
      const cmd = 'git clone https://github.com/vndangkhoa/DroidBridge.git && cd DroidBridge && npm install && ./scripts/start-web.sh';
      try {
        await navigator.clipboard.writeText(cmd);
        const label = copyCliBtn.querySelector('.copy-label');
        if (label) {
          const prev = label.textContent;
          label.textContent = 'Copied';
          setTimeout(() => {
            label.textContent = prev;
          }, 1500);
        }
      } catch {
        // Ignore clipboard errors
      }
    });
  }

  // 2. Interactive Dual-Pane State (with Drag & Drop + P2P Share)
  const ubuntuFiles = [
    { name: 'psx_roms_pack', type: 'dir', size: '14 items', selected: true },
    { name: 'gba_collection', type: 'dir', size: '25 items', selected: true },
    { name: 'RetroArch_aarch64.apk', type: 'apk', size: '142.8 MB', selected: false },
    { name: 'saves_backup.tar.gz', type: 'file', size: '18.4 MB', selected: false }
  ];

  const DEVICE_PROFILES = {
    trimui: {
      title: 'ANDROID • TrimUI TG5050 (USB)',
      path: '/storage/3A1F-8B2E/roms',
      rate: '38.4 MB/s',
      files: [
        { name: 'bios', type: 'dir', size: '12 items', selected: false },
        { name: 'saves', type: 'dir', size: '34 items', selected: true },
        { name: 'retroarch.cfg', type: 'file', size: '38.1 KB', selected: false }
      ]
    },
    pixel: {
      title: 'ANDROID • Pixel 9 Pro (Wi-Fi ADB)',
      path: '/sdcard/DCIM/Camera',
      rate: '84.2 MB/s',
      files: [
        { name: 'PXL_4K60_HDR.mp4', type: 'file', size: '842.5 MB', selected: true },
        { name: 'RAW_Exports', type: 'dir', size: '22 items', selected: false },
        { name: 'Obtainium.apk', type: 'apk', size: '24.6 MB', selected: false }
      ]
    },
    ssh: {
      title: 'ANDROID • Termux SSH (:8022)',
      path: '/sdcard/Download/p2p-sync',
      rate: '62.0 MB/s',
      files: [
        { name: 'shared_project_folder', type: 'dir', size: '9 items', selected: true },
        { name: 'wireguard_node.conf', type: 'file', size: '1.4 KB', selected: false }
      ]
    }
  };

  let currentDeviceKey = 'trimui';
  let dragSource = null;

  function getIconSvg(type) {
    if (type === 'dir') {
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
    }
    if (type === 'apk') {
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
    }
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
  }

  function setStatus(text, activityText) {
    const toastEl = document.getElementById('wb-status-text');
    const actEl = document.getElementById('wb-last-activity');
    if (toastEl && text) toastEl.textContent = text;
    if (actEl && activityText) actEl.textContent = activityText;
  }

  function renderWorkbench() {
    const dev = DEVICE_PROFILES[currentDeviceKey];

    const androidTitleEl = document.getElementById('android-pane-title');
    const androidPathEl = document.getElementById('android-path-chip');
    if (androidTitleEl) androidTitleEl.textContent = dev.title;
    if (androidPathEl) androidPathEl.textContent = dev.path;

    const ubuntuTbody = document.getElementById('ubuntu-tbody');
    if (ubuntuTbody) {
      ubuntuTbody.innerHTML = ubuntuFiles
        .map(
          (f, idx) => `
        <tr class="${f.selected ? 'is-selected' : ''}" draggable="true" data-drag-pane="ubuntu" data-drag-idx="${idx}">
          <th scope="row">
            <label class="file-row-label">
              <input type="checkbox" class="file-checkbox" data-pane="ubuntu" data-idx="${idx}" ${
            f.selected ? 'checked' : ''
          } aria-label="Select ${f.name}" />
              ${getIconSvg(f.type)}
              <span>${f.name}</span>
            </label>
          </th>
          <td class="mono">${f.size}</td>
          <td>
            <button type="button" class="row-action-btn" data-p2p-item="${f.name}" data-p2p-source="Ubuntu Host">P2P Share</button>
          </td>
        </tr>`
        )
        .join('');
    }

    const androidTbody = document.getElementById('android-tbody');
    if (androidTbody) {
      androidTbody.innerHTML = dev.files
        .map(
          (f, idx) => `
        <tr class="${f.selected ? 'is-selected' : ''}" draggable="true" data-drag-pane="android" data-drag-idx="${idx}">
          <th scope="row">
            <label class="file-row-label">
              <input type="checkbox" class="file-checkbox" data-pane="android" data-idx="${idx}" ${
            f.selected ? 'checked' : ''
          } aria-label="Select ${f.name}" />
              ${getIconSvg(f.type)}
              <span>${f.name}</span>
            </label>
          </th>
          <td class="mono">${f.size}</td>
          <td>
            <button type="button" class="row-action-btn" data-p2p-item="${f.name}" data-p2p-source="${dev.title}">P2P Share</button>
          </td>
        </tr>`
        )
        .join('');
    }

    const uSel = ubuntuFiles.filter((f) => f.selected).length;
    const aSel = dev.files.filter((f) => f.selected).length;

    const pushCount = document.getElementById('push-count');
    const pullCount = document.getElementById('pull-count');
    const pushBtn = document.getElementById('wb-push-btn');
    const pullBtn = document.getElementById('wb-pull-btn');

    if (pushCount) pushCount.textContent = `${uSel} selected`;
    if (pullCount) pullCount.textContent = `${aSel} selected`;
    if (pushBtn) pushBtn.disabled = uSel === 0;
    if (pullBtn) pullBtn.disabled = aSel === 0;
  }

  function transferItems(fromPane, items) {
    const dev = DEVICE_PROFILES[currentDeviceKey];
    const targetList = fromPane === 'ubuntu' ? dev.files : ubuntuFiles;
    const names = [];

    items.forEach((item) => {
      names.push(item.name);
      if (!targetList.some((existing) => existing.name === item.name)) {
        targetList.unshift({
          name: item.name,
          type: item.type,
          size: item.size,
          selected: false
        });
      }
      item.selected = false;
    });

    renderWorkbench();
    const dirLabel = fromPane === 'ubuntu' ? `PUSH → ${dev.path}` : `PULL → /mnt/data/roms`;
    setStatus(
      `Transferred ${names.join(', ')} (${dev.rate})`,
      `COMPLETED • ${dirLabel} (${names.length} item${names.length > 1 ? 's' : ''})`
    );
  }

  // Push / Pull button clicks
  document.getElementById('wb-push-btn')?.addEventListener('click', () => {
    const selected = ubuntuFiles.filter((f) => f.selected);
    if (selected.length > 0) transferItems('ubuntu', selected);
  });

  document.getElementById('wb-pull-btn')?.addEventListener('click', () => {
    const dev = DEVICE_PROFILES[currentDeviceKey];
    const selected = dev.files.filter((f) => f.selected);
    if (selected.length > 0) transferItems('android', selected);
  });

  // Checkbox & Device Pill clicks
  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('file-checkbox')) return;
    const pane = target.getAttribute('data-pane');
    const idx = Number(target.getAttribute('data-idx'));
    if (pane === 'ubuntu' && ubuntuFiles[idx]) {
      ubuntuFiles[idx].selected = target.checked;
    } else if (pane === 'android') {
      const f = DEVICE_PROFILES[currentDeviceKey].files[idx];
      if (f) f.selected = target.checked;
    }
    renderWorkbench();
  });

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const devBtn = target.closest('[data-device-key]');
    if (devBtn) {
      const key = devBtn.getAttribute('data-device-key');
      if (key && DEVICE_PROFILES[key]) {
        currentDeviceKey = key;
        document.querySelectorAll('[data-device-key]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-device-key') === key);
        });
        renderWorkbench();
        setStatus(`Connected to ${DEVICE_PROFILES[key].title}`, `LINK ACTIVE • ${DEVICE_PROFILES[key].rate}`);
      }
      return;
    }

    const p2pBtn = target.closest('[data-p2p-item]');
    if (p2pBtn) {
      const itemName = p2pBtn.getAttribute('data-p2p-item') || 'psx_roms_pack';
      const sourceLabel = p2pBtn.getAttribute('data-p2p-source') || 'Ubuntu Host';
      openP2pDialog(itemName, sourceLabel);
    }
  });

  // 3. HTML5 Drag & Drop (Cross-Pane Rows + External OS File/Folder Drops)
  document.addEventListener('dragstart', (e) => {
    const row = e.target instanceof HTMLElement ? e.target.closest('tr[data-drag-pane]') : null;
    if (!row) return;
    const pane = row.getAttribute('data-drag-pane');
    const idx = Number(row.getAttribute('data-drag-idx'));
    dragSource = { pane, idx };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', `${pane}:${idx}`);
    }
  });

  document.querySelectorAll('.wb-pane').forEach((paneEl) => {
    paneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      paneEl.classList.add('drag-over');
    });

    paneEl.addEventListener('dragleave', () => {
      paneEl.classList.remove('drag-over');
    });

    paneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      paneEl.classList.remove('drag-over');
      const targetPane = paneEl.getAttribute('data-pane-drop');
      if (!targetPane) return;

      // Cross-pane row drop
      if (dragSource && dragSource.pane && dragSource.pane !== targetPane) {
        const sourceList =
          dragSource.pane === 'ubuntu' ? ubuntuFiles : DEVICE_PROFILES[currentDeviceKey].files;
        const draggedItem = sourceList[dragSource.idx];
        if (draggedItem) {
          transferItems(dragSource.pane, [draggedItem]);
        }
        dragSource = null;
        return;
      }

      // External OS file/folder drop
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const droppedFiles = Array.from(e.dataTransfer.files);
        const destList =
          targetPane === 'ubuntu' ? ubuntuFiles : DEVICE_PROFILES[currentDeviceKey].files;
        droppedFiles.forEach((f) => {
          destList.unshift({
            name: f.name,
            type: f.name.endsWith('.apk') ? 'apk' : 'file',
            size: `${Math.max(1, Math.round(f.size / 1024))} KB`,
            selected: false
          });
        });
        renderWorkbench();
        setStatus(
          `Dropped ${droppedFiles.length} OS item(s) into ${targetPane.toUpperCase()} pane`,
          `OS DROP • ${droppedFiles.map((f) => f.name).join(', ')}`
        );
      }
      dragSource = null;
    });
  });

  // 4. Native Light-Dismiss Dialogs + P2P Share Modal (modern-web-guidance: light-dismiss-a-dialog)
  const dialogs = document.querySelectorAll('dialog.wb-dialog');
  dialogs.forEach((dialog) => {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      });
    }
  });

  function openP2pDialog(itemName, sourceLabel) {
    const dlg = document.getElementById('dialog-p2p');
    const nameEl = document.getElementById('p2p-share-item-name');
    const urlInput = document.getElementById('p2p-share-url');
    const slug = itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (nameEl) nameEl.textContent = `${itemName} (${sourceLabel})`;
    if (urlInput instanceof HTMLInputElement) {
      urlInput.value = `http://10.42.0.1:3456/s/${slug || 'share'}`;
    }
    if (dlg instanceof HTMLDialogElement) dlg.showModal();
  }

  document.querySelectorAll('[data-open-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-dialog');
      if (id === 'dialog-p2p') {
        openP2pDialog('psx_roms_pack + gba_collection', 'Ubuntu Host');
        return;
      }
      const dlg = id ? document.getElementById(id) : null;
      if (dlg instanceof HTMLDialogElement) dlg.showModal();
    });
  });

  const copyP2pBtn = document.getElementById('copy-p2p-url-btn');
  if (copyP2pBtn) {
    copyP2pBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('p2p-share-url');
      const val = urlInput instanceof HTMLInputElement ? urlInput.value : '';
      try {
        await navigator.clipboard.writeText(val);
        copyP2pBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyP2pBtn.textContent = 'Copy Link';
        }, 1400);
      } catch {
        // Ignore
      }
    });
  }

  renderWorkbench();
})();

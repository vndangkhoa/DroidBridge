const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('droidBridgeDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectFiles: (filters) => ipcRenderer.invoke('dialog:selectFiles', filters),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});

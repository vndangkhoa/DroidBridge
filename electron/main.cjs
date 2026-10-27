const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// Ensure compatibility on Ubuntu systems where unprivileged user namespaces may be restricted
app.commandLine.appendSwitch('no-sandbox');

const PORT = Number(process.env.PORT || 3456);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const PROJECT_ROOT = path.resolve(__dirname, '..');

let mainWindow = null;
let backendProcess = null;

/**
 * Checks if the local Express backend is responding at /api/health
 */
function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Waits up to maxWaitMs for the backend server to become healthy
 */
async function waitForBackend(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ok = await checkBackendHealth();
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Ensures the DroidBridge backend server is running on 127.0.0.1:3456
 */
async function ensureBackendServer() {
  const alreadyRunning = await checkBackendHealth();
  if (alreadyRunning) {
    console.log(`[DroidBridge Desktop] Attached to existing backend server at ${HEALTH_URL}`);
    return;
  }

  console.log('[DroidBridge Desktop] Spawning local backend server (npx tsx server/index.ts)...');
  backendProcess = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[Backend] ${chunk}`);
  });

  backendProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[Backend] ${chunk}`);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[DroidBridge Desktop] Backend exited (code=${code}, signal=${signal})`);
    backendProcess = null;
  });

  const ready = await waitForBackend(10000);
  if (!ready) {
    console.warn('[DroidBridge Desktop] Backend did not respond within 10s; attempting to load window anyway.');
  }
}

/**
 * Registers IPC handlers for native Ubuntu desktop integration
 */
function registerIpcHandlers() {
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Ubuntu Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:selectFiles', async (_event, filters) => {
    const options = {
      title: 'Select Files from Ubuntu Host',
      properties: ['openFile', 'multiSelections'],
    };
    if (Array.isArray(filters) && filters.length > 0) {
      options.filters = filters;
    }
    const result = await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || !result.filePaths) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
}

async function createMainWindow() {
  await ensureBackendServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d1014',
    title: 'DroidBridge — Ubuntu ↔ Android File Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = process.env.VITE_DEV_SERVER_URL || `http://127.0.0.1:${PORT}`;
  await mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    console.log('[DroidBridge Desktop] Stopping spawned backend server...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
});

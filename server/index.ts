import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import type { TransferJob } from '../src/types';
import {
  captureScreenshot,
  connectWirelessDevice,
  deleteAndroid,
  disconnectDevice,
  installApkOnAndroid,
  listAndroidDirectory,
  listDevices,
  mkdirAndroid,
  pullFromAndroid,
  pushToAndroid,
  renameAndroid,
} from './adb';
import {
  calculateLocalTotalBytes,
  deleteLocal,
  listLocalDirectory,
  mkdirLocal,
  renameLocal,
} from './localFs';

const UPLOAD_BASE_DIR = '/tmp/droidbridge-uploads';
fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const batchDir = path.join(UPLOAD_BASE_DIR, crypto.randomUUID());
    fs.mkdirSync(batchDir, { recursive: true });
    cb(null, batchDir);
  },
  filename: (_req, file, cb) => {
    const safeName = path.basename(file.originalname || `upload-${Date.now()}`);
    cb(null, safeName);
  },
});

const upload = multer({ storage });

const transferJobs: TransferJob[] = [];

function createJob(
  direction: TransferJob['direction'],
  serial: string,
  sourcePaths: string[],
  targetPath: string,
  summary: string,
  totalBytes?: number
): TransferJob {
  const job: TransferJob = {
    id: crypto.randomUUID(),
    direction,
    serial,
    sourcePaths,
    targetPath,
    status: 'running',
    startedAt: Date.now(),
    totalBytes,
    summary,
  };
  transferJobs.unshift(job);
  if (transferJobs.length > 50) {
    transferJobs.length = 50;
  }
  return job;
}

export const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Health endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    platform: process.platform,
    hostname: os.hostname(),
  });
});

// Device management endpoints
app.get('/api/devices', async (_req: Request, res: Response) => {
  try {
    const devices = await listDevices();
    res.json({ devices });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, devices: [] });
  }
});

app.post('/api/devices/connect', async (req: Request, res: Response) => {
  try {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing device address' });
      return;
    }
    const result = await connectWirelessDevice(address);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message, error: message });
  }
});

app.post('/api/devices/disconnect', async (req: Request, res: Response) => {
  try {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing device address' });
      return;
    }
    const result = await disconnectDevice(address);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message, error: message });
  }
});

app.get('/api/devices/:serial/screenshot', async (req: Request, res: Response) => {
  try {
    const serial = String(req.params.serial || '').trim();
    if (!serial) {
      res.status(400).json({ error: 'Device serial is required' });
      return;
    }
    const pngBuffer = await captureScreenshot(serial);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pngBuffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Local Ubuntu filesystem endpoints
app.get('/api/local/list', async (req: Request, res: Response) => {
  try {
    const dirPath = typeof req.query.path === 'string' ? req.query.path : undefined;
    const listing = await listLocalDirectory(dirPath);
    res.json(listing);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/local/mkdir', async (req: Request, res: Response) => {
  try {
    const { path: targetPath } = req.body || {};
    if (!targetPath || typeof targetPath !== 'string') {
      res.status(400).json({ error: 'Path is required' });
      return;
    }
    await mkdirLocal(targetPath);
    res.json({ ok: true, path: targetPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/local/rename', async (req: Request, res: Response) => {
  try {
    const { oldPath, newPath } = req.body || {};
    if (!oldPath || !newPath) {
      res.status(400).json({ error: 'Both oldPath and newPath are required' });
      return;
    }
    await renameLocal(String(oldPath), String(newPath));
    res.json({ ok: true, oldPath, newPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/local/delete', async (req: Request, res: Response) => {
  try {
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: 'paths array is required' });
      return;
    }
    await deleteLocal(paths.map(String));
    res.json({ ok: true, deletedCount: paths.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Android ADB filesystem endpoints
app.get('/api/android/list', async (req: Request, res: Response) => {
  try {
    const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
    const dirPath = typeof req.query.path === 'string' ? req.query.path : '/sdcard';
    if (!serial) {
      res.status(400).json({ error: 'Device serial query parameter is required' });
      return;
    }
    const listing = await listAndroidDirectory(serial, dirPath);
    res.json(listing);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/android/mkdir', async (req: Request, res: Response) => {
  try {
    const { serial, path: targetPath } = req.body || {};
    if (!serial || !targetPath) {
      res.status(400).json({ error: 'Both serial and path are required' });
      return;
    }
    await mkdirAndroid(String(serial), String(targetPath));
    res.json({ ok: true, path: targetPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/android/rename', async (req: Request, res: Response) => {
  try {
    const { serial, oldPath, newPath } = req.body || {};
    if (!serial || !oldPath || !newPath) {
      res.status(400).json({ error: 'serial, oldPath, and newPath are required' });
      return;
    }
    await renameAndroid(String(serial), String(oldPath), String(newPath));
    res.json({ ok: true, oldPath, newPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/android/delete', async (req: Request, res: Response) => {
  try {
    const { serial, paths } = req.body || {};
    if (!serial || !Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: 'serial and non-empty paths array are required' });
      return;
    }
    await deleteAndroid(String(serial), paths.map(String));
    res.json({ ok: true, deletedCount: paths.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/android/download', async (req: Request, res: Response) => {
  const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
  const remotePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';

  if (!serial || !remotePath) {
    res.status(400).json({ error: 'serial and path query parameters are required' });
    return;
  }

  const tempDir = path.join(UPLOAD_BASE_DIR, `dl-${crypto.randomUUID()}`);
  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await pullFromAndroid(serial, [remotePath], tempDir);
    const basename = path.posix.basename(remotePath);
    const pulledFilePath = path.join(tempDir, basename);

    res.download(pulledFilePath, basename, async () => {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    });
  } catch (err: unknown) {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/android/upload', upload.any(), async (req: Request, res: Response) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || [];
  const serial = String(req.body?.serial || req.query?.serial || '').trim();
  const targetDir = String(req.body?.targetDir || req.body?.path || '/sdcard').trim();

  if (!serial || uploadedFiles.length === 0) {
    for (const f of uploadedFiles) {
      await fs.promises.rm(path.dirname(f.path), { recursive: true, force: true }).catch(() => {});
    }
    res.status(400).json({ error: 'serial and uploaded files are required' });
    return;
  }

  const localTempPaths = uploadedFiles.map((f) => f.path);
  const totalBytes = uploadedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const job = createJob(
    'push',
    serial,
    uploadedFiles.map((f) => f.originalname),
    targetDir,
    `Uploaded ${uploadedFiles.length} file(s) to ${targetDir}`,
    totalBytes
  );

  try {
    await pushToAndroid(serial, localTempPaths, targetDir);
    job.status = 'completed';
    job.completedAt = Date.now();
    res.json({ ok: true, job, ...job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = message;
    res.status(500).json({ error: message, job });
  } finally {
    for (const f of uploadedFiles) {
      await fs.promises.rm(path.dirname(f.path), { recursive: true, force: true }).catch(() => {});
    }
  }
});

// Dual-pane transfer endpoints
app.post('/api/transfer/push', async (req: Request, res: Response) => {
  const { serial, sourcePaths, targetDir, targetPath } = req.body || {};
  const destination = String(targetDir || targetPath || '/sdcard').trim();

  if (!serial || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    res.status(400).json({ error: 'serial and non-empty sourcePaths array are required' });
    return;
  }

  const cleanSources = sourcePaths.map(String);
  const totalBytes = await calculateLocalTotalBytes(cleanSources);
  const label =
    cleanSources.length === 1
      ? path.basename(cleanSources[0])
      : `${cleanSources.length} items`;

  const job = createJob(
    'push',
    String(serial),
    cleanSources,
    destination,
    `Push ${label} -> ${destination}`,
    totalBytes
  );

  try {
    await pushToAndroid(String(serial), cleanSources, destination);
    job.status = 'completed';
    job.completedAt = Date.now();
    res.json({ ok: true, job, ...job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = message;
    res.status(500).json({ error: message, job });
  }
});

app.post('/api/transfer/pull', async (req: Request, res: Response) => {
  const { serial, sourcePaths, targetDir, targetPath } = req.body || {};
  const destination = String(targetDir || targetPath || os.homedir()).trim();

  if (!serial || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    res.status(400).json({ error: 'serial and non-empty sourcePaths array are required' });
    return;
  }

  const cleanSources = sourcePaths.map(String);
  const label =
    cleanSources.length === 1
      ? path.posix.basename(cleanSources[0])
      : `${cleanSources.length} items`;

  const job = createJob(
    'pull',
    String(serial),
    cleanSources,
    destination,
    `Pull ${label} -> ${destination}`
  );

  try {
    await pullFromAndroid(String(serial), cleanSources, destination);
    job.status = 'completed';
    job.completedAt = Date.now();
    res.json({ ok: true, job, ...job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = message;
    res.status(500).json({ error: message, job });
  }
});

app.post('/api/android/install-apk', upload.any(), async (req: Request, res: Response) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || [];
  const serial = String(req.body?.serial || req.query?.serial || '').trim();
  const bodyApkPath = typeof req.body?.apkPath === 'string' ? req.body.apkPath.trim() : '';

  const uploadedApk = uploadedFiles[0];
  const targetApkPath = uploadedApk ? uploadedApk.path : bodyApkPath;
  const displayApkName = uploadedApk
    ? uploadedApk.originalname
    : path.basename(targetApkPath || 'app.apk');

  if (!serial || !targetApkPath) {
    for (const f of uploadedFiles) {
      await fs.promises.rm(path.dirname(f.path), { recursive: true, force: true }).catch(() => {});
    }
    res.status(400).json({ error: 'serial and apkPath (or uploaded APK file) are required' });
    return;
  }

  const job = createJob(
    'apk-install',
    serial,
    [targetApkPath],
    serial,
    `Install APK ${displayApkName}`
  );

  try {
    const output = await installApkOnAndroid(serial, targetApkPath);
    job.status = 'completed';
    job.completedAt = Date.now();
    res.json({ ok: true, output, job, ...job });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.completedAt = Date.now();
    job.error = message;
    res.status(500).json({ ok: false, error: message, job });
  } finally {
    for (const f of uploadedFiles) {
      await fs.promises.rm(path.dirname(f.path), { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.get('/api/transfer/jobs', (_req: Request, res: Response) => {
  res.json({ jobs: transferJobs.slice(0, 50) });
});

// Serve built frontend static assets if dist/index.html exists
const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '../dist');
const distIndexHtml = path.join(distDir, 'index.html');

if (fs.existsSync(distIndexHtml)) {
  app.use(express.static(distDir));
  app.use((req: Request, res: Response, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(distIndexHtml);
  });
}

let activeServer: Server | null = null;

export function startServer(port?: number): Promise<Server> {
  const listenPort = Number(port || process.env.PORT || 3456);
  return new Promise((resolve, reject) => {
    if (activeServer) {
      resolve(activeServer);
      return;
    }
    const server = app.listen(listenPort, '0.0.0.0', () => {
      activeServer = server;
      console.log(`[DroidBridge Server] Listening on http://localhost:${listenPort}`);
      resolve(server);
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
}

const isMainModule =
  typeof require !== 'undefined' && typeof module !== 'undefined'
    ? require.main === module
    : Boolean(process.argv[1]) && import.meta?.url
      ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
      : false;

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[DroidBridge Server] Failed to start:', err);
    process.exit(1);
  });
}

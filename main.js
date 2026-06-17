const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Model Pricing Defaults ──────────────────────────────────────────────
const MODEL_PRICING = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.8, output: 4 },
  'default': { input: 15, output: 75 }
};

// ── Paths ─────────────────────────────────────────────────────────────────
const BASE_PROJECTS_PATH = path.join(os.homedir(), '.claude', 'projects');

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0e0d',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Auto-update the active session every 2 seconds
  let activeFilePath = null;

  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const data = readActiveSessionData(activeFilePath);
      // Cache the active path if one was found
      if (data && data.file) activeFilePath = data.file;
      mainWindow.webContents.send('active-session-update', data);
    } catch (err) {
      console.error('Failed to push active session update:', err.message);
    }
  }, 2000);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadFileLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.split('\n').filter(line => line.trim() !== '');
  } catch (err) {
    console.error(`Failed to read file ${filePath}:`, err.message);
    return [];
  }
}

function parseJSONLLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractUsage(obj) {
  if (!obj || !obj.message || !obj.message.usage) {
    return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  }
  const u = obj.message.usage;
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0
  };
}

function extractTimestamp(obj) {
  if (!obj) return null;

  // Try root-level fields: timestamp, ts, createdAt — support both ISO strings and Unix ms numbers
  let raw = obj.timestamp || obj.ts || obj.createdAt
    || (obj.message && (obj.message.timestamp || obj.message.ts || obj.message.createdAt));

  if (!raw) return null;

  if (typeof raw === 'number') {
    // Unix milliseconds
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ISO string or other parseable string
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractModel(obj) {
  try {
    return obj.message.model || (obj.message.metadata && obj.message.metadata.model) || null;
  } catch {
    return null;
  }
}

// ── IPC: Read Projects ────────────────────────────────────────────────────
function readProjects() {
  const entries = safeReadDir(BASE_PROJECTS_PATH);
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

// ── IPC: Read Sessions ─────────────────────────────────────────────────────
function readAllSessions() {
  const projectNames = readProjects();
  const sessions = [];

  for (const projectName of projectNames) {
    const projectPath = path.join(BASE_PROJECTS_PATH, projectName);
    const files = safeReadDir(projectPath).filter(e => e.isFile() && e.name.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(projectPath, file.name);
      const lines = safeReadFileLines(filePath);
      if (lines.length === 0) continue;

      // Debug: log raw first line so we can see the actual format
      console.log(`[claudelens] First line of ${filePath}:`, lines[0].substring(0, 200));

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheTokens = 0;
      let model = null;
      let startTime = null;
      let endTime = null;

      for (let i = 0; i < lines.length; i++) {
        const obj = parseJSONLLine(lines[i]);
        if (!obj) continue;

        const usage = extractUsage(obj);
        inputTokens += usage.input_tokens;
        outputTokens += usage.output_tokens;
        cacheTokens += usage.cache_read_input_tokens;

        // First valid timestamp becomes startTime
        const ts = extractTimestamp(obj);
        if (ts) {
          if (!startTime) startTime = ts;
          endTime = ts;
        }

        if (!model) {
          model = extractModel(obj);
        }
      }

      const totalTokens = inputTokens + outputTokens + cacheTokens;
      if (totalTokens === 0) continue;

      const startDate = startTime ? new Date(startTime) : null;
      const endDate = endTime ? new Date(endTime) : null;
      let durationMinutes = 0;
      if (startDate && endDate) {
        durationMinutes = Math.round((endDate - startDate) / 60000);
      }

      sessions.push({
        id: `${projectName}::${file.name.replace('.jsonl', '')}`,
        project: projectName,
        file: file.name,
        startTime: startTime || '',
        endTime: endTime || '',
        durationMinutes,
        totalTokens,
        inputTokens,
        outputTokens,
        cacheTokens,
        model: model || 'unknown'
      });
    }
  }

  // Sort by startTime descending (newest first)
  sessions.sort((a, b) => {
    const tA = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tB = b.startTime ? new Date(b.startTime).getTime() : 0;
    return tB - tA;
  });

  return sessions;
}

// ── IPC: Read Active Session ───────────────────────────────────────────────
function readActiveSessionData(cachedFilePath) {
  // If we have a cached path, try that first
  if (cachedFilePath) {
    try {
      fs.accessSync(cachedFilePath);
    } catch {
      cachedFilePath = null;
    }
  }

  // Find the most recently modified .jsonl file across all projects
  if (!cachedFilePath) {
    let newestPath = null;
    let newestMtime = 0;

    const projectNames = readProjects();
    for (const projectName of projectNames) {
      const projectPath = path.join(BASE_PROJECTS_PATH, projectName);
      const files = safeReadDir(projectPath).filter(e => e.isFile() && e.name.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = path.join(projectPath, file.name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = filePath;
          }
        } catch (err) {
          console.error(`Failed to stat ${filePath}:`, err.message);
        }
      }
    }

    cachedFilePath = newestPath;
  }

  if (!cachedFilePath) {
    return { tokens: 0, startTime: null, model: 'unknown', file: null, active: false };
  }

  const lines = safeReadFileLines(cachedFilePath);
  if (lines.length === 0) {
    return { tokens: 0, startTime: null, model: 'unknown', file: cachedFilePath, active: false };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let model = null;
  let startTime = null;

  for (let i = 0; i < lines.length; i++) {
    const obj = parseJSONLLine(lines[i]);
    if (!obj) continue;

    const usage = extractUsage(obj);
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    cacheTokens += usage.cache_read_input_tokens;

    if (!startTime) {
      const ts = extractTimestamp(obj);
      if (ts) startTime = ts;
    }

    if (!model) {
      model = extractModel(obj);
    }
  }

  const totalTokens = inputTokens + outputTokens + cacheTokens;
  let derivedModel = model || 'default';
  // Check if the file was modified recently (within last 5 minutes) to consider it "active"
  let active = false;
  try {
    const stat = fs.statSync(cachedFilePath);
    active = (Date.now() - stat.mtimeMs) < 300000; // 5 minutes
  } catch {}

  return {
    tokens: totalTokens,
    inputTokens,
    outputTokens,
    cacheTokens,
    startTime: startTime || '',
    model: derivedModel,
    file: cachedFilePath,
    active
  };
}

// ── IPC Handlers ──────────────────────────────────────────────────────────
ipcMain.handle('read-projects', () => {
  try {
    return { success: true, data: readProjects() };
  } catch (err) {
    console.error('read-projects failed:', err);
    return { success: false, error: err.message, data: [] };
  }
});

ipcMain.handle('read-sessions', () => {
  try {
    const sessions = readAllSessions();
    return { success: true, data: sessions };
  } catch (err) {
    console.error('read-sessions failed:', err);
    return { success: false, error: err.message, data: [] };
  }
});

ipcMain.handle('read-active-session', () => {
  try {
    const data = readActiveSessionData(null);
    return { success: true, data };
  } catch (err) {
    console.error('read-active-session failed:', err);
    return { success: false, error: err.message, data: { tokens: 0, startTime: null, model: 'unknown', active: false } };
  }
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// ── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
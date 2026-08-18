const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const { createUpdater } = require('./updater');
const { deleteProjectFile } = require('./project-store');
const { writeAutosave, loadLatestAutosave, clearAutosaves } = require('./autosave-store');
const { proxyCacheKey, pruneProxyCache, clearProxyCache } = require('./preview-proxy');

// Bundled in bin/ (with its dylib deps rewritten to @executable_path/libs via
// dylibbundler) so the app runs on any Mac without needing Homebrew installed —
// __dirname is the project root in dev and Contents/Resources/app when packaged
// (no asar), so this path resolves correctly in both cases.
const FFMPEG = path.join(__dirname, 'bin', 'ffmpeg');
const FFPROBE = path.join(__dirname, 'bin', 'ffprobe');
const MOVE_CURSOR = path.join(__dirname, 'bin', 'move-cursor');

let mainWindow;
let currentExportProc = null;
let exportCancelled = false;
const waveformCache = new Map();
const recordingSessions = new Map();
const previewProxyJobs = new Map();
const activePreviewProxyProcs = new Set();
const activePreviewProxyPaths = new Set();
let previewProxyQueue = Promise.resolve();
let previewProxyEpoch = 0;

function cancelPreviewProxyEncodes() {
  previewProxyEpoch += 1;
  for (const child of activePreviewProxyProcs) {
    // VideoToolbox ffmpeg may outlive Electron after SIGTERM. These processes
    // write only disposable app-owned proxies, so force-stop them on quit.
    try { child.kill('SIGKILL'); } catch {}
  }
  activePreviewProxyProcs.clear();
}
const SURF_ANALYZER_HOST = '127.0.0.1';
const SURF_ANALYZER_PORT = 8000;
const SURF_ANALYZER_BACKEND = process.env.SURF_ANALYZER_BACKEND
  || '/Users/ishidanaoki/surfing-analyzer/backend';
let surfAnalyzerProc = null;
let surfAnalyzerStartPromise = null;

function emitSurfAnalyzerStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('surf-analyzer-status', status);
  return status;
}

function probeSurfAnalyzer(timeout = 1500) {
  return new Promise((resolve) => {
    const request = http.get({
      host: SURF_ANALYZER_HOST,
      port: SURF_ANALYZER_PORT,
      path: '/health',
      timeout,
    }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function readAnalyzerEnvironment() {
  const env = { ...process.env, MPLCONFIGDIR: path.join(app.getPath('temp'), 'naoki-matplotlib') };
  const envPath = path.join(SURF_ANALYZER_BACKEND, '.env');
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (match[1] === 'ANTHROPIC_API_KEY') env[match[1]] = value;
    }
  } catch {}
  return env;
}

async function startSurfAnalyzer({ restart = false } = {}) {
  if (surfAnalyzerStartPromise && !restart) return surfAnalyzerStartPromise;
  surfAnalyzerStartPromise = (async () => {
    if (await probeSurfAnalyzer()) return emitSurfAnalyzerStatus({ state: 'ready', managed: false });
    if (restart && surfAnalyzerProc) {
      surfAnalyzerProc.kill('SIGTERM');
      surfAnalyzerProc = null;
    }
    const executable = path.join(SURF_ANALYZER_BACKEND, 'venv', 'bin', 'uvicorn');
    const mainFile = path.join(SURF_ANALYZER_BACKEND, 'main.py');
    if (!fs.existsSync(executable) || !fs.existsSync(mainFile)) {
      return emitSurfAnalyzerStatus({ state: 'missing', message: 'フォーム解析AIがこのMacに見つかりません' });
    }
    emitSurfAnalyzerStatus({ state: 'starting', message: 'フォーム解析AIを準備中…' });
    surfAnalyzerProc = spawn(executable, [
      'main:app', '--app-dir', SURF_ANALYZER_BACKEND,
      '--host', SURF_ANALYZER_HOST, '--port', String(SURF_ANALYZER_PORT),
    ], {
      cwd: SURF_ANALYZER_BACKEND,
      env: readAnalyzerEnvironment(),
      stdio: 'ignore',
    });
    surfAnalyzerProc.once('exit', () => {
      surfAnalyzerProc = null;
      probeSurfAnalyzer().then((ready) => emitSurfAnalyzerStatus({
        state: ready ? 'ready' : 'stopped',
        message: ready ? '' : 'フォーム解析AIが停止しました',
      }));
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await probeSurfAnalyzer(500)) return emitSurfAnalyzerStatus({ state: 'ready', managed: true });
      if (!surfAnalyzerProc) break;
    }
    return emitSurfAnalyzerStatus({ state: 'error', message: 'フォーム解析AIを起動できませんでした' });
  })();
  try { return await surfAnalyzerStartPromise; }
  finally { surfAnalyzerStartPromise = null; }
}

function requestSurfAnalyzer(endpoint, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: SURF_ANALYZER_HOST,
      port: SURF_ANALYZER_PORT,
      path: endpoint,
      method,
      headers: { Accept: 'application/json' },
      timeout: 30 * 1000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = body ? JSON.parse(body) : {}; }
        catch { data = { detail: body || '解析アプリから不正な応答が返りました' }; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
        else reject(new Error(data.detail || `解析アプリのエラー (${response.statusCode})`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('解析アプリからの応答に時間がかかりすぎました。')));
    request.on('error', (error) => {
      if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'].includes(error.code)) {
        reject(new Error('解析アプリが起動していません。surfing-analyzerでuvicornを起動してください。'));
      } else {
        reject(error);
      }
    });
    request.end();
  });
}
const updater = createUpdater({ app, getMainWindow: () => mainWindow });

ipcMain.handle('check-for-update', () => updater.check());
ipcMain.handle('install-update', () => updater.install());

function postMultipartToSurfAnalyzer(endpoint, filePath, fields = {}) {
  if (typeof filePath !== 'string' || !filePath || !fs.existsSync(filePath)) {
    return Promise.reject(new Error('書き出した動画ファイルが見つかりません。もう一度書き出してください。'));
  }
  const boundary = `----NaokiCutter${crypto.randomUUID().replaceAll('-', '')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`
    ));
  }
  const safeName = path.basename(filePath).replace(/["\r\n]/g, '_');
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    'Content-Type: video/mp4\r\n\r\n'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const contentLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) +
    fileHeader.length + fs.statSync(filePath).size + footer.length;

  return new Promise((resolve, reject) => {
    const request = http.request({
      host: SURF_ANALYZER_HOST,
      port: SURF_ANALYZER_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
      },
      timeout: 10 * 60 * 1000,
    }, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(responseChunks).toString('utf8');
        let data;
        try { data = body ? JSON.parse(body) : {}; }
        catch { data = { detail: body || '解析アプリから不正な応答が返りました' }; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
        else reject(new Error(data.detail || `解析アプリのエラー (${response.statusCode})`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('解析に時間がかかりすぎたため中止しました。')));
    request.on('error', (error) => {
      if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'].includes(error.code)) {
        reject(new Error('解析アプリが起動していません。surfing-analyzerでuvicornを起動してください。'));
      } else {
        reject(error);
      }
    });
    chunks.forEach((chunk) => request.write(chunk));
    request.write(fileHeader);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => request.destroy(error));
    stream.on('end', () => request.end(footer));
    stream.pipe(request, { end: false });
  });
}

function postTwoVideosToSurfAnalyzer(endpoint, leftPath, rightPath, fields = {}) {
  for (const filePath of [leftPath, rightPath]) {
    if (!filePath || !fs.existsSync(filePath)) {
      return Promise.reject(new Error('AI同期用の一時動画を作成できませんでした。'));
    }
  }
  const boundary = `----NaokiCutterSync${crypto.randomUUID().replaceAll('-', '')}`;
  const fieldParts = Object.entries(fields).map(([name, value]) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`
  ));
  const files = [{ name: 'left', path: leftPath }, { name: 'right', path: rightPath }];
  const fileHeaders = files.map((file) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${path.basename(file.path)}"\r\n` +
    'Content-Type: video/mp4\r\n\r\n'
  ));
  const footer = Buffer.from(`--${boundary}--\r\n`);
  const contentLength = fieldParts.reduce((sum, part) => sum + part.length, 0)
    + files.reduce((sum, file, index) => sum + fileHeaders[index].length + fs.statSync(file.path).size + 2, 0)
    + footer.length;

  return new Promise((resolve, reject) => {
    const request = http.request({
      host: SURF_ANALYZER_HOST,
      port: SURF_ANALYZER_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
      },
      timeout: 10 * 60 * 1000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = body ? JSON.parse(body) : {}; }
        catch { data = { detail: body || '解析アプリから不正な応答が返りました' }; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data);
        else reject(new Error(data.detail || `解析アプリのエラー (${response.statusCode})`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('AI同期に時間がかかりすぎたため中止しました。')));
    request.on('error', (error) => {
      if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'].includes(error.code)) {
        reject(new Error('解析アプリが起動していません。surfing-analyzerでuvicornを起動してください。'));
      } else {
        reject(error);
      }
    });

    const writeStream = (stream) => new Promise((streamResolve, streamReject) => {
      stream.on('error', streamReject);
      stream.on('end', streamResolve);
      stream.pipe(request, { end: false });
    });
    (async () => {
      try {
        fieldParts.forEach((part) => request.write(part));
        for (let index = 0; index < files.length; index += 1) {
          request.write(fileHeaders[index]);
          await writeStream(fs.createReadStream(files[index].path));
          request.write('\r\n');
        }
        request.end(footer);
      } catch (error) {
        request.destroy(error);
      }
    })();
  });
}

function createSyncProxy(source, outputPath) {
  const trimStart = Math.max(0, Number(source.trimStart) || 0);
  const trimEnd = Math.max(trimStart, Number(source.trimEnd) || trimStart);
  const currentStart = Math.max(trimStart, Math.min(trimEnd, Number(source.start) || trimStart));
  const fullDuration = trimEnd - trimStart;
  const searchStart = fullDuration <= 60 ? trimStart : Math.max(trimStart, currentStart - 5);
  const searchEnd = fullDuration <= 60 ? trimEnd : Math.min(trimEnd, searchStart + 50);
  const duration = searchEnd - searchStart;
  if (duration < 1) throw new Error('AI同期する範囲が短すぎます。');
  const zoom = Math.max(1, Math.min(6, Number(source.zoom) || 1));
  const panX = Math.max(0, Math.min(1, Number(source.syncPanX) || 0.5));
  const panY = Math.max(0, Math.min(1, Number(source.syncPanY) || 0.5));
  const crop = zoom > 1.001
    ? `crop=w='iw/${zoom}':h='ih/${zoom}':x='clip(iw*${panX}-ow/2,0,iw-ow)':y='clip(ih*${panY}-oh/2,0,ih-oh)',`
    : '';
  const result = spawnSync(FFMPEG, [
    '-y', '-v', 'error', '-ss', String(searchStart), '-t', String(duration), '-i', source.path,
    '-an', '-vf', `${crop}fps=6,scale=640:-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 });
  if (result.error || result.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`AI同期用の動画を準備できませんでした。${String(result.stderr || '').slice(-500)}`);
  }
  return { searchStart, searchEnd, duration };
}

ipcMain.handle('auto-sync-comparison', async (event, payload) => {
  const allowedModes = new Set([
    'catch_start', 'takeoff_start', 'hands_down', 'standing', 'takeoff_end', 'bottom_turn', 'turn_start',
  ]);
  if (!payload?.left?.path || !payload?.right?.path || !allowedModes.has(payload.mode)) {
    throw new Error('AI同期の設定が正しくありません。');
  }
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-sync-'));
  const leftProxy = path.join(tempDir, 'left.mp4');
  const rightProxy = path.join(tempDir, 'right.mp4');
  try {
    const leftRange = createSyncProxy(payload.left, leftProxy);
    const rightRange = createSyncProxy(payload.right, rightProxy);
    const result = await postTwoVideosToSurfAnalyzer('/api/sync/takeoff', leftProxy, rightProxy, {
      mode: payload.mode,
    });
    if (!result.left?.detected || !result.right?.detected) {
      const details = [
        !result.left?.detected ? `左／上: ${result.left?.description || '検出できませんでした'}` : '',
        !result.right?.detected ? `右／下: ${result.right?.description || '検出できませんでした'}` : '',
      ].filter(Boolean).join('\n');
      throw new Error(`テイクオフを自動検出できませんでした。\n${details}`);
    }
    return {
      eventLabel: result.event_label,
      engine: result.engine,
      leftTime: leftRange.searchStart + Number(result.left.timestamp),
      rightTime: rightRange.searchStart + Number(result.right.timestamp),
      leftConfidence: Number(result.left.confidence) || 0,
      rightConfidence: Number(result.right.confidence) || 0,
      leftRange,
      rightRange,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createAutoCutProxy(sourcePath, start, duration, outputPath, view = null) {
  return new Promise((resolve, reject) => {
    const zoom = Math.max(1, Math.min(6, Number(view?.zoom) || 1));
    const rawPanX = Number(view?.panX);
    const rawPanY = Number(view?.panY);
    const panX = Math.max(0, Math.min(1, Number.isFinite(rawPanX) ? rawPanX : 0.5));
    const panY = Math.max(0, Math.min(1, Number.isFinite(rawPanY) ? rawPanY : 0.5));
    const crop = zoom > 1.001
      ? `crop=w='iw/${zoom}':h='ih/${zoom}':x='clip(iw*${panX}-ow/2,0,iw-ow)':y='clip(ih*${panY}-oh/2,0,ih-oh)',`
      : '';
    const args = [
      '-y', '-v', 'error', '-ss', String(start), '-t', String(duration), '-i', sourcePath,
      '-an', '-vf', `${crop}fps=5,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outputPath,
    ];
    const proc = spawn(FFMPEG, args);
    activePreviewProxyProcs.add(proc);
    let stderr = '';
    const timeout = setTimeout(() => proc.kill('SIGKILL'), 10 * 60 * 1000);
    proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    proc.on('error', (error) => {
      clearTimeout(timeout);
      activePreviewProxyProcs.delete(proc);
      reject(error);
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timeout);
      activePreviewProxyProcs.delete(proc);
      if (code !== 0 || !fs.existsSync(outputPath)) {
        reject(new Error(signal === 'SIGKILL'
          ? 'AI解析用動画の準備に時間がかかりすぎたため中止しました。'
          : `AI解析用動画を準備できませんでした。${stderr}`));
        return;
      }
      resolve();
    });
  });
}

ipcMain.handle('detect-auto-cut-segments', async (event, payload) => {
  const allowedModes = new Set(['takeoff', 'riding']);
  if (!payload?.path || !fs.existsSync(payload.path)) throw new Error('解析する元動画が見つかりません。');
  if (!allowedModes.has(payload.mode)) throw new Error('AI自動カットの種類が正しくありません。');
  const trimStart = Math.max(0, Number(payload.trimStart) || 0);
  const trimEnd = Math.max(trimStart, Number(payload.trimEnd) || trimStart);
  if (trimEnd - trimStart < 1) throw new Error('AI自動カットするクリップが短すぎます。');

  // Long camera files are analyzed in bounded, overlapping chunks. This keeps
  // proxy size and backend memory stable while still allowing one source file
  // to contain any number of takeoffs. The overlap prevents an event on a
  // chunk boundary from being cut in half; renderer-side normalization merges
  // the duplicate candidate afterward.
  const CHUNK_SECONDS = 300;
  const OVERLAP_SECONDS = 8;
  const step = CHUNK_SECONDS - OVERLAP_SECONDS;
  const chunkStarts = [];
  for (let start = trimStart; start < trimEnd - 0.1; start += step) chunkStarts.push(start);
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-auto-cut-'));
  const segments = [];
  const detectionStatuses = new Set();
  let engine = 'ローカル姿勢・動きAI（MediaPipe Pose）';
  let verifiedExampleCount = 0;
  try {
    for (let index = 0; index < chunkStarts.length; index += 1) {
      const chunkStart = chunkStarts[index];
      const chunkEnd = Math.min(trimEnd, chunkStart + CHUNK_SECONDS);
      const proxyPath = path.join(tempDir, `chunk-${index}.mp4`);
      mainWindow?.webContents.send('auto-cut-progress', {
        phase: 'proxy', current: index + 1, total: chunkStarts.length,
      });
      await createAutoCutProxy(payload.path, chunkStart, chunkEnd - chunkStart, proxyPath, payload.view);
      mainWindow?.webContents.send('auto-cut-progress', {
        phase: 'analyze', current: index + 1, total: chunkStarts.length,
      });
      const result = await postMultipartToSurfAnalyzer('/api/segments/local', proxyPath, {
        mode: payload.mode,
        source_name: path.basename(payload.path),
      });
      engine = result.engine || engine;
      verifiedExampleCount = Math.max(verifiedExampleCount, Number(result.verified_example_count) || 0);
      if (result.detection_status) detectionStatuses.add(result.detection_status);
      for (const segment of Array.isArray(result.segments) ? result.segments : []) {
        const addOffset = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
          ? chunkStart + Number(value) : null;
        const start = addOffset(segment.start);
        const end = addOffset(segment.end);
        if (start === null || end === null) continue;
        segments.push({
          ...segment,
          start,
          end,
          takeoff_start: addOffset(segment.takeoff_start),
          takeoff_end: addOffset(segment.takeoff_end),
        });
      }
      fs.rmSync(proxyPath, { force: true });
    }
    return {
      mode: payload.mode,
      segments,
      analyzed_start: trimStart,
      analyzed_end: trimEnd,
      chunk_count: chunkStarts.length,
      engine,
      verified_example_count: verifiedExampleCount,
      detection_status: segments.length
        ? 'detected'
        : (detectionStatuses.has('needs_training') ? 'needs_training' : [...detectionStatuses][0] || 'not_detected'),
      privacy: 'local_only',
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function trainingDataDir() {
  return path.join(app.getPath('userData'), 'ai-training');
}

function trainingDataPath() {
  return path.join(trainingDataDir(), 'surfing-event-labels.json');
}

function analysisHistoryPath() {
  return path.join(app.getPath('userData'), 'analysis-history.json');
}

function readAnalysisHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(analysisHistoryPath(), 'utf8'));
    return Array.isArray(data.records) ? data.records : [];
  } catch { return []; }
}

function writeAnalysisHistory(records) {
  const target = analysisHistoryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, records: records.slice(-500) }, null, 2));
  fs.renameSync(temporary, target);
}

function referenceTagsPath() {
  return path.join(app.getPath('userData'), 'reference-tags.json');
}

function readReferenceTags() {
  try {
    const data = JSON.parse(fs.readFileSync(referenceTagsPath(), 'utf8'));
    return data && typeof data.tags === 'object' ? data.tags : {};
  } catch { return {}; }
}

function writeReferenceTags(tags) {
  const target = referenceTagsPath();
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, tags }, null, 2));
  fs.renameSync(temporary, target);
}

function emptyTrainingData() {
  return {
    schema_version: 3,
    updated_at: new Date().toISOString(),
    privacy: {
      stores_video: false,
      local_only: true,
      description: '元動画は保存せず、ユーザーが確認した時刻と動作ラベルだけを保存する',
    },
    definitions: {
      travel_paddle: '沖へ移動するための通常のパドル',
      preparation: '波待ちから回ってパドルに入るまでの準備動作',
      catch_timing: '波をつかむキャッチの瞬間',
      catch_paddle: '波をつかんでテイクオフへ入る直前の強いパドル',
      paddle_form: 'パドル動作の形とフォーム',
      hands_down_timing: '手をボードについた瞬間',
      takeoff_start_hands_down: '手をボードについてテイクオフ動作を開始した瞬間',
      takeoff_end_hands_release: '手がボードから離れてテイクオフ動作が終了した瞬間',
      takeoff_posture: 'テイクオフの形・足の出し方・種類',
      riding: 'テイクオフ後からライディング終了までの動作',
      turn: 'ライディング中のターン区間と動作名',
    },
    examples: [],
  };
}

function readTrainingData() {
  fs.mkdirSync(trainingDataDir(), { recursive: true });
  const filePath = trainingDataPath();
  if (!fs.existsSync(filePath)) {
    const initial = emptyTrainingData();
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || !Array.isArray(data.examples)) throw new Error('examples missing');
    let migrated = false;
    const examples = data.examples.map((original) => {
      const example = { ...original };
      if (!example.id) {
        example.id = crypto.randomUUID();
        migrated = true;
      }
      if (!Array.isArray(example.event_instances)) {
        example.event_instances = (example.segments || []).map((segment) => {
          const features = example.segment_features?.[segment.event]
            || (segment.event === 'takeoff' ? example.motion_features : null);
          return {
            id: crypto.randomUUID(),
            event: segment.event,
            start_seconds: segment.start_seconds,
            end_seconds: segment.end_seconds,
            features: features || null,
            verified_by_user: true,
            migrated_from_legacy: true,
          };
        });
        migrated = true;
      }
      return example;
    });
    const defaults = emptyTrainingData();
    const normalized = {
      ...defaults,
      ...data,
      schema_version: 3,
      definitions: { ...defaults.definitions, ...(data.definitions || {}) },
      examples,
    };
    if (migrated || data.schema_version !== 3) writeTrainingData(normalized);
    return normalized;
  } catch {
    throw new Error('AI学習データが壊れています。ファイルを確認してください。');
  }
}

function writeTrainingData(data) {
  data.updated_at = new Date().toISOString();
  fs.mkdirSync(trainingDataDir(), { recursive: true });
  const filePath = trainingDataPath();
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function safeTrainingTime(value, duration, label) {
  if (value === '' || value === null || value === undefined) {
    throw new Error(`${label}の時刻を入力してください。`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > duration) {
    throw new Error(`${label}の時刻が正しくありません。`);
  }
  return Math.round(number * 1000) / 1000;
}

function safeTrainingText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function createTrainingFeatureProxy(sourcePath, start, end, outputPath, view = null) {
  const duration = end - start;
  if (duration < 0.2) throw new Error('学習する動作区間が短すぎます。');
  const zoom = Math.max(1, Math.min(6, Number(view?.zoom) || 1));
  const rawPanX = Number(view?.panX);
  const rawPanY = Number(view?.panY);
  const panX = Math.max(0, Math.min(1, Number.isFinite(rawPanX) ? rawPanX : 0.5));
  const panY = Math.max(0, Math.min(1, Number.isFinite(rawPanY) ? rawPanY : 0.5));
  const crop = zoom > 1.001
    ? `crop=w='iw/${zoom}':h='ih/${zoom}':x='clip(iw*${panX}-ow/2,0,iw-ow)':y='clip(ih*${panY}-oh/2,0,ih-oh)',`
    : '';
  const result = spawnSync(FFMPEG, [
    '-y', '-v', 'error', '-ss', String(start), '-t', String(duration), '-i', sourcePath,
    '-an', '-vf', `${crop}fps=8,scale=640:-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`動作特徴用の動画を準備できませんでした: ${result.stderr || 'ffmpeg error'}`);
  }
}

ipcMain.handle('list-training-data', async () => readTrainingData());

ipcMain.handle('save-training-example', async (event, payload) => {
  if (!payload?.sourcePath || !fs.existsSync(payload.sourcePath)) {
    throw new Error('学習元の動画が見つかりません。');
  }
  const duration = Number(payload.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さが正しくありません。');
  const learningTitle = safeTrainingText(payload.learningTitle, 80);
  if (!learningTitle) throw new Error('学習する題名を入力してください。');
  const hasCatch = payload.catchStart !== '' && payload.catchStart !== null && payload.catchStart !== undefined;
  const catchStart = hasCatch ? safeTrainingTime(payload.catchStart, duration, 'キャッチ開始') : null;
  const takeoffStart = safeTrainingTime(payload.takeoffStart, duration, 'テイクオフ開始');
  const takeoffEnd = safeTrainingTime(payload.takeoffEnd, duration, 'テイクオフ終了');
  if (!(takeoffStart < takeoffEnd) || (hasCatch && catchStart > takeoffStart)) {
    throw new Error(hasCatch
      ? '時刻は「キャッチ開始 ≤ テイクオフ開始 < テイクオフ終了」の順にしてください。'
      : 'テイクオフ開始は終了より前にしてください。');
  }
  const stat = fs.statSync(payload.sourcePath);
  const identity = crypto.createHash('sha256')
    .update(`${path.resolve(payload.sourcePath)}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex').slice(0, 24);
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-training-features-'));
  const proxyPath = path.join(tempDir, 'takeoff.mp4');
  let motionFeatures;
  try {
    createTrainingFeatureProxy(payload.sourcePath, takeoffStart, takeoffEnd, proxyPath);
    motionFeatures = await postMultipartToSurfAnalyzer('/api/training/features', proxyPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const data = readTrainingData();
  const segments = [];
  if (hasCatch) {
    segments.push(
      { event: 'travel_paddle', start_seconds: 0, end_seconds: catchStart },
      { event: 'catch_paddle', start_seconds: catchStart, end_seconds: takeoffStart },
    );
  }
  segments.push({ event: 'takeoff', learning_title: learningTitle, start_seconds: takeoffStart, end_seconds: takeoffEnd });
  const formTakeoffInstanceId = crypto.randomUUID();
  const example = {
    id: payload.id && /^[a-zA-Z0-9-]+$/.test(payload.id) ? payload.id : crypto.randomUUID(),
    source_name: path.basename(payload.sourcePath),
    source_identity: identity,
    source_path: path.resolve(payload.sourcePath),
    duration_seconds: Math.round(duration * 1000) / 1000,
    segments,
    labels: [
      { event: 'takeoff_start_hands_down', time_seconds: takeoffStart, instance_id: formTakeoffInstanceId },
      { event: 'takeoff_end_hands_release', time_seconds: takeoffEnd, instance_id: formTakeoffInstanceId },
    ],
    verified_by_user: true,
    motion_features: motionFeatures,
    segment_features: { takeoff: motionFeatures },
    event_instances: [{
      id: formTakeoffInstanceId,
      event: 'takeoff',
      learning_title: learningTitle,
      start_seconds: takeoffStart,
      end_seconds: takeoffEnd,
      features: motionFeatures,
      verified_by_user: true,
      updated_at: new Date().toISOString(),
    }],
    metrics: {
      takeoff_duration_seconds: Math.round((takeoffEnd - takeoffStart) * 1000) / 1000,
    },
    updated_at: new Date().toISOString(),
  };
  const existingIndex = data.examples.findIndex((item) => item.id === example.id
    || item.source_identity === identity
    || (!item.source_identity && item.source_name === example.source_name));
  if (existingIndex >= 0) {
    const existing = data.examples[existingIndex];
    if (existing.id) example.id = existing.id;
    const matchingTakeoff = (existing.event_instances || []).find((instance) =>
      instance.event === 'takeoff'
      && (instance.learning_title || 'テイクオフ') === learningTitle
      && Math.abs(Number(instance.start_seconds) - takeoffStart) < 0.05
      && Math.abs(Number(instance.end_seconds) - takeoffEnd) < 0.05
    );
    if (matchingTakeoff) example.event_instances[0].id = matchingTakeoff.id;
    example.event_instances = [
      ...(existing.event_instances || []).filter((instance) => instance.id !== example.event_instances[0].id),
      example.event_instances[0],
    ];
    example.segments = [
      ...(existing.segments || []).filter((segment) => {
        if (['travel_paddle', 'catch_paddle'].includes(segment.event)) return false;
        return !(segment.event === 'takeoff'
          && Math.abs(Number(segment.start_seconds) - takeoffStart) < 0.05
          && Math.abs(Number(segment.end_seconds) - takeoffEnd) < 0.05);
      }),
      ...segments,
    ].sort((a, b) => a.start_seconds - b.start_seconds);
    example.labels = [
      ...(existing.labels || []).filter((label) => !(
        ['takeoff_start_hands_down', 'takeoff_end_hands_release'].includes(label.event)
        && (Math.abs(Number(label.time_seconds) - takeoffStart) < 0.05
          || Math.abs(Number(label.time_seconds) - takeoffEnd) < 0.05)
      )),
      ...example.labels.map((label) => ({ ...label, instance_id: example.event_instances[0].id })),
    ];
    example.annotations = { ...(existing.annotations || {}) };
    example.segment_features = { ...(existing.segment_features || {}), takeoff: motionFeatures };
    example.metrics = { ...(existing.metrics || {}), ...example.metrics };
    example.learning_sets = { ...(existing.learning_sets || {}) };
  }
  example.learning_sets = { ...(example.learning_sets || {}) };
  const titleSet = Array.isArray(example.learning_sets[learningTitle]) ? example.learning_sets[learningTitle] : [];
  example.learning_sets[learningTitle] = [
    ...titleSet.filter((item) => item.id !== example.event_instances[0].id),
    example.event_instances[0],
  ];
  if (existingIndex >= 0) data.examples[existingIndex] = example;
  else data.examples.push(example);
  writeTrainingData(data);
  return example;
});

ipcMain.handle('save-training-segment', async (event, payload) => {
  const eventConfigs = {
    preparation: { name: '準備（波待ちからパドル開始まで）', mode: 'interval' },
    catch_timing: { name: 'キャッチのタイミング', mode: 'point' },
    catch_paddle: { name: 'キャッチのパドル', mode: 'interval' },
    paddle_form: { name: 'パドルの形', mode: 'interval' },
    hands_down_timing: { name: '手をつくタイミング', mode: 'point' },
    takeoff: { name: 'テイクオフ動作', mode: 'interval' },
    takeoff_posture: { name: 'テイクオフの姿勢', mode: 'interval' },
    riding: { name: 'ライディング', mode: 'interval' },
    turn: { name: 'ターン・動作', mode: 'interval' },
  };
  if (!payload?.sourcePath || !fs.existsSync(payload.sourcePath)) {
    throw new Error('学習元の動画が見つかりません。');
  }
  const config = eventConfigs[payload.event];
  if (!config) throw new Error('学習する動作が正しくありません。');
  const learningTitle = safeTrainingText(payload.learningTitle, 80);
  if (!learningTitle) throw new Error('学習する題名を入力してください。');
  const duration = Number(payload.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さが正しくありません。');
  const start = safeTrainingTime(payload.start, duration, '学習区間の開始');
  const end = config.mode === 'point'
    ? start
    : safeTrainingTime(payload.end, duration, '学習区間の終了');
  if (config.mode === 'interval' && end - start < 0.2) {
    throw new Error('学習区間は開始より後に終了を設定し、0.2秒以上にしてください。');
  }
  const paddleForm = safeTrainingText(payload.details?.paddleForm);
  const takeoffShape = safeTrainingText(payload.details?.takeoffShape, 120);
  const takeoffFootwork = safeTrainingText(payload.details?.takeoffFootwork, 120);
  const takeoffType = safeTrainingText(payload.details?.takeoffType, 120);
  const movementName = safeTrainingText(payload.details?.movementName, 120);
  if (payload.event === 'paddle_form' && !paddleForm) {
    throw new Error('パドルの形を入力してください。');
  }
  if (payload.event === 'takeoff_posture' && !takeoffShape && !takeoffFootwork && !takeoffType) {
    throw new Error('テイクオフの形・足の出し方・種類のいずれかを入力してください。');
  }
  if (payload.event === 'turn' && !movementName) {
    throw new Error('ターン・動作名を入力してください。');
  }

  let featureStart = start;
  let featureEnd = end;
  if (config.mode === 'point') {
    featureStart = Math.max(0, start - 0.75);
    featureEnd = Math.min(duration, start + 0.75);
    if (featureEnd - featureStart < 0.2) {
      featureStart = Math.max(0, Math.min(start, duration - 0.2));
      featureEnd = Math.min(duration, featureStart + 0.2);
    }
  }

  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-training-segment-'));
  const proxyPath = path.join(tempDir, `${payload.event}.mp4`);
  let features;
  try {
    createTrainingFeatureProxy(payload.sourcePath, featureStart, featureEnd, proxyPath, payload.view);
    features = await postMultipartToSurfAnalyzer('/api/training/features', proxyPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const stat = fs.statSync(payload.sourcePath);
  const identity = crypto.createHash('sha256')
    .update(`${path.resolve(payload.sourcePath)}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex').slice(0, 24);
  const data = readTrainingData();
  let example = data.examples.find((item) => item.source_identity === identity)
    || data.examples.find((item) => !item.source_identity && item.source_name === path.basename(payload.sourcePath));
  if (!example) {
    example = {
      id: crypto.randomUUID(),
      source_name: path.basename(payload.sourcePath),
      source_identity: identity,
      source_path: path.resolve(payload.sourcePath),
      duration_seconds: Math.round(duration * 1000) / 1000,
      segments: [],
      labels: [],
      verified_by_user: true,
      updated_at: new Date().toISOString(),
    };
    data.examples.push(example);
  }
  example.source_identity = identity;
  example.source_path = path.resolve(payload.sourcePath);
  example.duration_seconds = Math.round(duration * 1000) / 1000;
  example.event_instances = Array.isArray(example.event_instances) ? example.event_instances : [];
  const matchingInstanceIndex = example.event_instances.findIndex((instance) =>
    instance.event === payload.event
    && (instance.learning_title || config.name) === learningTitle
    && Math.abs(Number(instance.start_seconds) - start) < 0.05
    && Math.abs(Number(instance.end_seconds) - end) < 0.05
  );
  const instanceId = matchingInstanceIndex >= 0
    ? example.event_instances[matchingInstanceIndex].id
    : crypto.randomUUID();
  const instance = {
    id: instanceId,
    event: payload.event,
    learning_title: learningTitle,
    start_seconds: start,
    end_seconds: end,
    features,
    details: {
      paddle_form: paddleForm,
      takeoff_shape: takeoffShape,
      takeoff_footwork: takeoffFootwork,
      takeoff_type: takeoffType,
      movement_name: movementName,
      training_zoom: Math.max(1, Number(payload.view?.zoom) || 1),
    },
    verified_by_user: true,
    updated_at: new Date().toISOString(),
  };
  if (matchingInstanceIndex >= 0) example.event_instances[matchingInstanceIndex] = instance;
  else example.event_instances.push(instance);
  if (config.mode === 'interval') {
    example.segments = (example.segments || []).filter((segment) => !(
      segment.event === payload.event
      && Math.abs(Number(segment.start_seconds) - start) < 0.05
      && Math.abs(Number(segment.end_seconds) - end) < 0.05
    ));
    example.segments.push({ id: instanceId, event: payload.event, learning_title: learningTitle, start_seconds: start, end_seconds: end });
    if (payload.event === 'catch_paddle') {
      const travel = example.segments.find((segment) => segment.event === 'travel_paddle');
      if (travel && travel.start_seconds <= start) travel.end_seconds = start;
    }
    example.segments.sort((a, b) => a.start_seconds - b.start_seconds);
  }
  example.segment_features = { ...(example.segment_features || {}), [payload.event]: features };
  example.learning_sets = { ...(example.learning_sets || {}) };
  const titleSet = Array.isArray(example.learning_sets[learningTitle]) ? example.learning_sets[learningTitle] : [];
  example.learning_sets[learningTitle] = [
    ...titleSet.filter((item) => item.id !== instanceId),
    instance,
  ];
  if (payload.event === 'takeoff') {
    example.motion_features = features;
    example.labels = (example.labels || []).filter((label) => label.instance_id !== instanceId && !(
      ['takeoff_start_hands_down', 'takeoff_end_hands_release'].includes(label.event)
      && (Math.abs(Number(label.time_seconds) - start) < 0.05 || Math.abs(Number(label.time_seconds) - end) < 0.05)
    ));
    example.labels.push(
      { event: 'takeoff_start_hands_down', time_seconds: start, instance_id: instanceId },
      { event: 'takeoff_end_hands_release', time_seconds: end, instance_id: instanceId },
    );
  } else if (config.mode === 'point') {
    example.labels = (example.labels || []).filter((label) => label.instance_id !== instanceId);
    example.labels.push({ event: payload.event, time_seconds: start, instance_id: instanceId });
  } else {
    const startLabel = `${payload.event}_start`;
    const endLabel = `${payload.event}_end`;
    example.labels = (example.labels || []).filter((label) => label.instance_id !== instanceId);
    example.labels.push(
      { event: startLabel, time_seconds: start, instance_id: instanceId },
      { event: endLabel, time_seconds: end, instance_id: instanceId },
    );
  }
  example.metrics = { ...(example.metrics || {}) };
  if (payload.event === 'takeoff') {
    example.metrics.takeoff_duration_seconds = Math.round((end - start) * 1000) / 1000;
    example.metrics.takeoff_example_count = example.event_instances.filter((item) => item.event === 'takeoff').length;
  }
  if (payload.event === 'preparation') {
    example.metrics.preparation_duration_seconds = Math.round((end - start) * 1000) / 1000;
  }
  if (payload.event === 'riding') {
    example.metrics.riding_example_count = example.event_instances.filter((item) => item.event === 'riding').length;
  }
  if (payload.event === 'turn') {
    example.metrics.turn_example_count = example.event_instances.filter((item) => item.event === 'turn').length;
  }
  example.annotations = { ...(example.annotations || {}) };
  if (payload.event === 'paddle_form') {
    example.annotations.paddle_form = { description: paddleForm };
  }
  if (payload.event === 'takeoff_posture') {
    example.annotations.takeoff_posture = {
      shape: takeoffShape,
      footwork: takeoffFootwork,
      type: takeoffType,
    };
  }
  example.verified_by_user = true;
  example.updated_at = new Date().toISOString();
  writeTrainingData(data);
  return {
    example,
    event_name: config.name,
    learning_title: learningTitle,
    mode: config.mode,
    feature_samples: features.sample_count || 0,
    instance_count: example.event_instances.filter((item) => item.event === payload.event).length,
    instance_id: instanceId,
  };
});

ipcMain.handle('save-training-feedback', async (event, payload) => {
  if (!payload?.sourcePath || !fs.existsSync(payload.sourcePath)) throw new Error('学習元の動画が見つかりません。');
  if (payload.accepted !== false) throw new Error('誤検出フィードバックの内容が正しくありません。');
  const duration = Number(payload.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さが正しくありません。');
  const learningTitle = safeTrainingText(payload.learningTitle, 80);
  if (!learningTitle) throw new Error('学習する題名を入力してください。');
  const start = safeTrainingTime(payload.start, duration, '候補の開始');
  const end = safeTrainingTime(payload.end, duration, '候補の終了');
  if (end - start < 0.2) throw new Error('候補区間は0.2秒以上にしてください。');
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-negative-training-'));
  const proxyPath = path.join(tempDir, 'negative.mp4');
  let features;
  try {
    createTrainingFeatureProxy(payload.sourcePath, start, end, proxyPath, payload.view);
    features = await postMultipartToSurfAnalyzer('/api/training/features', proxyPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const stat = fs.statSync(payload.sourcePath);
  const identity = crypto.createHash('sha256')
    .update(`${path.resolve(payload.sourcePath)}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex').slice(0, 24);
  const data = readTrainingData();
  let example = data.examples.find((item) => item.source_identity === identity);
  if (!example) {
    example = {
      id: crypto.randomUUID(), source_name: path.basename(payload.sourcePath),
      source_identity: identity, source_path: path.resolve(payload.sourcePath),
      duration_seconds: Math.round(duration * 1000) / 1000,
      segments: [], labels: [], event_instances: [], verified_by_user: true,
    };
    data.examples.push(example);
  }
  const feedback = {
    id: crypto.randomUUID(), event: String(payload.event || 'movement'),
    learning_title: learningTitle, start_seconds: start, end_seconds: end,
    accepted: false, features, verified_by_user: true, updated_at: new Date().toISOString(),
  };
  example.negative_learning_sets = { ...(example.negative_learning_sets || {}) };
  const negatives = Array.isArray(example.negative_learning_sets[learningTitle])
    ? example.negative_learning_sets[learningTitle] : [];
  example.negative_learning_sets[learningTitle] = [...negatives, feedback].slice(-100);
  example.updated_at = new Date().toISOString();
  writeTrainingData(data);
  return { learning_title: learningTitle, feedback_samples: features.sample_count || 0 };
});

ipcMain.handle('delete-training-example', async (event, id) => {
  const data = readTrainingData();
  const before = data.examples.length;
  data.examples = data.examples.filter((example) => example.id !== id);
  if (data.examples.length !== before) writeTrainingData(data);
  return { deleted: before - data.examples.length };
});

ipcMain.handle('list-analysis-history', () => ({ records: readAnalysisHistory() }));

ipcMain.handle('save-analysis-history', (event, payload) => {
  const studentName = String(payload?.studentName || '').trim().slice(0, 80);
  if (!studentName) throw new Error('生徒名を入力してください。');
  const record = {
    id: crypto.randomUUID(),
    student_name: studentName,
    source_name: path.basename(String(payload?.sourcePath || '動画')),
    source_path: String(payload?.sourcePath || ''),
    total_score: Math.max(0, Math.min(100, Number(payload?.result?.total_score) || 0)),
    level: String(payload?.result?.level || '').slice(0, 30),
    scores: {
      takeoff_timing: Number(payload?.result?.takeoff_timing?.score) || 0,
      body_balance: Number(payload?.result?.body_balance?.score) || 0,
      hands_eyes: Number(payload?.result?.hands_eyes?.score) || 0,
      foot_stance: Number(payload?.result?.foot_stance?.score) || 0,
    },
    improvement_points: (Array.isArray(payload?.result?.improvement_points)
      ? payload.result.improvement_points : []).map((value) => String(value).slice(0, 300)).slice(0, 5),
    overall_comment: String(payload?.result?.overall_comment || '').slice(0, 1000),
    takeoff_duration_seconds: Number.isFinite(Number(payload?.takeoffDuration))
      ? Math.max(0, Number(payload.takeoffDuration)) : null,
    comparison_reference: String(payload?.comparisonReference || '').slice(0, 120),
    analyzed_at: new Date().toISOString(),
  };
  const records = readAnalysisHistory();
  const previous = [...records].reverse().find((item) => item.student_name === studentName);
  records.push(record);
  writeAnalysisHistory(records);
  return {
    record,
    score_change: previous ? record.total_score - Number(previous.total_score || 0) : null,
    takeoff_time_change: previous && record.takeoff_duration_seconds != null && previous.takeoff_duration_seconds != null
      ? record.takeoff_duration_seconds - Number(previous.takeoff_duration_seconds) : null,
  };
});

ipcMain.handle('delete-analysis-history', (event, id) => {
  const records = readAnalysisHistory();
  const filtered = records.filter((record) => record.id !== id);
  writeAnalysisHistory(filtered);
  return { deleted: records.length - filtered.length };
});

ipcMain.handle('export-ai-data-backup', async () => {
  let references = [];
  try {
    const result = await requestSurfAnalyzer('/api/reference/list');
    references = (result.references || []).map(({ preview, ...reference }) => reference);
  } catch {}
  const destination = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `Naoki-Cutter-AIデータ-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Naoki Cutter AIデータ', extensions: ['json'] }],
  });
  if (destination.canceled || !destination.filePath) return { canceled: true };
  const payload = {
    format: 'naoki-cutter-ai-backup', version: 1, created_at: new Date().toISOString(),
    training: readTrainingData(),
    analysis_history: readAnalysisHistory(),
    reference_tags: readReferenceTags(),
    reference_catalog: references,
  };
  fs.writeFileSync(destination.filePath, JSON.stringify(payload, null, 2));
  return { canceled: false, filePath: destination.filePath, trainingCount: payload.training.examples.length };
});

ipcMain.handle('import-ai-data-backup', async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'], filters: [{ name: 'Naoki Cutter AIデータ', extensions: ['json'] }],
  });
  if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
  const backup = JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf8'));
  if (backup.format !== 'naoki-cutter-ai-backup' || !Array.isArray(backup.training?.examples)) {
    throw new Error('Naoki CutterのAIバックアップファイルではありません。');
  }
  const training = readTrainingData();
  const byId = new Map(training.examples.map((example) => [example.id, example]));
  for (const example of backup.training.examples) if (example?.id) byId.set(example.id, example);
  training.examples = [...byId.values()];
  writeTrainingData(training);
  const history = readAnalysisHistory();
  const historyById = new Map(history.map((record) => [record.id, record]));
  for (const record of backup.analysis_history || []) if (record?.id) historyById.set(record.id, record);
  writeAnalysisHistory([...historyById.values()]);
  writeReferenceTags({ ...readReferenceTags(), ...(backup.reference_tags || {}) });
  return { canceled: false, trainingCount: training.examples.length, historyCount: historyById.size };
});

ipcMain.handle('analyze-form-local', async (event, source) => {
  if (!source?.path || !fs.existsSync(source.path)) throw new Error('解析する動画が見つかりません。');
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-form-local-'));
  const proxyPath = path.join(tempDir, 'form.mp4');
  try {
    const range = createSyncProxy(source, proxyPath);
    const result = await postMultipartToSurfAnalyzer('/api/form/local', proxyPath);
    const addOffset = (candidate) => candidate?.detected
      ? { ...candidate, timestamp: range.searchStart + Number(candidate.timestamp) }
      : candidate;
    return {
      ...result,
      takeoff_start: addOffset(result.takeoff_start),
      takeoff_end: addOffset(result.takeoff_end),
      analyzed_range: range,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('analyze-form-cloud', async (event, source) => {
  if (!source?.path || !fs.existsSync(source.path)) throw new Error('解析する動画が見つかりません。');
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-form-cloud-'));
  const proxyPath = path.join(tempDir, 'form.mp4');
  try {
    const range = createSyncProxy(source, proxyPath);
    const result = await postMultipartToSurfAnalyzer('/api/analyze', proxyPath);
    const { frame_images, ...summary } = result;
    const frames = Array.isArray(summary.frames) ? summary.frames : [];
    const analysisMarkers = frames.map((frame, index) => ({
      time: range.searchStart + range.duration * (index + 1) / (frames.length + 1),
      label: frame.scene || `解析ポイント${index + 1}`,
      comment: frame.frame_comment || '',
      annotations: Array.isArray(frame.annotations) ? frame.annotations : [],
    }));
    return { ...summary, analyzed_range: range, analysis_markers: analysisMarkers };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function runLessonFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    process.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    process.once('error', reject);
    process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg終了コード ${code}`)));
  });
}

ipcMain.handle('create-lesson-video', async (event, payload) => {
  const sourcePath = String(payload?.sourcePath || '');
  if (!fs.existsSync(sourcePath)) throw new Error('レッスン動画の元動画が見つかりません。');
  const markers = (Array.isArray(payload?.markers) ? payload.markers : [])
    .map((marker) => Number(marker.time)).filter(Number.isFinite).slice(0, 6);
  if (!markers.length) throw new Error('先にクラウド詳細解析を実行してください。');
  const output = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${path.basename(sourcePath, path.extname(sourcePath))}_lesson.mp4`,
    filters: [{ name: 'MP4動画', extensions: ['mp4'] }],
  });
  if (output.canceled || !output.filePath) return { canceled: true };
  const trimStart = Math.max(0, Number(payload.trimStart) || 0);
  const trimEnd = Math.max(trimStart, Number(payload.trimEnd) || trimStart);
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'naoki-lesson-'));
  try {
    const segmentPaths = [];
    for (let index = 0; index < markers.length; index += 1) {
      const start = Math.max(trimStart, markers[index] - 2);
      const duration = Math.max(0.5, Math.min(trimEnd, markers[index] + 2) - start);
      const segmentPath = path.join(tempDir, `segment-${String(index).padStart(2, '0')}.mp4`);
      await runLessonFfmpeg([
        '-y', '-v', 'error', '-ss', String(start), '-t', String(duration), '-i', sourcePath,
        '-an', '-vf', 'setpts=1.333333*(PTS-STARTPTS),fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=1',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', segmentPath,
      ]);
      segmentPaths.push(segmentPath);
    }
    const listPath = path.join(tempDir, 'segments.txt');
    fs.writeFileSync(listPath, segmentPaths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join('\n'));
    await runLessonFfmpeg(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output.filePath]);
    return { canceled: false, filePath: output.filePath, segmentCount: segmentPaths.length };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('analyze-exported-video', async (event, filePath) => {
  const result = await postMultipartToSurfAnalyzer('/api/analyze', filePath);
  // Skeleton frame images are large and the Cutter confirmation view only
  // needs text/score results. Avoid copying multi-megabyte base64 through IPC.
  const { frame_images, ...summary } = result;
  return summary;
});

ipcMain.handle('save-exported-as-reference', async (event, { filePath, name, description }) => {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('参考動画の名前を入力してください。');
  if (!filePath || !fs.existsSync(filePath)) throw new Error('参考動画にする書き出し済みファイルが見つかりません。もう一度書き出してください。');
  const result = await postMultipartToSurfAnalyzer('/api/reference/upload', filePath, {
    name: cleanName,
    description: String(description || ''),
  });
  const { preview, ...summary } = result;
  return summary;
});

ipcMain.handle('list-reference-videos', async () => {
  const result = await requestSurfAnalyzer('/api/reference/list');
  const savedTags = readReferenceTags();
  return {
    references: (Array.isArray(result.references) ? result.references : []).map(({ preview, ...reference }) => ({
      ...reference,
      tags: savedTags[reference.id] || {},
    })),
  };
});

ipcMain.handle('save-reference-tags', (event, payload) => {
  const id = String(payload?.id || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('参考動画のIDが正しくありません。');
  const clean = (value, max = 80) => String(value || '').trim().slice(0, max);
  const tags = readReferenceTags();
  tags[id] = {
    movement: clean(payload.tags?.movement),
    board: clean(payload.tags?.board),
    angle: clean(payload.tags?.angle),
    level: clean(payload.tags?.level),
    wave: clean(payload.tags?.wave, 120),
  };
  writeReferenceTags(tags);
  return tags[id];
});

ipcMain.handle('delete-reference-video', async (event, id) => {
  const safeId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safeId)) throw new Error('参考動画のIDが正しくありません。');
  const result = await requestSurfAnalyzer(`/api/reference/${encodeURIComponent(safeId)}`, 'DELETE');
  const tags = readReferenceTags();
  delete tags[safeId];
  writeReferenceTags(tags);
  return result;
});

ipcMain.handle('surf-analyzer-status', async () => ({
  state: await probeSurfAnalyzer() ? 'ready' : (surfAnalyzerProc ? 'starting' : 'stopped'),
  managed: Boolean(surfAnalyzerProc),
}));

ipcMain.handle('restart-surf-analyzer', () => startSurfAnalyzer({ restart: true }));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  pruneProxyCache(previewProxiesDir());
  createWindow();
  startSurfAnalyzer().catch((error) => emitSurfAnalyzerStatus({ state: 'error', message: error.message }));
});

app.on('before-quit', () => {
  cancelPreviewProxyEncodes();
  if (surfAnalyzerProc) {
    surfAnalyzerProc.kill('SIGTERM');
    surfAnalyzerProc = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'avi'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('select-output', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'output.mp4',
    filters: [{ name: 'MP4動画', extensions: ['mp4'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('move-cursor', async (event, position) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed() || !position) return false;
  const clientX = Number(position.clientX);
  const clientY = Number(position.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

  // Renderer coordinates are relative to the content area in Electron DIP.
  // CoreGraphics uses the same point-based global coordinate space on macOS,
  // including negative coordinates on displays arranged left of the primary.
  const bounds = sourceWindow.getContentBounds();
  const screenX = bounds.x + clientX;
  const screenY = bounds.y + clientY;
  const result = spawnSync(MOVE_CURSOR, [String(screenX), String(screenY)], {
    stdio: 'ignore',
    timeout: 1000,
  });
  return !result.error && result.status === 0;
});

ipcMain.handle('set-full-screen', async (event, enabled) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || sourceWindow.isDestroyed()) return false;
  sourceWindow.setFullScreen(Boolean(enabled));
  return true;
});

ipcMain.handle('audio-waveform', async (event, { filePath, bins = 1200 }) => {
  if (typeof filePath !== 'string' || !filePath || !fs.existsSync(filePath)) return [];
  const safeBins = Math.max(100, Math.min(4000, Number(bins) || 1200));
  const stat = fs.statSync(filePath);
  const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}:${safeBins}`;
  if (waveformCache.has(cacheKey)) return waveformCache.get(cacheKey);
  if (!hasAudioStream(filePath)) {
    waveformCache.set(cacheKey, []);
    return [];
  }

  const decoded = spawnSync(FFMPEG, [
    '-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '1000',
    '-f', 'f32le', 'pipe:1',
  ], { maxBuffer: 128 * 1024 * 1024 });
  if (decoded.error || decoded.status !== 0 || !decoded.stdout.length) return [];
  const sampleCount = Math.floor(decoded.stdout.length / 4);
  const samples = new Float32Array(
    decoded.stdout.buffer,
    decoded.stdout.byteOffset,
    sampleCount
  );
  const peaks = new Array(safeBins).fill(0);
  for (let bin = 0; bin < safeBins; bin += 1) {
    const start = Math.floor((bin * sampleCount) / safeBins);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * sampleCount) / safeBins));
    let peak = 0;
    for (let i = start; i < Math.min(end, sampleCount); i += 1) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks[bin] = Math.min(1, peak);
  }
  waveformCache.set(cacheKey, peaks);
  return peaks;
});

ipcMain.handle('start-review-recording', async (event, outputPath) => {
  if (typeof outputPath !== 'string' || !outputPath) throw new Error('保存先が選択されていません');
  const id = crypto.randomUUID();
  const tempPath = path.join(app.getPath('temp'), `naoki-review-${id}.webm`);
  const stream = fs.createWriteStream(tempPath, { flags: 'wx' });
  recordingSessions.set(id, { stream, tempPath, outputPath, writeChain: Promise.resolve() });
  return id;
});

ipcMain.handle('append-review-recording', async (event, { id, chunk }) => {
  const recording = recordingSessions.get(id);
  if (!recording) throw new Error('収録セッションが見つかりません');
  const buffer = Buffer.from(chunk);
  recording.writeChain = recording.writeChain.then(() => new Promise((resolve, reject) => {
    recording.stream.write(buffer, (error) => (error ? reject(error) : resolve()));
  }));
  await recording.writeChain;
  return true;
});

ipcMain.handle('finish-review-recording', async (event, id) => {
  const recording = recordingSessions.get(id);
  if (!recording) throw new Error('収録セッションが見つかりません');
  recordingSessions.delete(id);
  await recording.writeChain;
  await new Promise((resolve, reject) => recording.stream.end((error) => (error ? reject(error) : resolve())));
  try {
    const encoded = spawnSync(FFMPEG, [
      '-y', '-v', 'error', '-i', recording.tempPath,
      '-vf', 'fps=30',
      '-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      recording.outputPath,
    ], { maxBuffer: 16 * 1024 * 1024 });
    if (encoded.error || encoded.status !== 0) {
      throw new Error(`収録動画のMP4変換に失敗しました: ${encoded.stderr.toString().slice(-1000)}`);
    }
    return { outputPath: recording.outputPath };
  } finally {
    fs.rmSync(recording.tempPath, { force: true });
  }
});

ipcMain.handle('cancel-review-recording', async (event, id) => {
  const recording = recordingSessions.get(id);
  if (!recording) return false;
  recordingSessions.delete(id);
  try { recording.stream.destroy(); } catch {}
  fs.rmSync(recording.tempPath, { force: true });
  return true;
});

// Project files contain only lightweight edit instructions and absolute paths
// back to the user's original media. Source videos are never copied into this
// directory and are never deleted by project/cache cleanup.
function projectsDir() {
  return path.join(app.getPath('userData'), 'projects');
}

function autosavesDir() {
  return path.join(app.getPath('userData'), 'autosaves');
}

function previewProxiesDir() {
  return path.join(app.getPath('userData'), 'preview-proxies');
}

function validProjectId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id);
}

function projectFilePath(id) {
  if (!validProjectId(id)) throw new Error('プロジェクトIDが不正です');
  return path.join(projectsDir(), `${id}.json`);
}

function projectSummary(doc) {
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    clipCount: doc.data && Array.isArray(doc.data.clips) ? doc.data.clips.length : 0,
  };
}

ipcMain.handle('list-projects', async () => {
  fs.mkdirSync(projectsDir(), { recursive: true });
  const projects = [];
  for (const entry of fs.readdirSync(projectsDir(), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(projectsDir(), entry.name), 'utf8'));
      if (validProjectId(doc.id) && doc.data && Array.isArray(doc.data.clips)) {
        projects.push(projectSummary(doc));
      }
    } catch {
      // Ignore a damaged/incomplete save rather than preventing other projects
      // from appearing in the list.
    }
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
});

ipcMain.handle('save-project', async (event, payload) => {
  if (!payload || !payload.data || !Array.isArray(payload.data.clips)) {
    throw new Error('保存する編集データが不正です');
  }
  const encoded = JSON.stringify(payload.data);
  if (Buffer.byteLength(encoded, 'utf8') > 10 * 1024 * 1024) {
    throw new Error('編集データが大きすぎて保存できません');
  }
  fs.mkdirSync(projectsDir(), { recursive: true });
  const id = validProjectId(payload.id) ? payload.id : crypto.randomUUID();
  const fallbackName = payload.data.clips[0] && payload.data.clips[0].name
    ? payload.data.clips[0].name.replace(/\.[^.]+$/, '')
    : '名称未設定';
  const name = String(payload.name || fallbackName).trim().slice(0, 100) || fallbackName;
  const doc = {
    version: 1,
    id,
    name,
    updatedAt: new Date().toISOString(),
    data: payload.data,
  };
  const finalPath = projectFilePath(id);
  const tempPath = `${finalPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tempPath, finalPath);
  return projectSummary(doc);
});

ipcMain.handle('load-project', async (event, id) => {
  const doc = JSON.parse(fs.readFileSync(projectFilePath(id), 'utf8'));
  if (!doc.data || !Array.isArray(doc.data.clips) || !Array.isArray(doc.data.transitions)) {
    throw new Error('保存データが壊れています');
  }
  const missingPaths = [...new Set(doc.data.clips.map((c) => c.path).filter((p) => !p || !fs.existsSync(p)))];
  return { project: doc, missingPaths };
});

ipcMain.handle('save-autosave', async (event, payload) => {
  return writeAutosave(autosavesDir(), payload);
});

ipcMain.handle('load-latest-autosave', async () => {
  const doc = loadLatestAutosave(autosavesDir());
  if (!doc) return null;
  const missingPaths = [...new Set(
    doc.data.clips.map((clip) => clip.path).filter((filePath) => !filePath || !fs.existsSync(filePath))
  )];
  return { autosave: doc, missingPaths };
});

ipcMain.handle('delete-project', async (event, id) => {
  const target = projectFilePath(id);
  // Delete only this app-owned project JSON. Never follow media paths stored
  // inside it, and never touch source videos, exports, other saves, or cache.
  const freedBytes = deleteProjectFile(target);
  return { id, freedBytes };
});

ipcMain.handle('delete-projects-and-cache', async () => {
  let projectCount = 0;
  let projectBytes = 0;
  fs.mkdirSync(projectsDir(), { recursive: true });
  for (const entry of fs.readdirSync(projectsDir(), { withFileTypes: true })) {
    // Delete only files created by this project store. Never follow media paths
    // recorded inside JSON, and never touch exports.
    if (!entry.isFile() || (!entry.name.endsWith('.json') && !entry.name.endsWith('.json.tmp'))) continue;
    const target = path.join(projectsDir(), entry.name);
    try {
      projectBytes += fs.statSync(target).size;
      fs.unlinkSync(target);
      if (entry.name.endsWith('.json')) projectCount++;
    } catch {
      // Continue deleting the remaining app-owned saves.
    }
  }
  const userDataPath = app.getPath('userData');
  const beforeCache = getDirSize(userDataPath);
  clearAutosaves(autosavesDir());
  clearProxyCache(previewProxiesDir());
  activePreviewProxyPaths.clear();
  cancelPreviewProxyEncodes();
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData();
  const afterCache = getDirSize(userDataPath);
  return {
    projectCount,
    freedBytes: projectBytes + Math.max(0, beforeCache - afterCache),
  };
});

function probeInfo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration',
      '-of', 'json',
      filePath,
    ];
    const proc = spawn(FFPROBE, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited ${code}`));
      try {
        const data = JSON.parse(out);
        const duration = parseFloat(data.format.duration);
        const stream = data.streams && data.streams[0];
        if (Number.isNaN(duration) || !stream) return reject(new Error('動画情報の取得に失敗しました'));
        let fps = 30;
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          if (den) fps = num / den;
        }
        // Phones commonly store video with landscape pixel dimensions plus a 90/270°
        // rotation tag that players apply automatically — the width/height ffprobe
        // reports are the *pre-rotation* storage order, not what's actually displayed.
        // ffmpeg's decoder auto-rotates frames before our filters ever see them, so
        // downstream crop/orientation math needs the post-rotation (displayed) size.
        let width = stream.width;
        let height = stream.height;
        const rotation = stream.side_data_list && stream.side_data_list[0] && stream.side_data_list[0].rotation;
        if (rotation && Math.abs(rotation % 180) === 90) {
          [width, height] = [height, width];
        }
        resolve({ duration, width, height, fps });
      } catch (e) {
        reject(e);
      }
    });
  });
}

ipcMain.handle('probe-info', async (event, filePath) => {
  return probeInfo(filePath);
});

function spawnPreviewProxyEncode(filePath, tempPath, scale, videoArgs) {
  return new Promise((resolve, reject) => {
    fs.rmSync(tempPath, { force: true });
    const args = [
      '-y', '-i', filePath,
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', scale,
      ...videoArgs,
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-f', 'mp4',
      tempPath,
    ];
    const proc = spawn(FFMPEG, args);
    let errorText = '';
    proc.stderr.on('data', (chunk) => {
      errorText = (errorText + chunk.toString()).slice(-12000);
    });
    proc.on('error', (error) => {
      activePreviewProxyProcs.delete(proc);
      fs.rmSync(tempPath, { force: true });
      reject(error);
    });
    proc.on('close', (code) => {
      activePreviewProxyProcs.delete(proc);
      if (code !== 0 || !fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
        reject(new Error(errorText || `ffmpeg exited ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function runPreviewProxyEncode(filePath, outputPath, portrait) {
  const tempPath = `${outputPath}.tmp`;
  const scale = portrait ? 'scale=-2:960' : 'scale=960:-2';
  try {
    await spawnPreviewProxyEncode(filePath, tempPath, scale, [
      '-c:v', 'h264_videotoolbox', '-allow_sw', '1',
      '-b:v', '1800k', '-maxrate', '2400k', '-bufsize', '4800k',
      '-pix_fmt', 'yuv420p',
    ]);
  } catch {
    // Some macOS sessions do not expose VideoToolbox (for example a locked or
    // remote session). A 960px MPEG-4 proxy is still far lighter to decode than
    // the original 4K source, so editing remains usable instead of failing.
    await spawnPreviewProxyEncode(filePath, tempPath, scale, [
      '-c:v', 'mpeg4', '-b:v', '1800k', '-pix_fmt', 'yuv420p',
    ]);
  }
  fs.renameSync(tempPath, outputPath);
}

async function ensurePreviewProxy(filePath) {
  if (typeof filePath !== 'string' || !filePath || !fs.existsSync(filePath)) {
    throw new Error('軽量プレビューを作る元動画が見つかりません');
  }
  const sourceInfo = await probeInfo(filePath);
  if (Math.max(sourceInfo.width, sourceInfo.height) < 3000) {
    return { path: filePath, proxy: false };
  }
  const key = proxyCacheKey(filePath);
  const outputPath = path.join(previewProxiesDir(), `${key}.mp4`);
  fs.mkdirSync(previewProxiesDir(), { recursive: true });
  if (fs.existsSync(outputPath)) {
    const now = new Date();
    fs.utimesSync(outputPath, now, now);
    activePreviewProxyPaths.add(outputPath);
    pruneProxyCache(previewProxiesDir(), { keepPaths: activePreviewProxyPaths });
    return { path: outputPath, proxy: true, cached: true };
  }
  if (!previewProxyJobs.has(key)) {
    const jobEpoch = previewProxyEpoch;
    const job = previewProxyQueue.then(async () => {
      if (jobEpoch !== previewProxyEpoch) return { path: filePath, proxy: false, cancelled: true };
      await runPreviewProxyEncode(filePath, outputPath, sourceInfo.height > sourceInfo.width);
      if (jobEpoch !== previewProxyEpoch) {
        fs.rmSync(outputPath, { force: true });
        return { path: filePath, proxy: false, cancelled: true };
      }
      const proxyInfo = await probeInfo(outputPath);
      const durationTolerance = Math.max(1, sourceInfo.duration * 0.01);
      if (Math.abs(proxyInfo.duration - sourceInfo.duration) > durationTolerance) {
        fs.rmSync(outputPath, { force: true });
        throw new Error('軽量プレビューの長さを確認できませんでした');
      }
      activePreviewProxyPaths.add(outputPath);
      pruneProxyCache(previewProxiesDir(), { keepPaths: activePreviewProxyPaths });
      return { path: outputPath, proxy: true, cached: false };
    }).finally(() => previewProxyJobs.delete(key));
    previewProxyQueue = job.catch(() => {});
    previewProxyJobs.set(key, job);
  }
  return previewProxyJobs.get(key);
}

ipcMain.handle('ensure-preview-proxy', async (event, filePath) => {
  try {
    return await ensurePreviewProxy(filePath);
  } catch (error) {
    throw new Error(`軽量プレビューを作成できませんでした: ${error.message}`);
  }
});

// Automatic subject tracking: given one user-clicked seed position (a point on
// the subject at some local time), follow it to the end of the trim range and
// produce a panKeyframes array in the exact same {t, x, y} shape the manual
// keyframe UI already uses — so the rest of the app (Hermite interpolation,
// preview, export crop) doesn't need to know tracked keyframes are any
// different from hand-placed ones.
//
// Approach: extract downscaled grayscale frames at a fine, fixed interval and,
// frame to frame, locate the centroid of the darkest pixels near a
// velocity-predicted position (a small search window, re-centered each step by
// the tracked object's own recent motion rather than searching the whole
// frame). This suits backlit surf footage well — the wetsuit silhouette is
// reliably darker than the sparkling water around it — without needing any
// bundled ML model or external dependency. Verified against real footage: it
// tracks tighter than hand-placed keyframes, which drift between sparse manual
// points on anything but linear motion.
function trackSubject({ path: filePath, trimStart, trimEnd, srcW, srcH, seedLocalT, seedX, seedY }) {
  return new Promise((resolve, reject) => {
    const DS_W = 960;
    const DS_H = Math.max(2, Math.round((DS_W * srcH) / srcW));
    const duration = trimEnd - trimStart;
    // Hard cap: an untrimmed or very long selection would otherwise try to
    // extract and buffer hours of raw frames, which previously crashed the
    // whole app with an out-of-memory allocation failure. Keyframes past this
    // point just don't exist — getEffectivePan/Hermite interpolation already
    // holds the last keyframe's value beyond the last defined point, so
    // playback past the cap is unaffected, just untracked.
    const MAX_TRACK_SECONDS = 90;
    const remaining = Math.min(duration - seedLocalT, MAX_TRACK_SECONDS);
    if (remaining <= 0.05) {
      resolve([{ t: Number(seedLocalT.toFixed(3)), x: seedX, y: seedY }]);
      return;
    }
    // Fine internal tracking step (small motion per step keeps the search
    // window tight and reliable); the result is thinned afterward to a
    // reasonable keyframe count for the piecewise export expression.
    const TRACK_DT = 0.15;
    const startAbs = trimStart + seedLocalT;

    const args = [
      '-ss', String(startAbs),
      '-i', filePath,
      '-t', String(remaining),
      '-vf', `fps=${1 / TRACK_DT},scale=${DS_W}:${DS_H}`,
      '-pix_fmt', 'gray',
      '-f', 'rawvideo',
      'pipe:1',
    ];
    const proc = spawn(FFMPEG, args);
    const chunks = [];
    let killed = false;
    let totalBytes = 0;
    // Defense in depth against the extraction running longer/bigger than
    // expected for any reason: stop reading and kill ffmpeg rather than let
    // the buffer grow unbounded.
    const MAX_BYTES = 400 * 1024 * 1024;
    proc.stdout.on('data', (d) => {
      if (killed) return;
      totalBytes += d.length;
      if (totalBytes > MAX_BYTES) {
        killed = true;
        proc.kill('SIGKILL');
        return;
      }
      chunks.push(d);
    });
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('close', (code) => {
      try {
        if (code !== 0 && !killed) {
          reject(new Error(`tracking extraction failed (exit ${code})`));
          return;
        }
        const buf = Buffer.concat(chunks);
        const frameSize = DS_W * DS_H;
        const numFrames = Math.floor(buf.length / frameSize);
        if (numFrames < 2) {
          resolve([{ t: Number(seedLocalT.toFixed(3)), x: seedX, y: seedY }]);
          return;
        }

        const RADIUS = 30;
        const SIGMA = 18;
        let curX = seedX * DS_W;
        let curY = seedY * DS_H;
        let velX = 0;
        let velY = 0;
        const tracked = [{ t: seedLocalT, x: seedX, y: seedY }];

        for (let i = 1; i < numFrames; i++) {
          const frame = buf.subarray(i * frameSize, (i + 1) * frameSize);
          const predX = curX + velX;
          const predY = curY + velY;
          const x0 = Math.max(0, Math.round(predX - RADIUS));
          const x1 = Math.min(DS_W, Math.round(predX + RADIUS));
          const y0 = Math.max(0, Math.round(predY - RADIUS));
          const y1 = Math.min(DS_H, Math.round(predY + RADIUS));

          const vals = [];
          for (let y = y0; y < y1; y++) {
            const rowOff = y * DS_W;
            for (let x = x0; x < x1; x++) vals.push(frame[rowOff + x]);
          }
          vals.sort((a, b) => a - b);
          const threshold = vals.length ? vals[Math.floor(vals.length * 0.2)] : 255;

          let sumW = 0;
          let sumX = 0;
          let sumY = 0;
          for (let y = y0; y < y1; y++) {
            const rowOff = y * DS_W;
            const dy = y - predY;
            for (let x = x0; x < x1; x++) {
              const v = frame[rowOff + x];
              if (v <= threshold) {
                const dx = x - predX;
                const gauss = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
                const w = (threshold - v + 1) * gauss;
                sumW += w;
                sumX += w * x;
                sumY += w * y;
              }
            }
          }
          let newX = predX;
          let newY = predY;
          if (sumW > 0) {
            newX = sumX / sumW;
            newY = sumY / sumW;
          }
          newX = Math.max(0, Math.min(DS_W, newX));
          newY = Math.max(0, Math.min(DS_H, newY));
          velX = (newX - curX) * 0.9;
          velY = (newY - curY) * 0.9;
          curX = newX;
          curY = newY;
          tracked.push({ t: seedLocalT + i * TRACK_DT, x: curX / DS_W, y: curY / DS_H });
        }

        // Thin to a manageable keyframe count for the export expression —
        // targets roughly a keyframe every 0.5s, always keeping the last point.
        const stride = Math.max(1, Math.round(0.5 / TRACK_DT));
        const thinned = tracked.filter((_, i) => i % stride === 0 || i === tracked.length - 1);
        resolve(thinned.map((k) => ({ t: Number(k.t.toFixed(3)), x: Number(k.x.toFixed(4)), y: Number(k.y.toFixed(4)) })));
      } catch (e) {
        reject(e);
      }
    });
  });
}

ipcMain.handle('track-subject', async (event, payload) => {
  try {
    const keyframes = await trackSubject(payload);
    return { ok: true, keyframes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// clips: [{ path, trimStart, trimEnd }]
// transitions: length clips.length - 1, [{ type: 'cut'|'crossfade'|'dissolve', duration }]
// settings: { outputPath, resolution: '3840x2160', codec: 'h264'|'h265', fps }
const XFADE_NAMES = { crossfade: 'fade', dissolve: 'dissolve' };

// Builds a Catmull-Rom / cardinal Hermite ffmpeg eval expression in `t` (seconds
// from clip start) through keyframes [{t, x, y}, ...] sorted by t, for one axis
// ('x' or 'y'), scaled to source pixels. Holds the first/last value outside the
// keyframe range. Each keyframe's tangent comes from its neighbors (central
// difference; one-sided at the ends) so the curve bends smoothly through the
// points instead of cutting corners the way straight segments do — plain linear
// interpolation lags a real subject's non-linear path worst at the midpoint of
// a gap between keyframes, which is where pan-tracking drift kept surfacing.
// Must match hermiteInterp in renderer.js so the preview and export agree.
function buildPiecewiseExpr(kfs, key, scale) {
  const n = kfs.length;
  if (n === 1) return `${(kfs[0][key] * scale).toFixed(2)}`;
  const P = kfs.map((k) => k[key] * scale);
  const T = kfs.map((k) => k.t);
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) m[i] = (P[1] - P[0]) / (T[1] - T[0]);
    else if (i === n - 1) m[i] = (P[n - 1] - P[n - 2]) / (T[n - 1] - T[n - 2]);
    else m[i] = (P[i + 1] - P[i - 1]) / (T[i + 1] - T[i - 1]);
  }
  let expr = `${P[n - 1].toFixed(2)}`;
  for (let i = n - 2; i >= 0; i--) {
    const dt = T[i + 1] - T[i] || 0.0001;
    const u = `((t-${T[i].toFixed(3)})/${dt.toFixed(3)})`;
    const h00 = `(2*${u}*${u}*${u}-3*${u}*${u}+1)`;
    const h10 = `(${u}*${u}*${u}-2*${u}*${u}+${u})`;
    const h01 = `(-2*${u}*${u}*${u}+3*${u}*${u})`;
    const h11 = `(${u}*${u}*${u}-${u}*${u})`;
    const seg = `(${h00}*${P[i].toFixed(2)}+${h10}*${(m[i] * dt).toFixed(2)}+${h01}*${P[i + 1].toFixed(2)}+${h11}*${(m[i + 1] * dt).toFixed(2)})`;
    expr = `if(lt(t,${T[i + 1].toFixed(3)}),${seg},${expr})`;
  }
  expr = `if(lt(t,${T[0].toFixed(3)}),${P[0].toFixed(2)},${expr})`;
  return expr;
}

// Fallback for when the renderer's clip.width/height didn't make it into the
// export payload for some reason — probe the file directly rather than silently
// skipping zoom/crop (which is what happened before: zoom showed correctly in
// the UI, using CSS transform that doesn't need width/height, but the export
// path required them and quietly did nothing when they were missing).
const dimensionProbeCache = new Map();
function probeDimensionsSync(filePath) {
  if (dimensionProbeCache.has(filePath)) return dimensionProbeCache.get(filePath);
  let result = null;
  try {
    const probe = spawnSync(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      filePath,
    ]);
    if (!probe.error && probe.stdout) {
      const [w, h] = probe.stdout.toString().trim().split(',').map(Number);
      if (w && h) result = { width: w, height: h };
    }
  } catch {
    // keep result = null, handled by caller
  }
  dimensionProbeCache.set(filePath, result);
  return result;
}

// clip.speedSegments: [{ start, end, speed }, ...] in local clip time (0 =
// trimStart), for varying playback speed within a single clip instead of the
// one flat clip.speed for the whole thing. Returns a full, gap-filled,
// non-overlapping partition of [0, trimDur] — segments outside any given
// range fall back to baseSpeed, and later segments win over earlier ones in
// an overlap (clamps the earlier one's end back).
function partitionSpeedSegments(trimDur, segments, baseSpeed) {
  const eps = 0.001;
  const cleaned = (segments || [])
    .map((s) => ({
      start: Math.max(0, Math.min(trimDur, s.start)),
      end: Math.max(0, Math.min(trimDur, s.end)),
      speed: s.speed && s.speed > 0 ? s.speed : 1,
    }))
    .filter((s) => s.end - s.start > eps)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const s of cleaned) {
    if (merged.length && s.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].start + eps,
        Math.min(merged[merged.length - 1].end, s.start)
      );
    }
    merged.push({ ...s });
  }

  const parts = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start - cursor > eps) parts.push({ start: cursor, end: s.start, speed: baseSpeed });
    parts.push(s);
    cursor = s.end;
  }
  if (trimDur - cursor > eps) parts.push({ start: cursor, end: trimDur, speed: baseSpeed });
  if (!parts.length) parts.push({ start: 0, end: trimDur, speed: baseSpeed });
  return parts;
}

function clipOutputDuration(clip) {
  const trimDur = clip.trimEnd - clip.trimStart;
  const baseSpeed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  if (clip.speedSegments && clip.speedSegments.length) {
    const parts = partitionSpeedSegments(trimDur, clip.speedSegments, baseSpeed);
    return parts.reduce((sum, p) => sum + (p.end - p.start) / p.speed, 0);
  }
  return trimDur / baseSpeed;
}

// clip.zoom: scale factor (1 = no extra zoom). clip.zoomX/zoomY: 0-1 fraction of
// the source frame to center the crop on (used when there's no keyframe animation).
// clip.panAnimated + clip.panKeyframes: [{t, x, y}, ...] animates the crop center
// over the clip's duration instead, for a moving pan/follow effect.
//
// The crop baseline always matches the OUTPUT aspect ratio first (e.g. cropping a
// 16:9 clip down to a 9:16-shaped slice for a vertical export) so mismatched
// orientations fill the frame instead of getting padded with black bars — this is
// the "auto-fit" crop. clip.zoom then crops in further from that fitted baseline.
function buildVideoFilter(clip, i, w, h, fps) {
  const outW = parseInt(w, 10);
  const outH = parseInt(h, 10);
  let pre = '';

  let srcW = clip.width;
  let srcH = clip.height;
  if (!srcW || !srcH) {
    const fallback = probeDimensionsSync(clip.path);
    if (fallback) {
      srcW = fallback.width;
      srcH = fallback.height;
    }
  }

  if (srcW && srcH) {
    let baseW = srcW;
    let baseH = srcH;
    const srcAspect = srcW / srcH;
    const outAspect = outW / outH;
    if (srcAspect > outAspect) {
      baseH = srcH;
      baseW = Math.round(srcH * outAspect);
    } else if (srcAspect < outAspect) {
      baseW = srcW;
      baseH = Math.round(srcW / outAspect);
    }

    const zoom = clip.zoom && clip.zoom > 1.001 ? clip.zoom : 1;
    const cropW = Math.max(2, Math.floor(baseW / zoom / 2) * 2);
    const cropH = Math.max(2, Math.floor(baseH / zoom / 2) * 2);

    if (cropW < srcW || cropH < srcH) {
      const kfs =
        clip.panAnimated && Array.isArray(clip.panKeyframes) && clip.panKeyframes.length
          ? [...clip.panKeyframes].sort((a, b) => a.t - b.t)
          : null;

      if (kfs) {
        const cxExpr = buildPiecewiseExpr(kfs, 'x', srcW);
        const cyExpr = buildPiecewiseExpr(kfs, 'y', srcH);
        const xExpr = `clip((${cxExpr})-(${cropW}/2),0,${srcW - cropW})`;
        const yExpr = `clip((${cyExpr})-(${cropH}/2),0,${srcH - cropH})`;
        pre = `crop=${cropW}:${cropH}:'${xExpr}':'${yExpr}',`;
      } else {
        const cx = (clip.zoomX != null ? clip.zoomX : 0.5) * srcW;
        const cy = (clip.zoomY != null ? clip.zoomY : 0.5) * srcH;
        const x = Math.max(0, Math.min(srcW - cropW, Math.round(cx - cropW / 2)));
        const y = Math.max(0, Math.min(srcH - cropH, Math.round(cy - cropH / 2)));
        pre = `crop=${cropW}:${cropH}:${x}:${y},`;
      }
    }
  }

  const trimDur = clip.trimEnd - clip.trimStart;
  const inputVideoOffset = Math.max(0, Number(clip._inputVideoOffset) || 0);
  const inputTrim = `trim=start=${inputVideoOffset.toFixed(6)}:end=${(inputVideoOffset + trimDur).toFixed(6)},setpts=PTS-STARTPTS,`;
  const baseSpeed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const tail = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`;

  if (!clip.speedSegments || !clip.speedSegments.length) {
    const speedFilter = baseSpeed !== 1 ? `setpts=PTS/${baseSpeed},` : '';
    return `[${i}:v]${inputTrim}${pre}${speedFilter}${tail}`;
  }

  // Per-segment speed: crop once (a single continuous `t` timeline, so the
  // pan-keyframe math above is unaffected), then split that cropped stream
  // into one branch per speed segment, trim + retime each branch on its own,
  // and concatenate — same idea as manually cutting the clip into pieces and
  // setting a different speed per piece, just without fragmenting the
  // clip list.
  const parts = partitionSpeedSegments(trimDur, clip.speedSegments, baseSpeed);
  const cropLabel = `vcrop${i}`;
  let graph = `[${i}:v]${inputTrim}${pre}format=yuv420p[${cropLabel}]`;
  const splitLabels = parts.map((_, idx) => `vseg${i}_${idx}`);
  graph += `;[${cropLabel}]split=${parts.length}${splitLabels.map((l) => `[${l}]`).join('')}`;
  const branchLabels = [];
  parts.forEach((p, idx) => {
    const outLabel = `vsegout${i}_${idx}`;
    graph += `;[${splitLabels[idx]}]trim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed}[${outLabel}]`;
    branchLabels.push(outLabel);
  });
  graph += `;${branchLabels.map((l) => `[${l}]`).join('')}concat=n=${parts.length}:v=1:a=0[vconcat${i}]`;
  graph += `;[vconcat${i}]${tail}`;
  return graph;
}

// atempo only accepts 0.5-2.0 per instance, so values outside that range chain
// multiple atempo filters together to reach the full speed change.
function buildAtempoChain(speed) {
  const filters = [];
  let remaining = speed;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(',');
}

// Some source footage (screen recordings, certain camera modes) has no audio
// stream at all. Referencing [i:a] for such an input makes ffmpeg fail outright
// ("Stream specifier ':a' ... matches no streams") — not just for that clip, the
// whole filtergraph errors out. Probe once per unique path and cache the result.
const audioProbeCache = new Map();
function hasAudioStream(filePath) {
  if (audioProbeCache.has(filePath)) return audioProbeCache.get(filePath);
  let result = true; // fail-open: an unexpected probe error shouldn't silently drop real audio
  try {
    const probe = spawnSync(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      filePath,
    ]);
    if (!probe.error) {
      result = Boolean(probe.stdout && probe.stdout.toString().trim().length);
    }
  } catch {
    // keep fail-open default
  }
  audioProbeCache.set(filePath, result);
  return result;
}

function buildAudioFilter(clip, i, outputDur) {
  if (!hasAudioStream(clip.path)) {
    return `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${outputDur.toFixed(3)}[a${i}]`;
  }
  const baseSpeed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const trimDur = clip.trimEnd - clip.trimStart;
  const inputTrim = `atrim=start=0:end=${trimDur.toFixed(6)},asetpts=PTS-STARTPTS,`;
  const tail = `aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`;

  if (!clip.speedSegments || !clip.speedSegments.length) {
    const speedFilter = baseSpeed !== 1 ? `${buildAtempoChain(baseSpeed)},` : '';
    return `[${i}:a]${inputTrim}${speedFilter}${tail}`;
  }

  const parts = partitionSpeedSegments(trimDur, clip.speedSegments, baseSpeed);
  const splitLabels = parts.map((_, idx) => `aseg${i}_${idx}`);
  let graph = `[${i}:a]${inputTrim}asplit=${parts.length}${splitLabels.map((l) => `[${l}]`).join('')}`;
  const branchLabels = [];
  parts.forEach((p, idx) => {
    const outLabel = `asegout${i}_${idx}`;
    const speedFilter = p.speed !== 1 ? `${buildAtempoChain(p.speed)},` : '';
    graph += `;[${splitLabels[idx]}]atrim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},asetpts=PTS-STARTPTS,${speedFilter}aformat=sample_rates=48000:channel_layouts=stereo[${outLabel}]`;
    branchLabels.push(outLabel);
  });
  graph += `;${branchLabels.map((l) => `[${l}]`).join('')}concat=n=${parts.length}:v=0:a=1[aconcat${i}]`;
  graph += `;[aconcat${i}]${tail}`;
  return graph;
}

function buildFilterGraph(clips, transitions, settings) {
  const fps = settings.fps || 30;
  const [w, h] = settings.resolution.split('x');

  const inputs = [];
  const filters = [];

  // Output-timeline duration: slow motion (speed < 1) stretches a clip's screen
  // time, fast-forward (speed > 1) compresses it — everything downstream (xfade
  // offsets, total progress, and silent-audio padding) needs this, not the raw
  // trim length.
  const durations = clips.map((c) => clipOutputDuration(c));

  clips.forEach((clip, i) => {
    inputs.push('-ss', String(clip.trimStart), '-to', String(clip.trimEnd), '-i', clip.path);
    filters.push(buildVideoFilter(clip, i, w, h, fps));
    filters.push(buildAudioFilter(clip, i, durations[i]));
  });

  let currentVLabel = 'v0';
  let currentALabel = 'a0';
  let cumulative = durations[0];

  for (let i = 1; i < clips.length; i++) {
    const t = transitions[i - 1];
    const isCut = t.type === 'cut';
    const nextV = `vx${i}`;
    const nextA = `ax${i}`;

    if (isCut) {
      // A cut is a true concatenation. The former 0.04-second xfade surrogate
      // accumulated fractional-frame rounding at 30fps and could make xfade
      // discard every video after a later join while audio kept concatenating.
      filters.push(`[${currentVLabel}][v${i}]concat=n=2:v=1:a=0[${nextV}]`);
      filters.push(`[${currentALabel}][a${i}]concat=n=2:v=0:a=1[${nextA}]`);
      cumulative += durations[i];
    } else {
      const dur = Math.max(t.duration, 0.04);
      const xfadeName = XFADE_NAMES[t.type] || 'fade';
      const offset = Math.max(cumulative - dur, 0);
      filters.push(
        `[${currentVLabel}][v${i}]xfade=transition=${xfadeName}:duration=${dur}:offset=${offset}[${nextV}]`
      );
      filters.push(`[${currentALabel}][a${i}]acrossfade=d=${dur}[${nextA}]`);
      cumulative = cumulative + durations[i] - dur;
    }

    currentVLabel = nextV;
    currentALabel = nextA;
  }

  const filterComplex = filters.join(';');
  return { inputs, filterComplex, finalV: currentVLabel, finalA: currentALabel, totalDuration: cumulative };
}

function validateExportStreamDurations(outputPath, expectedDuration) {
  const probe = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', outputPath,
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error('書き出した動画を検査できませんでした。');
  let streams;
  try {
    streams = JSON.parse(probe.stdout).streams || [];
  } catch {
    throw new Error('書き出した動画の検査結果を読み取れませんでした。');
  }
  const videoDuration = Number(streams.find((stream) => stream.codec_type === 'video')?.duration);
  const audioDuration = Number(streams.find((stream) => stream.codec_type === 'audio')?.duration);
  const tolerance = Math.max(0.5, Number(expectedDuration) * 0.01);
  if (!Number.isFinite(videoDuration) || videoDuration + tolerance < expectedDuration) {
    throw new Error(`映像が途中で終了したため書き出しを失敗として停止しました（映像 ${Number.isFinite(videoDuration) ? videoDuration.toFixed(2) : '不明'}秒／予定 ${expectedDuration.toFixed(2)}秒）。`);
  }
  if (Number.isFinite(audioDuration) && Math.abs(audioDuration - videoDuration) > tolerance) {
    throw new Error(`映像と音声の長さが一致しないため書き出しを失敗として停止しました（映像 ${videoDuration.toFixed(2)}秒／音声 ${audioDuration.toFixed(2)}秒）。`);
  }
}

ipcMain.handle('export-video', async (event, { clips, transitions, settings }) => {
  const { inputs, filterComplex, finalV, finalA, totalDuration } = buildFilterGraph(
    clips,
    transitions,
    settings
  );

  // VideoToolbox uses the Mac's dedicated hardware encoder block instead of
  // spending CPU cycles on libx264/libx265 — a lot faster, especially on Apple
  // Silicon. -q:v is quality-based (like CRF) rather than a flat bitrate, so it
  // spends fewer bits on simple/static footage and more on complex motion
  // automatically — smaller files than a one-size-fits-all bitrate at the same
  // visual quality, and it scales itself to whatever resolution is requested.
  // HEVC is the more efficient codec so it needs a lower quality number for
  // comparable (or better) quality at a noticeably smaller file size.
  const codecArgs =
    settings.codec === 'h265'
      ? ['-c:v', 'hevc_videotoolbox', '-q:v', '60', '-tag:v', 'hvc1']
      : ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-profile:v', 'high'];

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', `[${finalV}]`,
    '-map', `[${finalA}]`,
    ...codecArgs,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    settings.outputPath,
  ];

  exportCancelled = false;

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    currentExportProc = proc;
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        const progress = totalDuration > 0 ? Math.min(seconds / totalDuration, 1) : 0;
        mainWindow.webContents.send('export-progress', { progress, seconds, totalDuration });
      }
    });

    proc.on('close', (code) => {
      currentExportProc = null;
      if (exportCancelled) {
        fs.unlink(settings.outputPath, () => {});
        reject(new Error('CANCELLED'));
        return;
      }
      if (code === 0) {
        try {
          validateExportStreamDurations(settings.outputPath, totalDuration);
          resolve({ success: true, outputPath: settings.outputPath });
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(`ffmpeg failed (code ${code}):\n${stderr.slice(-2000)}`));
      }
    });

    proc.on('error', (err) => {
      currentExportProc = null;
      reject(err);
    });
  });
});

ipcMain.handle('export-comparison', async (event, { left, right, settings }) => {
  const duration = Math.min(Number(left.end) - Number(left.start), Number(right.end) - Number(right.start));
  if (!Number.isFinite(duration) || duration < 0.2) throw new Error('比較できる共通時間が短すぎます');
  const [outW, outH] = settings.resolution.split('x').map(Number);
  const portrait = settings.orientation === 'portrait';
  const paneW = portrait ? outW : Math.floor(outW / 2 / 2) * 2;
  const paneH = portrait ? Math.floor(outH / 2 / 2) * 2 : outH;
  const fps = Number(settings.fps) || 30;
  const comparisonPaneFilters = (source, index, label) => {
    let srcW = Number(source.width);
    let srcH = Number(source.height);
    if (!srcW || !srcH) {
      const probed = probeDimensionsSync(source.path);
      if (probed) ({ width: srcW, height: srcH } = probed);
    }
    srcW = srcW || paneW;
    srcH = srcH || paneH;

    const sourceAspect = srcW / srcH;
    const paneAspect = paneW / paneH;
    let fitW;
    let fitH;
    if (sourceAspect > paneAspect) {
      fitW = paneW;
      fitH = paneW / sourceAspect;
    } else {
      fitH = paneH;
      fitW = paneH * sourceAspect;
    }
    const zoom = Math.max(1, Math.min(3, Number(source.zoom) || 1));
    const scaledW = Math.max(2, Math.round(fitW * zoom / 2) * 2);
    const scaledH = Math.max(2, Math.round(fitH * zoom / 2) * 2);
    const shiftedKeyframes = source.panAnimated && Array.isArray(source.panKeyframes) && source.panKeyframes.length
      ? source.panKeyframes
        .map((keyframe) => ({ ...keyframe, t: Number(keyframe.t) - (Number(source.start) - Number(source.trimStart || 0)) }))
        .sort((a, b) => a.t - b.t)
      : null;

    const axisPosition = (axis, paneSize, scaledSize) => {
      if (scaledSize <= paneSize) return ((paneSize - scaledSize) / 2).toFixed(2);
      if (shiftedKeyframes) {
        const center = buildPiecewiseExpr(shiftedKeyframes, axis, scaledSize);
        return `clip(${(paneSize / 2).toFixed(2)}-(${center}),${paneSize - scaledSize},0)`;
      }
      const fraction = Number(source[axis === 'x' ? 'zoomX' : 'zoomY']);
      const center = (Number.isFinite(fraction) ? fraction : 0.5) * scaledSize;
      return String(Math.max(paneSize - scaledSize, Math.min(0, paneSize / 2 - center)));
    };
    const x = axisPosition('x', paneW, scaledW);
    const y = axisPosition('y', paneH, scaledH);
    return [
      `color=c=black:s=${paneW}x${paneH}:r=${fps}:d=${duration.toFixed(3)}[${label}bg]`,
      `[${index}:v]setpts=PTS-STARTPTS,scale=${scaledW}:${scaledH},fps=${fps},format=yuv420p[${label}fg]`,
      `[${label}bg][${label}fg]overlay=x='${x}':y='${y}':shortest=1,setsar=1,format=yuv420p[${label}]`,
    ];
  };
  const filters = [
    ...comparisonPaneFilters(left, 0, 'cmp0'),
    ...comparisonPaneFilters(right, 1, 'cmp1'),
  ];
  filters.push(portrait ? '[cmp0][cmp1]vstack=inputs=2[vcmp]' : '[cmp0][cmp1]hstack=inputs=2[vcmp]');

  const audioMode = ['left', 'right', 'both', 'none'].includes(settings.audio) ? settings.audio : 'left';
  const audioFilter = (index, filePath, label) => {
    if (!hasAudioStream(filePath)) {
      return `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[${label}]`;
    }
    return `[${index}:a]atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `aformat=sample_rates=48000:channel_layouts=stereo[${label}]`;
  };
  if (audioMode === 'none') {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration.toFixed(3)}[acmp]`);
  } else if (audioMode === 'both') {
    filters.push(audioFilter(0, left.path, 'acmp0'));
    filters.push(audioFilter(1, right.path, 'acmp1'));
    filters.push('[acmp0][acmp1]amix=inputs=2:duration=shortest:normalize=1[acmp]');
  } else {
    const index = audioMode === 'right' ? 1 : 0;
    const source = audioMode === 'right' ? right : left;
    filters.push(audioFilter(index, source.path, 'acmp'));
  }

  const codecArgs = settings.codec === 'h265'
    ? ['-c:v', 'hevc_videotoolbox', '-q:v', '60', '-tag:v', 'hvc1']
    : ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-profile:v', 'high'];
  const args = [
    '-y',
    '-ss', String(left.start), '-t', String(duration), '-i', left.path,
    '-ss', String(right.start), '-t', String(duration), '-i', right.path,
    '-filter_complex', filters.join(';'),
    '-map', '[vcmp]', '-map', '[acmp]',
    ...codecArgs, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
    settings.outputPath,
  ];

  exportCancelled = false;
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    currentExportProc = proc;
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        mainWindow.webContents.send('export-progress', {
          progress: Math.min(seconds / duration, 1), seconds, totalDuration: duration,
        });
      }
    });
    proc.on('close', (code) => {
      currentExportProc = null;
      if (exportCancelled) {
        fs.unlink(settings.outputPath, () => {});
        reject(new Error('CANCELLED'));
      } else if (code === 0) {
        resolve({ success: true, outputPath: settings.outputPath });
      } else {
        reject(new Error(`比較書き出しに失敗しました (code ${code}):\n${stderr.slice(-2000)}`));
      }
    });
    proc.on('error', (error) => {
      currentExportProc = null;
      reject(error);
    });
  });
});

ipcMain.handle('cancel-export', async () => {
  if (currentExportProc) {
    exportCancelled = true;
    currentExportProc.kill('SIGKILL');
    return true;
  }
  return false;
});

function getDirSize(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        total += getDirSize(full);
      } else {
        total += fs.statSync(full).size;
      }
    } catch {
      // file disappeared mid-walk or unreadable — skip it
    }
  }
  return total;
}

// Clears this app's own Electron/Chromium cache (HTTP cache, GPU shader cache,
// compiled-JS code cache, local/session storage) — not video files, which the
// app never copies into its cache in the first place (exports write straight
// to the path the user picked).
ipcMain.handle('clear-cache', async () => {
  const userDataPath = app.getPath('userData');
  const before = getDirSize(userDataPath);
  clearProxyCache(previewProxiesDir());
  activePreviewProxyPaths.clear();
  cancelPreviewProxyEncodes();
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData();
  const after = getDirSize(userDataPath);
  return { freedBytes: Math.max(0, before - after) };
});

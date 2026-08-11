const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// Bundled in bin/ (with its dylib deps rewritten to @executable_path/libs via
// dylibbundler) so the app runs on any Mac without needing Homebrew installed —
// __dirname is the project root in dev and Contents/Resources/app when packaged
// (no asar), so this path resolves correctly in both cases.
const FFMPEG = path.join(__dirname, 'bin', 'ffmpeg');
const FFPROBE = path.join(__dirname, 'bin', 'ffprobe');

let mainWindow;
let currentExportProc = null;
let exportCancelled = false;

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

app.whenReady().then(createWindow);

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

  const baseSpeed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const tail = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`;

  if (!clip.speedSegments || !clip.speedSegments.length) {
    const speedFilter = baseSpeed !== 1 ? `setpts=PTS/${baseSpeed},` : '';
    return `[${i}:v]${pre}${speedFilter}${tail}`;
  }

  // Per-segment speed: crop once (a single continuous `t` timeline, so the
  // pan-keyframe math above is unaffected), then split that cropped stream
  // into one branch per speed segment, trim + retime each branch on its own,
  // and concatenate — same idea as manually cutting the clip into pieces and
  // setting a different speed per piece, just without fragmenting the
  // clip list.
  const trimDur = clip.trimEnd - clip.trimStart;
  const parts = partitionSpeedSegments(trimDur, clip.speedSegments, baseSpeed);
  const cropLabel = `vcrop${i}`;
  let graph = `[${i}:v]${pre}format=yuv420p[${cropLabel}]`;
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
  const tail = `aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`;

  if (!clip.speedSegments || !clip.speedSegments.length) {
    const speedFilter = baseSpeed !== 1 ? `${buildAtempoChain(baseSpeed)},` : '';
    return `[${i}:a]${speedFilter}${tail}`;
  }

  const trimDur = clip.trimEnd - clip.trimStart;
  const parts = partitionSpeedSegments(trimDur, clip.speedSegments, baseSpeed);
  const splitLabels = parts.map((_, idx) => `aseg${i}_${idx}`);
  let graph = `[${i}:a]asplit=${parts.length}${splitLabels.map((l) => `[${l}]`).join('')}`;
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
    const dur = Math.max(isCut ? 0.04 : t.duration, 0.04);
    const xfadeName = XFADE_NAMES[t.type] || 'fade';
    const offset = Math.max(cumulative - dur, 0);
    const nextV = `vx${i}`;
    const nextA = `ax${i}`;

    filters.push(
      `[${currentVLabel}][v${i}]xfade=transition=${xfadeName}:duration=${dur}:offset=${offset}[${nextV}]`
    );
    filters.push(`[${currentALabel}][a${i}]acrossfade=d=${dur}[${nextA}]`);

    currentVLabel = nextV;
    currentALabel = nextA;
    cumulative = cumulative + durations[i] - dur;
  }

  const filterComplex = filters.join(';');
  return { inputs, filterComplex, finalV: currentVLabel, finalA: currentALabel, totalDuration: cumulative };
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
        resolve({ success: true, outputPath: settings.outputPath });
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
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData();
  const after = getDirSize(userDataPath);
  return { freedBytes: Math.max(0, before - after) };
});

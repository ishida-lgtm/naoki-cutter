let clips = []; // { id, path, name, duration, width, height, trimStart, trimEnd }
let transitions = []; // length clips.length - 1, { type: 'cut'|'crossfade', duration }
let nextId = 1;
let exporting = false;
let selectedClipId = null;
let sequencePlaying = false;
let sequenceIndex = 0;
let dragHandle = null; // 'start' | 'end' | null

let historyStack = [];
let redoStack = [];

let shuttleDirection = 'stopped'; // 'stopped' | 'forward' | 'reverse'
let lPressCount = 0;
let jPressCount = 0;
let shuttleTimer = null;
const SHUTTLE_SPEEDS = [1, 2, 5, 10, 20];

const clipList = document.getElementById('clipList');
const dropZone = document.getElementById('dropZone');
const addFilesBtn = document.getElementById('addFilesBtn');
const exportBtn = document.getElementById('exportBtn');
const statusText = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const cancelExportBtn = document.getElementById('cancelExportBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const orientationSelect = document.getElementById('orientationSelect');
const qualitySelect = document.getElementById('qualitySelect');

const previewVideo = document.getElementById('previewVideo');
const previewEmpty = document.getElementById('previewEmpty');
const scrubber = document.getElementById('scrubber');
const scrubberRange = document.getElementById('scrubberRange');
const scrubberPlayhead = document.getElementById('scrubberPlayhead');
const handleStart = document.getElementById('handleStart');
const handleEnd = document.getElementById('handleEnd');
const playPauseBtn = document.getElementById('playPauseBtn');
const stepBackBtn = document.getElementById('stepBackBtn');
const stepForwardBtn = document.getElementById('stepForwardBtn');
const setInBtn = document.getElementById('setInBtn');
const setOutBtn = document.getElementById('setOutBtn');
const playAllBtn = document.getElementById('playAllBtn');
const exportSelectedBtn = document.getElementById('exportSelectedBtn');
const previewTime = document.getElementById('previewTime');
const previewVideoBox = document.getElementById('previewVideoBox');
const zoomSlider = document.getElementById('zoomSlider');
const zoomValue = document.getElementById('zoomValue');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const speedSelect = document.getElementById('speedSelect');
const speedSegStartBtn = document.getElementById('speedSegStartBtn');
const speedSegEndBtn = document.getElementById('speedSegEndBtn');
const speedSegPending = document.getElementById('speedSegPending');
const speedSegSpeed = document.getElementById('speedSegSpeed');
const speedSegAddBtn = document.getElementById('speedSegAddBtn');
const speedSegList = document.getElementById('speedSegList');
const panAnimatedToggle = document.getElementById('panAnimatedToggle');
const addKeyframeBtn = document.getElementById('addKeyframeBtn');
const removeKeyframeBtn = document.getElementById('removeKeyframeBtn');
const autoTrackBtn = document.getElementById('autoTrackBtn');
const keyframeMarkers = document.getElementById('keyframeMarkers');
const kfStrip = document.getElementById('kfStrip');
const kfStripMarkers = document.getElementById('kfStripMarkers');
const kfStripPlayhead = document.getElementById('kfStripPlayhead');
const bulkTransitionType = document.getElementById('bulkTransitionType');
const bulkTransitionDuration = document.getElementById('bulkTransitionDuration');
const applyBulkTransitionBtn = document.getElementById('applyBulkTransitionBtn');

const timelineWrap = document.getElementById('timelineWrap');
const timelineRuler = document.getElementById('timelineRuler');
const timelineTrack = document.getElementById('timelineTrack');
const timelinePlayhead = document.getElementById('timelinePlayhead');
let PX_PER_SEC = 15;
const PX_PER_SEC_MIN = 2;
const PX_PER_SEC_MAX = 150;
const TL_MARKER_WIDTH = 6;

function fmt(sec) {
  return Number(sec).toFixed(2);
}

function fmtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function selectedClip() {
  return clips.find((c) => c.id === selectedClipId) || null;
}

// ---- Undo / Redo ----

function snapshotState() {
  return JSON.parse(JSON.stringify({ clips, transitions }));
}

function pushHistory() {
  historyStack.push(snapshotState());
  if (historyStack.length > 50) historyStack.shift();
  redoStack = [];
}

function restoreState(state) {
  clips = state.clips;
  transitions = state.transitions;
  if (selectedClipId && !clips.find((c) => c.id === selectedClipId)) {
    selectedClipId = null;
    sequencePlaying = false;
    loadedPath = null;
    stopShuttleTimer();
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewEmpty.style.display = 'flex';
    [playPauseBtn, stepBackBtn, stepForwardBtn, setInBtn, setOutBtn, playAllBtn, zoomSlider, zoomResetBtn, exportSelectedBtn, panAnimatedToggle, addKeyframeBtn, removeKeyframeBtn, autoTrackBtn, speedSelect, speedSegStartBtn, speedSegEndBtn, speedSegSpeed, speedSegAddBtn].forEach((b) => (b.disabled = true));
    syncZoomUI();
  }
  render();
  if (selectedClipId) updateScrubberUI();
}

function undo() {
  if (!historyStack.length) return;
  redoStack.push(snapshotState());
  restoreState(historyStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  historyStack.push(snapshotState());
  restoreState(redoStack.pop());
}

async function addFilePaths(paths) {
  pushHistory();
  const wasEmpty = clips.length === 0;
  let firstAdded = null;
  for (const p of paths) {
    try {
      const info = await window.api.probeInfo(p);
      const clip = {
        id: nextId++,
        path: p,
        name: p.split('/').pop(),
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps || 30,
        trimStart: 0,
        trimEnd: info.duration,
        zoom: 1,
        zoomX: 0.5,
        zoomY: 0.5,
        panAnimated: false,
        panKeyframes: [],
        speed: 1,
        speedSegments: [],
      };
      clips.push(clip);
      if (!firstAdded) firstAdded = clip;
      if (clips.length > 1) transitions.push({ type: 'cut', duration: 0.5 });
    } catch (e) {
      statusText.textContent = `読み込み失敗: ${p.split('/').pop()} (${e.message})`;
    }
  }
  if (wasEmpty && firstAdded) {
    orientationSelect.value = firstAdded.height > firstAdded.width ? 'portrait' : 'landscape';
    updatePreviewBoxAspect();
  }
  render();
  if (!selectedClipId && firstAdded) selectClip(firstAdded.id);
}

addFilesBtn.addEventListener('click', async () => {
  const paths = await window.api.selectFiles();
  if (paths && paths.length) addFilePaths(paths);
});

['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });
});
dropZone.addEventListener('drop', (e) => {
  const paths = Array.from(e.dataTransfer.files)
    .map((f) => window.api.getPathForFile(f))
    .filter(Boolean);
  if (paths.length) addFilePaths(paths);
});

// Timeline blocks have their own draggable=true reorder handlers (dragover/drop
// with stopPropagation), so an OS file drop is handled in the capture phase here —
// runs before those, only reacts to actual file drags (checked via dataTransfer
// types/files), and never interferes with internal clip reordering.
timelineWrap.addEventListener(
  'dragover',
  (e) => {
    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      timelineWrap.classList.add('dragover');
    }
  },
  true
);
timelineWrap.addEventListener(
  'dragleave',
  (e) => {
    if (e.target === timelineWrap) timelineWrap.classList.remove('dragover');
  },
  true
);
timelineWrap.addEventListener(
  'drop',
  (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      e.stopPropagation();
      timelineWrap.classList.remove('dragover');
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.api.getPathForFile(f))
        .filter(Boolean);
      if (paths.length) addFilePaths(paths);
    }
  },
  true
);

function removeClip(id) {
  const idx = clips.findIndex((c) => c.id === id);
  if (idx === -1) return;
  pushHistory();
  clips.splice(idx, 1);
  if (transitions.length) transitions.splice(Math.max(idx - 1, 0), 1);
  if (selectedClipId === id) {
    sequencePlaying = false;
    selectedClipId = null;
    loadedPath = null;
    stopShuttleTimer();
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewEmpty.style.display = 'flex';
    [playPauseBtn, stepBackBtn, stepForwardBtn, setInBtn, setOutBtn, playAllBtn, zoomSlider, zoomResetBtn, exportSelectedBtn, panAnimatedToggle, addKeyframeBtn, removeKeyframeBtn, autoTrackBtn, speedSelect, speedSegStartBtn, speedSegEndBtn, speedSegSpeed, speedSegAddBtn].forEach((b) => (b.disabled = true));
    syncZoomUI();
  }
  render();
}

function joinWithNext(i) {
  const front = clips[i];
  const back = clips[i + 1];
  if (!front || !back || front.path !== back.path) return;
  pushHistory();
  front.trimEnd = back.trimEnd;
  clips.splice(i + 1, 1);
  transitions.splice(i, 1);
  if (selectedClipId === back.id) {
    selectedClipId = front.id;
  }
  render();
  if (selectedClipId === front.id) updateScrubberUI();
}

applyBulkTransitionBtn.addEventListener('click', () => {
  if (!transitions.length) return;
  pushHistory();
  const type = bulkTransitionType.value;
  const duration = Math.max(0.1, parseFloat(bulkTransitionDuration.value) || 0.5);
  transitions.forEach((t) => {
    t.type = type;
    if (type !== 'cut') t.duration = duration;
  });
  render();
});

let dragSrcIndex = null;

function render() {
  clipList.innerHTML = '';

  clips.forEach((clip, i) => {
    const li = document.createElement('li');
    li.className = 'clip-item' + (clip.id === selectedClipId ? ' selected' : '');
    li.draggable = true;
    li.dataset.index = i;

    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      sequencePlaying = false;
      selectClip(clip.id);
    });

    li.addEventListener('dragstart', () => {
      dragSrcIndex = i;
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      pushHistory();
      const [moved] = clips.splice(dragSrcIndex, 1);
      clips.splice(i, 0, moved);
      dragSrcIndex = null;
      render();
    });

    const row1 = document.createElement('div');
    row1.className = 'row1';
    row1.innerHTML = `<span class="clip-name">${i + 1}. ${clip.name}</span>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => removeClip(clip.id));
    row1.appendChild(delBtn);

    const trimRow = document.createElement('div');
    trimRow.className = 'trim-row';
    trimRow.innerHTML = `
      <span>開始</span>
      <input type="number" min="0" step="0.1" value="${fmt(clip.trimStart)}" data-field="trimStart" />
      <span>終了</span>
      <input type="number" min="0" step="0.1" value="${fmt(clip.trimEnd)}" data-field="trimEnd" />
      <span>/ 全長 ${fmt(clip.duration)}s</span>
    `;
    trimRow.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', (e) => {
        pushHistory();
        const field = e.target.dataset.field;
        let val = parseFloat(e.target.value);
        if (Number.isNaN(val)) val = field === 'trimStart' ? 0 : clip.duration;
        val = Math.max(0, Math.min(val, clip.duration));
        clip[field] = val;
        if (clip.trimStart >= clip.trimEnd) {
          if (field === 'trimStart') clip.trimStart = Math.max(0, clip.trimEnd - 0.1);
          else clip.trimEnd = Math.min(clip.duration, clip.trimStart + 0.1);
        }
        render();
        if (clip.id === selectedClipId) updateScrubberUI();
      });
    });

    li.appendChild(row1);
    li.appendChild(trimRow);
    clipList.appendChild(li);
    if (clip.id === selectedClipId) {
      li.scrollIntoView({ block: 'nearest' });
    }

    if (i < clips.length - 1) {
      const t = transitions[i];
      const canJoin = clips[i].path === clips[i + 1].path;
      const tRow = document.createElement('div');
      tRow.className = 'transition-row';
      tRow.innerHTML = `
        <span>⇩ つなぎ目</span>
        <select data-idx="${i}" class="t-type">
          <option value="cut" ${t.type === 'cut' ? 'selected' : ''}>カット</option>
          <option value="crossfade" ${t.type === 'crossfade' ? 'selected' : ''}>クロスフェード</option>
          <option value="dissolve" ${t.type === 'dissolve' ? 'selected' : ''}>ディゾルブ</option>
        </select>
        <input type="number" min="0.1" step="0.1" value="${t.duration}" class="t-duration" ${t.type === 'cut' ? 'disabled' : ''} />
        <span>秒</span>
        ${canJoin ? '<button class="join-btn">🔗 結合</button>' : ''}
      `;
      tRow.querySelector('.t-type').addEventListener('change', (e) => {
        pushHistory();
        transitions[i].type = e.target.value;
        render();
      });
      tRow.querySelector('.t-duration').addEventListener('change', (e) => {
        pushHistory();
        transitions[i].duration = Math.max(0.1, parseFloat(e.target.value) || 0.5);
      });
      const joinBtn = tRow.querySelector('.join-btn');
      if (joinBtn) joinBtn.addEventListener('click', () => joinWithNext(i));
      clipList.appendChild(tRow);
    }
  });

  exportBtn.disabled = clips.length === 0 || exporting;
  exportSelectedBtn.disabled = !selectedClipId || exporting;
  renderTimeline();
}

// ---- Horizontal timeline strip ----

function computeTimelineLayout() {
  const layout = [];
  let x = 0;
  clips.forEach((clip, i) => {
    // `dur` is source (trim) time — what previewVideo.currentTime is measured in.
    // Block width instead reflects the clip's OUTPUT duration (dur/speed), so a
    // slow-motion clip visually takes up the extra timeline space it actually
    // plays for. The two are only proportional, not equal, when speed != 1.
    const dur = Math.max(clip.trimEnd - clip.trimStart, 0.05);
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const outputDur = dur / speed;
    const width = Math.max(outputDur * PX_PER_SEC, 6);
    layout.push({ clip, x, width, dur, outputDur });
    x += width;
    if (i < clips.length - 1) x += TL_MARKER_WIDTH;
  });
  return { layout, totalWidth: x };
}

function renderRuler(totalWidthPx) {
  timelineRuler.innerHTML = '';
  timelineRuler.style.width = `${Math.max(totalWidthPx, 1)}px`;
  if (totalWidthPx <= 0) return;
  const totalSec = totalWidthPx / PX_PER_SEC;
  const step = totalSec > 240 ? 30 : totalSec > 90 ? 10 : totalSec > 30 ? 5 : 2;
  for (let s = 0; s <= totalSec; s += step) {
    const mark = document.createElement('div');
    mark.className = 'tl-ruler-mark';
    mark.style.left = `${s * PX_PER_SEC}px`;
    mark.textContent = fmtTime(s);
    timelineRuler.appendChild(mark);
  }
}

function renderTimeline() {
  timelineTrack.innerHTML = '';
  const { layout, totalWidth } = computeTimelineLayout();

  if (!layout.length) {
    const hint = document.createElement('div');
    hint.className = 'tl-empty-hint';
    hint.textContent = 'クリップを追加するとここにタイムラインが表示されます';
    timelineTrack.appendChild(hint);
    renderRuler(0);
    timelinePlayhead.style.display = 'none';
    return;
  }

  layout.forEach((item, i) => {
    const block = document.createElement('div');
    block.className = 'tl-clip' + (item.clip.id === selectedClipId ? ' selected' : '');
    block.style.width = `${item.width}px`;
    block.title = `${item.clip.name}\n${fmtTime(item.dur)}\n（ドラッグで並べ替え）`;
    block.textContent = String(i + 1);
    block.draggable = true;
    block.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      dragSrcIndex = i;
      block.classList.add('dragging');
    });
    block.addEventListener('dragend', () => block.classList.remove('dragging'));
    block.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      block.classList.add('drag-over');
    });
    block.addEventListener('dragleave', () => block.classList.remove('drag-over'));
    block.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      block.classList.remove('drag-over');
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      pushHistory();
      const [moved] = clips.splice(dragSrcIndex, 1);
      clips.splice(i, 0, moved);
      dragSrcIndex = null;
      render();
    });
    timelineTrack.appendChild(block);

    if (i < layout.length - 1) {
      const t = transitions[i];
      const marker = document.createElement('div');
      marker.className = `tl-transition tl-transition-${t.type}`;
      marker.title =
        t.type === 'cut' ? 'カット' : `${t.type === 'dissolve' ? 'ディゾルブ' : 'クロスフェード'}（${t.duration}秒）`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const rows = document.querySelectorAll('.transition-row');
        if (rows[i]) rows[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      timelineTrack.appendChild(marker);
    }
  });

  renderRuler(totalWidth);
  updateTimelinePlayhead();
}

timelineTrack.addEventListener('click', (e) => {
  if (e.target.classList.contains('tl-transition')) return;
  const rect = timelineTrack.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const { layout } = computeTimelineLayout();
  for (const item of layout) {
    if (x >= item.x && x <= item.x + item.width) {
      sequencePlaying = false;
      const frac = Math.min(1, Math.max(0, (x - item.x) / item.width));
      const localSec = frac * item.dur;
      selectClip(item.clip.id, { seekTo: item.clip.trimStart + localSec });
      break;
    }
  }
});

// Trackpad pinch is delivered as a 'wheel' event with ctrlKey set by Chromium/Electron.
// Without preventDefault it would trigger the window's native page-zoom instead.
timelineWrap.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!clips.length) return;

    const rect = timelineWrap.getBoundingClientRect();
    const pointerX = e.clientX - rect.left + timelineWrap.scrollLeft;
    const oldPx = PX_PER_SEC;
    const zoomFactor = Math.exp(-e.deltaY * 0.01);
    PX_PER_SEC = Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, PX_PER_SEC * zoomFactor));
    if (PX_PER_SEC === oldPx) return;

    renderTimeline();
    const scale = PX_PER_SEC / oldPx;
    timelineWrap.scrollLeft = pointerX * scale - (e.clientX - rect.left);
  },
  { passive: false }
);

function updateTimelinePlayhead() {
  const clip = selectedClip();
  if (!clip) {
    timelinePlayhead.style.display = 'none';
    return;
  }
  const { layout } = computeTimelineLayout();
  const item = layout.find((l) => l.clip.id === clip.id);
  if (!item) {
    timelinePlayhead.style.display = 'none';
    return;
  }
  const within = Math.max(0, Math.min(item.dur, (previewVideo.currentTime || clip.trimStart) - clip.trimStart));
  const frac = item.dur > 0 ? within / item.dur : 0;
  const x = item.x + frac * item.width;
  timelinePlayhead.style.display = 'block';
  timelinePlayhead.style.left = `${x}px`;

  const visibleLeft = timelineWrap.scrollLeft;
  const visibleRight = visibleLeft + timelineWrap.clientWidth;
  if (x < visibleLeft + 20 || x > visibleRight - 20) {
    timelineWrap.scrollLeft = Math.max(0, x - timelineWrap.clientWidth / 2);
  }
}

// ---- Preview player ----

let loadedPath = null;

function selectClip(id, { autoplay = false, keepPlayback = false, seekTo = null } = {}) {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return;
  const samePath = loadedPath === clip.path;
  const target = seekTo != null ? Math.max(clip.trimStart, Math.min(clip.trimEnd, seekTo)) : clip.trimStart;
  selectedClipId = id;
  previewEmpty.style.display = 'none';
  [playPauseBtn, stepBackBtn, stepForwardBtn, setInBtn, setOutBtn, playAllBtn, zoomSlider, zoomResetBtn, exportSelectedBtn, panAnimatedToggle, addKeyframeBtn, removeKeyframeBtn, autoTrackBtn, speedSelect, speedSegStartBtn, speedSegEndBtn, speedSegSpeed, speedSegAddBtn].forEach((b) => (b.disabled = false));
  pendingSegStart = null;
  pendingSegEnd = null;
  updateSpeedSegPendingLabel();
  syncZoomUI();

  if (keepPlayback && samePath && seekTo == null) {
    // Same underlying file, mid-playback blade cut: retarget selection only,
    // don't touch currentTime/src so playback continues uninterrupted.
    render();
    updateScrubberUI();
    updatePlayLabel();
    return;
  }

  if (samePath) {
    // Same file already loaded (e.g. the other half of a split clip) — 'loadedmetadata'
    // won't refire for an unchanged src, so reposition directly instead of waiting for it.
    stopShuttleTimer();
    resetShuttle();
    previewVideo.currentTime = target;
    updateScrubberUI();
    if (autoplay) {
      shuttleDirection = 'forward';
      lPressCount = 1;
      previewVideo.playbackRate = clip.speed || 1;
      previewVideo.play();
    }
    render();
    updatePlayLabel();
    return;
  }

  stopShuttleTimer();
  resetShuttle();
  loadedPath = clip.path;
  previewVideo.src = 'file://' + encodeURI(clip.path);
  previewVideo.onloadedmetadata = () => {
    previewVideo.currentTime = target;
    updateScrubberUI();
    if (autoplay) {
      shuttleDirection = 'forward';
      lPressCount = 1;
      previewVideo.playbackRate = clip.speed || 1;
      previewVideo.play();
    }
  };
  render();
  updateScrubberUI();
  updatePlayLabel();
}

function updateScrubberUI() {
  const clip = selectedClip();
  if (!clip) return;
  const dur = clip.duration || 1;
  const startPct = (clip.trimStart / dur) * 100;
  const endPct = (clip.trimEnd / dur) * 100;
  scrubberRange.style.left = `${startPct}%`;
  scrubberRange.style.right = `${100 - endPct}%`;
  handleStart.style.left = `${startPct}%`;
  handleEnd.style.left = `${endPct}%`;
  const cur = previewVideo.currentTime || 0;
  scrubberPlayhead.style.left = `${(cur / dur) * 100}%`;
  previewTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  const trimDur = Math.max(clip.trimEnd - clip.trimStart, 0.001);
  const localCur = Math.max(0, Math.min(trimDur, cur - clip.trimStart));
  kfStripPlayhead.style.left = `${(localCur / trimDur) * 100}%`;
  updateTimelinePlayhead();
}

// ---- Zoom (crop-in) + keyframed pan ----

function getLocalT(clip) {
  return previewVideo.currentTime - clip.trimStart;
}

// Catmull-Rom / cardinal Hermite interpolation across sorted keyframes: each
// keyframe's tangent is estimated from its neighbors (central difference, with
// one-sided differences at the ends), so segments curve smoothly through the
// points instead of connecting them with straight lines. Plain linear
// interpolation cuts corners on a real subject's non-linear path (e.g. a surfer
// accelerating off a wave) — worst at the midpoint of a gap between keyframes,
// which is exactly where pan-tracking drift kept showing up. Must match
// buildPiecewiseExpr in main.js so the preview and the export agree.
function catmullRomTangents(kfs, key) {
  const n = kfs.length;
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) m[i] = (kfs[1][key] - kfs[0][key]) / (kfs[1].t - kfs[0].t);
    else if (i === n - 1) m[i] = (kfs[n - 1][key] - kfs[n - 2][key]) / (kfs[n - 1].t - kfs[n - 2].t);
    else m[i] = (kfs[i + 1][key] - kfs[i - 1][key]) / (kfs[i + 1].t - kfs[i - 1].t);
  }
  return m;
}

function hermiteInterp(kfs, key, localT) {
  const n = kfs.length;
  if (n === 1 || localT <= kfs[0].t) return kfs[0][key];
  const last = kfs[n - 1];
  if (localT >= last.t) return last[key];
  const m = catmullRomTangents(kfs, key);
  for (let i = 0; i < n - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (localT >= a.t && localT <= b.t) {
      const dt = b.t - a.t || 0.0001;
      const u = (localT - a.t) / dt;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      return h00 * a[key] + h10 * dt * m[i] + h01 * b[key] + h11 * dt * m[i + 1];
    }
  }
  return last[key];
}

// Falls back to the clip's static zoomX/zoomY when animation is off or there
// are no keyframes yet.
function getEffectivePan(clip, localT) {
  const kfs = clip.panAnimated && clip.panKeyframes && clip.panKeyframes.length ? clip.panKeyframes : null;
  if (!kfs) return { x: clip.zoomX != null ? clip.zoomX : 0.5, y: clip.zoomY != null ? clip.zoomY : 0.5 };
  return { x: hermiteInterp(kfs, 'x', localT), y: hermiteInterp(kfs, 'y', localT) };
}

function upsertKeyframeAt(clip, localT, x, y) {
  if (!clip.panKeyframes) clip.panKeyframes = [];
  const t = Math.max(0, localT);
  const existing = clip.panKeyframes.find((k) => Math.abs(k.t - t) < 0.15);
  if (existing) {
    existing.x = x;
    existing.y = y;
  } else {
    clip.panKeyframes.push({ t, x, y });
    clip.panKeyframes.sort((a, b) => a.t - b.t);
  }
}

// The preview box's aspect ratio is fixed to whatever orientation is currently
// selected for export, so mismatched footage (e.g. a 16:9 clip going to a 9:16
// export) already renders letterboxed under object-fit:contain. getAutoFitScale
// computes how much extra CSS scale is needed to make that fill the box instead —
// same "auto-fit crop first, then clip.zoom crops in further" baseline main.js
// uses for the actual export, kept as one combined transform for accurate WYSIWYG.
function getAutoFitScale(clip) {
  if (!clip.width || !clip.height) return 1;
  const videoAspect = clip.width / clip.height;
  const boxAspect = orientationSelect.value === 'portrait' ? 9 / 16 : 16 / 9;
  return videoAspect > boxAspect ? videoAspect / boxAspect : boxAspect / videoAspect;
}

// A tall (9:16) box at full panel width would be far taller than the window,
// pushing the timeline below it off-screen since the whole preview area is
// sticky. Cap the box height to a share of the window instead and derive width
// from that, so a vertical export just shows a narrower centered preview —
// same as how real NLEs preview vertical footage in a wide window.
function updatePreviewBoxAspect() {
  const ratio = orientationSelect.value === 'portrait' ? 9 / 16 : 16 / 9;
  const parent = previewVideoBox.parentElement;
  const parentStyle = getComputedStyle(parent);
  const availWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
  const maxHeight = window.innerHeight * 0.42;

  let boxWidth = availWidth;
  let boxHeight = boxWidth / ratio;
  if (boxHeight > maxHeight) {
    boxHeight = maxHeight;
    boxWidth = boxHeight * ratio;
  }
  previewVideoBox.style.width = `${Math.round(boxWidth)}px`;
  previewVideoBox.style.height = `${Math.round(boxHeight)}px`;
}
window.addEventListener('resize', updatePreviewBoxAspect);

function applyPreviewZoom() {
  const clip = selectedClip();
  if (!clip) {
    previewVideo.style.transform = 'none';
    return;
  }
  const totalScale = getAutoFitScale(clip) * (clip.zoom || 1);
  const pan = getEffectivePan(clip, getLocalT(clip));
  previewVideo.style.transformOrigin = `${pan.x * 100}% ${pan.y * 100}%`;
  previewVideo.style.transform = totalScale > 1.001 ? `scale(${totalScale})` : 'none';
}

function renderKeyframeMarkers() {
  keyframeMarkers.innerHTML = '';
  kfStripMarkers.innerHTML = '';
  const clip = selectedClip();
  if (!clip) {
    kfStrip.classList.add('hidden');
    return;
  }
  const dur = clip.duration || 1;
  const trimDur = Math.max(clip.trimEnd - clip.trimStart, 0.001);
  const hasKfs = clip.panAnimated && clip.panKeyframes && clip.panKeyframes.length;
  kfStrip.classList.toggle('hidden', !clip.panAnimated);
  if (!hasKfs) return;
  clip.panKeyframes.forEach((kf) => {
    const absT = clip.trimStart + kf.t;

    const dot = document.createElement('div');
    dot.className = 'keyframe-marker';
    dot.style.left = `${(absT / dur) * 100}%`;
    dot.title = fmtTime(absT);
    dot.addEventListener('mousedown', (e) => e.stopPropagation());
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      previewVideo.currentTime = absT;
      updateScrubberUI();
    });
    keyframeMarkers.appendChild(dot);

    const stripDot = document.createElement('div');
    stripDot.className = 'kf-strip-marker';
    stripDot.style.left = `${(kf.t / trimDur) * 100}%`;
    stripDot.title = fmtTime(absT);
    stripDot.addEventListener('mousedown', (e) => e.stopPropagation());
    stripDot.addEventListener('click', (e) => {
      e.stopPropagation();
      previewVideo.currentTime = absT;
      updateScrubberUI();
    });
    kfStripMarkers.appendChild(stripDot);
  });
}

function syncZoomUI() {
  const clip = selectedClip();
  const zoom = clip ? clip.zoom || 1 : 1;
  zoomSlider.value = zoom;
  zoomValue.textContent = `${zoom.toFixed(1)}x`;
  panAnimatedToggle.checked = !!(clip && clip.panAnimated);
  speedSelect.value = String(clip ? clip.speed || 1 : 1);
  applyPreviewZoom();
  renderKeyframeMarkers();
  renderSpeedSegList();
}

// ---- Per-segment speed (speed ramping within a single clip) ----

let pendingSegStart = null;
let pendingSegEnd = null;

function updateSpeedSegPendingLabel() {
  const fmtOrDash = (v) => (v == null ? '--:--' : fmtTime(v));
  speedSegPending.textContent = `開始 ${fmtOrDash(pendingSegStart)} → 終了 ${fmtOrDash(pendingSegEnd)}`;
}
updateSpeedSegPendingLabel();

function renderSpeedSegList() {
  speedSegList.innerHTML = '';
  const clip = selectedClip();
  if (!clip || !clip.speedSegments || !clip.speedSegments.length) return;
  [...clip.speedSegments]
    .sort((a, b) => a.start - b.start)
    .forEach((seg) => {
      const li = document.createElement('li');
      li.className = 'speed-seg-item';
      li.innerHTML = `<span>${fmtTime(seg.start)} 〜 ${fmtTime(seg.end)}：${seg.speed}倍</span>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => {
        pushHistory();
        clip.speedSegments = clip.speedSegments.filter((s) => s !== seg);
        renderSpeedSegList();
      });
      li.appendChild(delBtn);
      speedSegList.appendChild(li);
    });
}

speedSegStartBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  pendingSegStart = getLocalT(clip);
  updateSpeedSegPendingLabel();
});

speedSegEndBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  pendingSegEnd = getLocalT(clip);
  updateSpeedSegPendingLabel();
});

speedSegAddBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  if (pendingSegStart == null || pendingSegEnd == null) {
    statusText.textContent = '区間の開始点と終了点を先に設定してください';
    return;
  }
  const start = Math.min(pendingSegStart, pendingSegEnd);
  const end = Math.max(pendingSegStart, pendingSegEnd);
  if (end - start < 0.1) {
    statusText.textContent = '区間が短すぎます';
    return;
  }
  pushHistory();
  if (!clip.speedSegments) clip.speedSegments = [];
  clip.speedSegments.push({ start, end, speed: Number(speedSegSpeed.value) });
  pendingSegStart = null;
  pendingSegEnd = null;
  updateSpeedSegPendingLabel();
  renderSpeedSegList();
  statusText.textContent = `${fmtTime(start)} 〜 ${fmtTime(end)} を${speedSegSpeed.value}倍に設定しました`;
});

speedSelect.addEventListener('change', () => {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  clip.speed = parseFloat(speedSelect.value);
});

zoomSlider.addEventListener('mousedown', () => {
  if (selectedClip()) pushHistory();
});
zoomSlider.addEventListener('input', () => {
  const clip = selectedClip();
  if (!clip) return;
  clip.zoom = parseFloat(zoomSlider.value);
  zoomValue.textContent = `${clip.zoom.toFixed(1)}x`;
  applyPreviewZoom();
});

zoomResetBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  clip.zoom = 1;
  clip.zoomX = 0.5;
  clip.zoomY = 0.5;
  clip.panAnimated = false;
  clip.panKeyframes = [];
  syncZoomUI();
});

panAnimatedToggle.addEventListener('change', () => {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  clip.panAnimated = panAnimatedToggle.checked;
  renderKeyframeMarkers();
  applyPreviewZoom();
});

addKeyframeBtn.addEventListener('click', async () => {
  const clip = selectedClip();
  if (!clip) return;
  addKeyframeBtn.disabled = true;
  await waitForFrameSettled();
  addKeyframeBtn.disabled = false;
  if (selectedClip() !== clip) return; // selection changed while we waited
  pushHistory();
  if (!clip.panAnimated) clip.panAnimated = true;
  const localT = getLocalT(clip);
  const pan = getEffectivePan(clip, localT);
  upsertKeyframeAt(clip, localT, pan.x, pan.y);
  syncZoomUI();
  statusText.textContent = `${fmtTime(previewVideo.currentTime)} にキーフレームを追加しました`;
});

removeKeyframeBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip || !clip.panKeyframes || !clip.panKeyframes.length) return;
  const localT = getLocalT(clip);
  let nearestIdx = 0;
  let nearestDist = Infinity;
  clip.panKeyframes.forEach((k, i) => {
    const d = Math.abs(k.t - localT);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  });
  pushHistory();
  clip.panKeyframes.splice(nearestIdx, 1);
  syncZoomUI();
});

// Panning while already zoomed: a click position is a fraction of the *displayed*
// (already-transformed) box, not the source frame, so it has to be mapped back
// through the current zoom/origin — otherwise repositioning drifts wrong once
// zoom != 1. Dragging pans continuously using the same inverse-transform math.
// When keyframe animation is on, both write to the keyframe nearest the playhead
// (creating one there if needed) instead of the clip's static pan.
let panDrag = null;
let dragJustHappened = false;
let trackModeActive = false;

autoTrackBtn.addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  if (trackModeActive) {
    trackModeActive = false;
    previewVideoBox.classList.remove('track-select-mode');
    statusText.textContent = '';
    return;
  }
  trackModeActive = true;
  previewVideoBox.classList.add('track-select-mode');
  statusText.textContent = '追跡したい被写体を映像内でクリックしてください';
});

previewVideoBox.addEventListener('mousedown', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  if (seekPending) {
    statusText.textContent = '映像の読み込み中です。少し待ってからもう一度クリックしてください';
    return;
  }
  const start = getEffectivePan(clip, getLocalT(clip));
  panDrag = {
    startX: e.clientX,
    startY: e.clientY,
    startZoomX: start.x,
    startZoomY: start.y,
    pushed: false,
  };
});

document.addEventListener('mousemove', (e) => {
  if (!panDrag) return;
  const clip = selectedClip();
  if (!clip) {
    panDrag = null;
    return;
  }
  const rect = previewVideoBox.getBoundingClientRect();
  const dx = (e.clientX - panDrag.startX) / rect.width;
  const dy = (e.clientY - panDrag.startY) / rect.height;
  if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) return;

  dragJustHappened = true;
  if (!panDrag.pushed) {
    pushHistory();
    panDrag.pushed = true;
  }
  const zoom = getAutoFitScale(clip) * (clip.zoom || 1);
  const nx = Math.min(1, Math.max(0, panDrag.startZoomX - dx / zoom));
  const ny = Math.min(1, Math.max(0, panDrag.startZoomY - dy / zoom));
  if (clip.panAnimated) {
    upsertKeyframeAt(clip, getLocalT(clip), nx, ny);
    renderKeyframeMarkers();
  } else {
    clip.zoomX = nx;
    clip.zoomY = ny;
  }
  applyPreviewZoom();
});

document.addEventListener('mouseup', () => {
  panDrag = null;
});

previewVideoBox.addEventListener('click', (e) => {
  if (dragJustHappened) {
    dragJustHappened = false;
    return;
  }
  const clip = selectedClip();
  if (!clip) return;
  if (seekPending) {
    statusText.textContent = '映像の読み込み中です。少し待ってからもう一度クリックしてください';
    return;
  }
  const rect = previewVideoBox.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  const zoom = getAutoFitScale(clip) * (clip.zoom || 1);
  const prev = getEffectivePan(clip, getLocalT(clip));
  const nx = Math.min(1, Math.max(0, prev.x + (fx - prev.x) / zoom));
  const ny = Math.min(1, Math.max(0, prev.y + (fy - prev.y) / zoom));

  if (trackModeActive) {
    trackModeActive = false;
    previewVideoBox.classList.remove('track-select-mode');
    runAutoTrack(clip, nx, ny);
    return;
  }

  pushHistory();
  if (clip.panAnimated) {
    upsertKeyframeAt(clip, getLocalT(clip), nx, ny);
    renderKeyframeMarkers();
  } else {
    clip.zoomX = nx;
    clip.zoomY = ny;
  }
  applyPreviewZoom();
});

async function runAutoTrack(clip, seedX, seedY) {
  pushHistory();
  const seedLocalT = getLocalT(clip);
  autoTrackBtn.disabled = true;
  statusText.textContent = '追跡中…';
  try {
    const result = await window.api.trackSubject({
      path: clip.path,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      srcW: clip.width,
      srcH: clip.height,
      seedLocalT,
      seedX,
      seedY,
    });
    if (!result || !result.ok) {
      statusText.textContent = `追跡に失敗しました: ${(result && result.error) || '不明なエラー'}`;
      return;
    }
    clip.panAnimated = true;
    clip.panKeyframes = result.keyframes;
    syncZoomUI();
    statusText.textContent = `追跡完了：${result.keyframes.length}個のキーフレームを生成しました`;
  } catch (e) {
    statusText.textContent = `追跡に失敗しました: ${e.message}`;
  } finally {
    autoTrackBtn.disabled = false;
  }
}

previewVideo.addEventListener('timeupdate', () => {
  updateScrubberUI();
  applyPreviewZoom();
  const clip = selectedClip();
  if (!clip) return;

  if (sequencePlaying) {
    if (previewVideo.currentTime >= clips[sequenceIndex].trimEnd - 0.02) {
      sequenceIndex++;
      if (sequenceIndex < clips.length) {
        selectClip(clips[sequenceIndex].id, { autoplay: true });
      } else {
        sequencePlaying = false;
        previewVideo.pause();
      }
    }
  } else if (previewVideo.currentTime >= clip.trimEnd - 0.02 && !previewVideo.paused) {
    previewVideo.pause();
    previewVideo.playbackRate = clip.speed || 1;
    resetShuttle();
    updatePlayLabel();
    previewVideo.currentTime = clip.trimStart;
  }
});

// ---- Shuttle playback (Space / J / K / L) ----

function stopShuttleTimer() {
  if (shuttleTimer) {
    clearInterval(shuttleTimer);
    shuttleTimer = null;
  }
}

function resetShuttle() {
  shuttleDirection = 'stopped';
  lPressCount = 0;
  jPressCount = 0;
}

function updatePlayLabel() {
  if (shuttleDirection === 'forward' && (shuttleTimer || !previewVideo.paused)) {
    const rate = SHUTTLE_SPEEDS[(lPressCount - 1) % SHUTTLE_SPEEDS.length] || 1;
    playPauseBtn.textContent = rate === 1 ? '⏸ 一時停止' : `⏸ 一時停止（${rate}倍速）`;
  } else if (shuttleDirection === 'reverse' && shuttleTimer) {
    const rate = SHUTTLE_SPEEDS[(jPressCount - 1) % SHUTTLE_SPEEDS.length] || 1;
    playPauseBtn.textContent = `⏸ 一時停止（逆${rate}倍速）`;
  } else {
    playPauseBtn.textContent = '▶ 再生';
  }
}

previewVideo.addEventListener('play', updatePlayLabel);
previewVideo.addEventListener('pause', updatePlayLabel);

// A fast scrub/click-seek on 4K source footage can leave `currentTime` already
// reporting the target time while the actual decoded frame hasn't painted yet.
// Reading position for a keyframe in that window silently records wherever the
// subject was in the STALE frame, not the one the user is looking at — this is
// what produced the pan-tracking drift reports. Track seek settlement so
// keyframe capture can wait for the real frame instead of a stale one.
let seekPending = false;
previewVideo.addEventListener('seeking', () => { seekPending = true; });
previewVideo.addEventListener('seeked', () => { seekPending = false; });

function waitForFrameSettled() {
  return new Promise((resolve) => {
    const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (!seekPending) { afterPaint(); return; }
    const onSeeked = () => {
      previewVideo.removeEventListener('seeked', onSeeked);
      afterPaint();
    };
    previewVideo.addEventListener('seeked', onSeeked);
  });
}

function spacePlayPause() {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;

  if (shuttleTimer) {
    stopShuttleTimer();
    resetShuttle();
    previewVideo.playbackRate = clip.speed || 1;
    updatePlayLabel();
    return;
  }

  if (previewVideo.paused) {
    resetShuttle();
    shuttleDirection = 'forward';
    lPressCount = 1;
    if (previewVideo.currentTime >= clip.trimEnd - 0.05 || previewVideo.currentTime < clip.trimStart) {
      previewVideo.currentTime = clip.trimStart;
    }
    previewVideo.playbackRate = clip.speed || 1;
    previewVideo.play();
  } else {
    previewVideo.pause();
    resetShuttle();
  }
  updatePlayLabel();
}

// Fast shuttle (any rate above 1x, either direction) steps currentTime directly on a
// timer instead of relying on native playbackRate — at 5x/10x the browser's real-time
// decoder can't keep up and native playback stalls partway through, so we bypass it.
function startShuttleTimer(rate, direction) {
  stopShuttleTimer();
  previewVideo.pause();
  const stepMs = 50;
  const perTick = (rate * stepMs) / 1000;
  shuttleTimer = setInterval(() => {
    const clip = selectedClip();
    if (!clip) {
      stopShuttleTimer();
      return;
    }
    let t = previewVideo.currentTime + (direction === 'forward' ? perTick : -perTick);
    const hitStart = direction === 'reverse' && t <= clip.trimStart;
    const hitEnd = direction === 'forward' && t >= clip.trimEnd;
    if (hitStart || hitEnd) {
      t = hitStart ? clip.trimStart : clip.trimEnd;
      stopShuttleTimer();
      resetShuttle();
      previewVideo.playbackRate = clip.speed || 1;
      updatePlayLabel();
      if (hitEnd) t = clip.trimStart;
    }
    previewVideo.currentTime = t;
    updateScrubberUI();
  }, stepMs);
}

function pressL() {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;

  if (shuttleDirection !== 'forward') {
    shuttleDirection = 'forward';
    lPressCount = 1;
  } else {
    lPressCount++;
  }
  const rate = SHUTTLE_SPEEDS[(lPressCount - 1) % SHUTTLE_SPEEDS.length];
  if (previewVideo.currentTime >= clip.trimEnd - 0.02 || previewVideo.currentTime < clip.trimStart) {
    previewVideo.currentTime = clip.trimStart;
  }
  if (rate === 1) {
    stopShuttleTimer();
    previewVideo.playbackRate = clip.speed || 1;
    previewVideo.play();
  } else {
    startShuttleTimer(rate * (clip.speed || 1), 'forward');
  }
  updatePlayLabel();
}

function pressJ() {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;

  if (shuttleDirection !== 'reverse') {
    shuttleDirection = 'reverse';
    jPressCount = 1;
  } else {
    jPressCount++;
  }
  const rate = SHUTTLE_SPEEDS[(jPressCount - 1) % SHUTTLE_SPEEDS.length];
  if (previewVideo.currentTime <= clip.trimStart + 0.02) {
    previewVideo.currentTime = clip.trimEnd;
  }
  startShuttleTimer(rate * (clip.speed || 1), 'reverse');
  updatePlayLabel();
}

function pressK() {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  previewVideo.pause();
  previewVideo.playbackRate = clip.speed || 1;
  stopShuttleTimer();
  resetShuttle();
  updatePlayLabel();
}

function stepFrame(direction) {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  previewVideo.pause();
  stopShuttleTimer();
  resetShuttle();
  updatePlayLabel();
  const frameDur = 1 / (clip.fps || 30);
  const t = previewVideo.currentTime + direction * frameDur;
  previewVideo.currentTime = Math.max(0, Math.min(clip.duration, t));
  updateScrubberUI();
}

function cutAtPlayhead() {
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  const t = previewVideo.currentTime;
  if (t <= clip.trimStart + 0.15 || t >= clip.trimEnd - 0.15) {
    statusText.textContent = 'カットする位置がクリップの端に近すぎます';
    return;
  }
  pushHistory();
  const idx = clips.findIndex((c) => c.id === clip.id);
  const splitLocalT = t - clip.trimStart;
  const kfs = clip.panKeyframes || [];
  let frontKfs = kfs.filter((k) => k.t <= splitLocalT + 0.001);
  let backKfs = kfs
    .filter((k) => k.t >= splitLocalT - 0.001)
    .map((k) => ({ t: Math.max(0, k.t - splitLocalT), x: k.x, y: k.y }));
  // Without a keyframe exactly at the cut, each half would keep only the
  // keyframes fully on its side and hold that single point for its whole
  // duration — freezing the pan instead of continuing the interpolated motion,
  // so a tracked subject drifts out of frame as playback continues past the
  // cut. Insert the interpolated boundary value on both sides to preserve it.
  if (clip.panAnimated && kfs.length) {
    const boundaryPan = getEffectivePan(clip, splitLocalT);
    if (!frontKfs.length || Math.abs(frontKfs[frontKfs.length - 1].t - splitLocalT) > 0.001) {
      frontKfs = [...frontKfs, { t: splitLocalT, x: boundaryPan.x, y: boundaryPan.y }];
    }
    if (!backKfs.length || Math.abs(backKfs[0].t) > 0.001) {
      backKfs = [{ t: 0, x: boundaryPan.x, y: boundaryPan.y }, ...backKfs];
    }
  }
  const newClip = {
    id: nextId++,
    path: clip.path,
    name: clip.name,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    fps: clip.fps,
    trimStart: t,
    trimEnd: clip.trimEnd,
    zoom: clip.zoom,
    zoomX: clip.zoomX,
    zoomY: clip.zoomY,
    panAnimated: clip.panAnimated,
    panKeyframes: backKfs,
    speed: clip.speed,
  };
  clip.panKeyframes = frontKfs;
  clip.trimEnd = t;
  clips.splice(idx + 1, 0, newClip);
  transitions.splice(idx, 0, { type: 'cut', duration: 0.5 });

  // Always retarget selection to the back half (same file, so currentTime/playback
  // state is left untouched) — playing or paused, the playhead is now sitting at the
  // start of the new segment, ready for the next consecutive blade cut (FCP-style).
  selectClip(newClip.id, { keepPlayback: true });
  statusText.textContent = `${clip.name} を ${fmtTime(t)} で分割しました`;
}

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      spacePlayPause();
      break;
    case 'l':
      pressL();
      break;
    case 'k':
      pressK();
      break;
    case 'j':
      pressJ();
      break;
    case 'b':
      cutAtPlayhead();
      break;
    case 'arrowright':
      e.preventDefault();
      stepFrame(1);
      break;
    case 'arrowleft':
      e.preventDefault();
      stepFrame(-1);
      break;
    case 'n':
      trimStartToPlayhead();
      break;
    case 'm':
      trimEndToPlayhead();
      break;
    case 'z':
      undo();
      break;
    case 'x':
      redo();
      break;
    case 'delete':
    case 'backspace':
      if (selectedClipId) {
        e.preventDefault();
        removeClip(selectedClipId);
      }
      break;
    default:
      break;
  }
});

playPauseBtn.addEventListener('click', spacePlayPause);
stepBackBtn.addEventListener('click', () => stepFrame(-1));
stepForwardBtn.addEventListener('click', () => stepFrame(1));

function trimStartToPlayhead() {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  const t = Math.min(previewVideo.currentTime, clip.trimEnd - 0.1);
  clip.trimStart = Math.max(0, t);
  updateScrubberUI();
  render();
  statusText.textContent = `${clip.name} の再生位置より前を削除しました`;
}

function trimEndToPlayhead() {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  const t = Math.max(previewVideo.currentTime, clip.trimStart + 0.1);
  clip.trimEnd = Math.min(clip.duration, t);
  updateScrubberUI();
  render();
  statusText.textContent = `${clip.name} の再生位置より後ろを削除しました`;
}

setInBtn.addEventListener('click', trimStartToPlayhead);
setOutBtn.addEventListener('click', trimEndToPlayhead);

playAllBtn.addEventListener('click', () => {
  if (!clips.length) return;
  sequencePlaying = true;
  sequenceIndex = 0;
  selectClip(clips[0].id, { autoplay: true });
});

function timeFromClientX(clientX) {
  const clip = selectedClip();
  if (!clip) return 0;
  const rect = scrubber.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return pct * clip.duration;
}

function startDrag(handle) {
  dragHandle = handle;
  sequencePlaying = false;
  pushHistory();
  const onMove = (e) => {
    const clip = selectedClip();
    if (!clip || !dragHandle) return;
    const t = timeFromClientX(e.clientX);
    if (dragHandle === 'start') {
      clip.trimStart = Math.max(0, Math.min(t, clip.trimEnd - 0.1));
      previewVideo.currentTime = clip.trimStart;
    } else {
      clip.trimEnd = Math.min(clip.duration, Math.max(t, clip.trimStart + 0.1));
      previewVideo.currentTime = clip.trimEnd;
    }
    updateScrubberUI();
  };
  const onUp = () => {
    dragHandle = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

handleStart.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  startDrag('start');
});
handleEnd.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  startDrag('end');
});
scrubber.addEventListener('mousedown', (e) => {
  if (e.target === handleStart || e.target === handleEnd) return;
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  previewVideo.currentTime = timeFromClientX(e.clientX);
  updateScrubberUI();
});

kfStrip.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('kf-strip-marker')) return;
  const clip = selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  const rect = kfStrip.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const trimDur = Math.max(clip.trimEnd - clip.trimStart, 0.001);
  previewVideo.currentTime = clip.trimStart + pct * trimDur;
  updateScrubberUI();
});

// ---- Export ----

function computeResolution() {
  const base = qualitySelect.value === 'fhd' ? [1920, 1080] : [3840, 2160];
  const [w, h] = orientationSelect.value === 'portrait' ? [base[1], base[0]] : base;
  return `${w}x${h}`;
}

function updateExportLabel() {
  const qualityLabel = qualitySelect.value === 'fhd' ? 'フルHD' : '4K';
  const orientationLabel = orientationSelect.value === 'portrait' ? '縦' : '横';
  exportBtn.textContent = `${qualityLabel}(${orientationLabel})で書き出す`;
}
orientationSelect.addEventListener('change', () => {
  updateExportLabel();
  updatePreviewBoxAspect();
  applyPreviewZoom();
});
qualitySelect.addEventListener('change', updateExportLabel);
updateExportLabel();
updatePreviewBoxAspect();

window.api.onProgress(({ progress }) => {
  const pct = Math.round(progress * 100);
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${pct}%`;
});

function clipExportPayload(c) {
  return {
    path: c.path,
    trimStart: c.trimStart,
    trimEnd: c.trimEnd,
    width: c.width,
    height: c.height,
    zoom: c.zoom,
    zoomX: c.zoomX,
    zoomY: c.zoomY,
    panAnimated: c.panAnimated,
    panKeyframes: c.panKeyframes,
    speed: c.speed,
    speedSegments: c.speedSegments,
  };
}

async function runExport(clipsPayload, transitionsPayload, defaultName) {
  const outputPath = await window.api.selectOutput(defaultName);
  if (!outputPath) return;

  exporting = true;
  render();
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = '0%';
  statusText.textContent = '書き出し中...';
  cancelExportBtn.classList.remove('hidden');
  cancelExportBtn.disabled = false;

  const resolution = computeResolution();
  const codec = document.getElementById('codecSelect').value;
  const fps = parseInt(document.getElementById('fpsSelect').value, 10);

  try {
    const result = await window.api.exportVideo({
      clips: clipsPayload,
      transitions: transitionsPayload,
      settings: { outputPath, resolution, codec, fps },
    });
    statusText.textContent = `完了: ${result.outputPath}`;
  } catch (e) {
    statusText.textContent = e.message === 'CANCELLED' ? '書き出しを中止しました' : `エラー: ${e.message}`;
  } finally {
    cancelExportBtn.classList.add('hidden');
    exporting = false;
    render();
  }
}

cancelExportBtn.addEventListener('click', async () => {
  cancelExportBtn.disabled = true;
  cancelExportBtn.textContent = '中止中...';
  await window.api.cancelExport();
  cancelExportBtn.textContent = '書き出しを中止';
});

clearCacheBtn.addEventListener('click', async () => {
  clearCacheBtn.disabled = true;
  clearCacheBtn.textContent = '削除中...';
  try {
    const result = await window.api.clearCache();
    const freedMB = (result.freedBytes / 1024 / 1024).toFixed(1);
    statusText.textContent = `キャッシュを削除しました（約${freedMB}MB解放）`;
  } catch (e) {
    statusText.textContent = `キャッシュ削除に失敗しました: ${e.message}`;
  } finally {
    clearCacheBtn.disabled = false;
    clearCacheBtn.textContent = '🗑️ アプリのキャッシュを削除';
  }
});

exportBtn.addEventListener('click', async () => {
  if (!clips.length) return;
  for (const c of clips) {
    if (c.trimEnd - c.trimStart < 0.2) {
      statusText.textContent = `${c.name} のトリム範囲が短すぎます`;
      return;
    }
  }
  const defaultName = `output_${new Date().toISOString().slice(0, 10)}.mp4`;
  await runExport(clips.map(clipExportPayload), transitions, defaultName);
});

exportSelectedBtn.addEventListener('click', async () => {
  const clip = selectedClip();
  if (!clip) return;
  if (clip.trimEnd - clip.trimStart < 0.2) {
    statusText.textContent = `${clip.name} のトリム範囲が短すぎます`;
    return;
  }
  const base = clip.name.replace(/\.[^.]+$/, '');
  const defaultName = `${base}_${fmtTime(clip.trimStart).replace(':', '')}-${fmtTime(clip.trimEnd).replace(':', '')}.mp4`;
  await runExport([clipExportPayload(clip)], [], defaultName);
});

render();

let clips = []; // { id, path, name, duration, width, height, trimStart, trimEnd }
let transitions = []; // length clips.length - 1, { type: 'cut'|'crossfade', duration }
let nextId = 1;
let exporting = false;
let selectedClipId = null;
let exportSelectedClipIds = new Set();
let sequencePlaying = false;
let sequenceIndex = 0;
let dragHandle = null; // 'start' | 'end' | null
let currentProjectId = null;
let skimmerTarget = null;
let skimmerOverTimeline = false;
let pendingSkimTarget = null;
let skimSeekInFlight = false;
let skimRunId = 0;
let lastTimelinePointer = null;
let timelineScrollFrame = null;
const waveformByPath = new Map();
const waveformLoads = new Map();
let recordingMode = false;
let comparisonMode = false;
let comparisonSyncing = false;
let largePreview = localStorage.getItem('largePreview') === 'true';
let lastExportedPath = localStorage.getItem('lastExportedPath') || null;
let analysisInProgress = false;
let recordingActive = false;
let recordingDrawFrame = null;
let recordingLastDrawAt = 0;
let mediaRecorder = null;
let recordingSessionId = null;
let recordingWriteChain = Promise.resolve();
let recordingStartedAt = 0;
let recordingClock = null;
let recordingAudioContext = null;
let recordingVideoSource = null;
let recordingSpeakerGain = null;
let recordingSourceGain = null;
let recordingMicGain = null;
let recordingMicStream = null;
let sourceMuted = false;
let micMuted = false;
let drawingTool = 'pen';
let drawingStrokes = [];
let activeDrawingStroke = null;
let seekPending = false;
const recordingVideoFrameCanvas = document.createElement('canvas');
let recordingQuality = localStorage.getItem('recordingQuality') === '4k' ? '4k' : 'fhd';
const savedDrawingLifetime = localStorage.getItem('drawingLifetime');
let drawingLifetimeMs = savedDrawingLifetime === '2000' ? 2000
  : savedDrawingLifetime === 'always' ? null
    : 3000;

let historyStack = [];
let redoStack = [];

let shuttleDirection = 'stopped'; // 'stopped' | 'forward' | 'reverse'
let lPressCount = 0;
let jPressCount = 0;
let shuttleTimer = null;
let shuttleRunId = 0;
// Chromium supports positive playback rates through 16x. 20x is rejected, so
// use the highest genuinely supported rate instead of simulating it with a
// flood of seeks (which starved 4K decoding and appeared to freeze).
const SHUTTLE_SPEEDS = [1, 2, 5, 10, 16];

const clipList = document.getElementById('clipList');
const dropZone = document.getElementById('dropZone');
const addFilesBtn = document.getElementById('addFilesBtn');
const recordModeBtn = document.getElementById('recordModeBtn');
const previewSizeBtn = document.getElementById('previewSizeBtn');
const exportBtn = document.getElementById('exportBtn');
const statusText = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const cancelExportBtn = document.getElementById('cancelExportBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const projectNameInput = document.getElementById('projectNameInput');
const saveProjectBtn = document.getElementById('saveProjectBtn');
const savedProjectSelect = document.getElementById('savedProjectSelect');
const loadProjectBtn = document.getElementById('loadProjectBtn');
const deleteProjectsBtn = document.getElementById('deleteProjectsBtn');
const orientationSelect = document.getElementById('orientationSelect');
const qualitySelect = document.getElementById('qualitySelect');
const qualityFhdBtn = document.getElementById('qualityFhdBtn');
const quality4kBtn = document.getElementById('quality4kBtn');
const codecSelect = document.getElementById('codecSelect');
const fpsSelect = document.getElementById('fpsSelect');
const compareClipASelect = document.getElementById('compareClipASelect');
const compareClipBSelect = document.getElementById('compareClipBSelect');
const compareStartA = document.getElementById('compareStartA');
const compareStartB = document.getElementById('compareStartB');
const compareABackBtn = document.getElementById('compareABackBtn');
const compareAForwardBtn = document.getElementById('compareAForwardBtn');
const compareBBackBtn = document.getElementById('compareBBackBtn');
const compareBForwardBtn = document.getElementById('compareBForwardBtn');
const compareSyncMode = document.getElementById('compareSyncMode');
const compareSyncModeEditor = document.getElementById('compareSyncModeEditor');
const compareAutoSyncBtn = document.getElementById('compareAutoSyncBtn');
const compareAutoSyncEditorBtn = document.getElementById('compareAutoSyncEditorBtn');
const compareSyncStatus = document.getElementById('compareSyncStatus');
const compareAudioSelect = document.getElementById('compareAudioSelect');
const comparePreviewBtn = document.getElementById('comparePreviewBtn');
const compareExportBtn = document.getElementById('compareExportBtn');
const comparisonEditor = document.getElementById('comparisonEditor');
const comparisonStage = document.getElementById('comparisonStage');
const comparePaneA = document.getElementById('comparePaneA');
const comparePaneB = document.getElementById('comparePaneB');
const compareVideoA = document.getElementById('compareVideoA');
const compareVideoB = document.getElementById('compareVideoB');
const compareSeekA = document.getElementById('compareSeekA');
const compareSeekB = document.getElementById('compareSeekB');
const compareEditABtn = document.getElementById('compareEditABtn');
const compareEditBBtn = document.getElementById('compareEditBBtn');
const compareActiveBackBtn = document.getElementById('compareActiveBackBtn');
const compareActiveForwardBtn = document.getElementById('compareActiveForwardBtn');
const comparePlayBtn = document.getElementById('comparePlayBtn');
const compareRestartBtn = document.getElementById('compareRestartBtn');
const compareTime = document.getElementById('compareTime');
const compareCloseBtn = document.getElementById('compareCloseBtn');
const analyzeExportBtn = document.getElementById('analyzeExportBtn');
const analysisOverlay = document.getElementById('analysisOverlay');
const analysisCloseBtn = document.getElementById('analysisCloseBtn');
const analysisFileName = document.getElementById('analysisFileName');
const analysisLoading = document.getElementById('analysisLoading');
const analysisError = document.getElementById('analysisError');
const analysisResult = document.getElementById('analysisResult');
const referenceSaveForm = document.getElementById('referenceSaveForm');
const referenceNameInput = document.getElementById('referenceNameInput');
const referenceDescriptionInput = document.getElementById('referenceDescriptionInput');
const saveReferenceBtn = document.getElementById('saveReferenceBtn');
const referenceSaveStatus = document.getElementById('referenceSaveStatus');
const updateBanner = document.getElementById('updateBanner');
const updateTitle = document.getElementById('updateTitle');
const updateMessage = document.getElementById('updateMessage');
const updateInstallBtn = document.getElementById('updateInstallBtn');
const updateDismissBtn = document.getElementById('updateDismissBtn');

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
const skimmingToggle = document.getElementById('skimmingToggle');
const keyframeMarkers = document.getElementById('keyframeMarkers');
const kfStrip = document.getElementById('kfStrip');
const kfStripMarkers = document.getElementById('kfStripMarkers');
const kfStripPlayhead = document.getElementById('kfStripPlayhead');
const bulkTransitionType = document.getElementById('bulkTransitionType');
const bulkTransitionDuration = document.getElementById('bulkTransitionDuration');
const applyBulkTransitionBtn = document.getElementById('applyBulkTransitionBtn');
const recordingOverlay = document.getElementById('recordingOverlay');
const recordingCanvas = document.getElementById('recordingCanvas');
const recordingControls = document.getElementById('recordingControls');
const recordingBadge = document.getElementById('recordingBadge');
const recordingTime = document.getElementById('recordingTime');
const penToolBtn = document.getElementById('penToolBtn');
const arrowToolBtn = document.getElementById('arrowToolBtn');
const drawingColor = document.getElementById('drawingColor');
const drawingWidth = document.getElementById('drawingWidth');
const drawing2sBtn = document.getElementById('drawing2sBtn');
const drawing3sBtn = document.getElementById('drawing3sBtn');
const drawingAlwaysBtn = document.getElementById('drawingAlwaysBtn');
const clearDrawingBtn = document.getElementById('clearDrawingBtn');
const recordingFhdBtn = document.getElementById('recordingFhdBtn');
const recording4kBtn = document.getElementById('recording4kBtn');
const sourceVolume = document.getElementById('sourceVolume');
const sourceVolumeValue = document.getElementById('sourceVolumeValue');
const micVolume = document.getElementById('micVolume');
const micVolumeValue = document.getElementById('micVolumeValue');
const sourceMuteBtn = document.getElementById('sourceMuteBtn');
const micMuteBtn = document.getElementById('micMuteBtn');
const startRecordingBtn = document.getElementById('startRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const exitRecordingBtn = document.getElementById('exitRecordingBtn');
const recordingStatus = document.getElementById('recordingStatus');

const timelineWrap = document.getElementById('timelineWrap');
const timelineRuler = document.getElementById('timelineRuler');
const timelineTrack = document.getElementById('timelineTrack');
const timelineSkimmer = document.getElementById('timelineSkimmer');
const timelinePlayhead = document.getElementById('timelinePlayhead');
let PX_PER_SEC = 15;
const PX_PER_SEC_MIN = 2;
const PX_PER_SEC_MAX = 150;
const TL_MARKER_WIDTH = 6;

skimmingToggle.checked = localStorage.getItem('skimmingEnabled') === 'true';
let waveformsVisible = localStorage.getItem('waveformsVisible') !== 'false';
document.body.classList.toggle('waveforms-hidden', !waveformsVisible);
document.body.classList.toggle('preview-large', largePreview);
previewSizeBtn.classList.toggle('active', largePreview);
previewSizeBtn.setAttribute('aria-pressed', String(largePreview));
previewSizeBtn.textContent = largePreview ? '▣ 標準サイズへ' : '⛶ 再生画面を大きく';

function setLargePreview(enabled) {
  largePreview = Boolean(enabled);
  localStorage.setItem('largePreview', String(largePreview));
  document.body.classList.toggle('preview-large', largePreview);
  previewSizeBtn.classList.toggle('active', largePreview);
  previewSizeBtn.setAttribute('aria-pressed', String(largePreview));
  previewSizeBtn.textContent = largePreview ? '▣ 標準サイズへ' : '⛶ 再生画面を大きく';
  requestAnimationFrame(() => {
    updatePreviewBoxAspect();
    applyPreviewZoom();
  });
}

previewSizeBtn.addEventListener('click', () => setLargePreview(!largePreview));

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

async function ensureWaveform(filePath) {
  if (!filePath || waveformByPath.has(filePath)) return waveformByPath.get(filePath) || [];
  if (waveformLoads.has(filePath)) return waveformLoads.get(filePath);
  const load = window.api.audioWaveform({ filePath, bins: 1600 })
    .then((peaks) => {
      waveformByPath.set(filePath, Array.isArray(peaks) ? peaks : []);
      waveformLoads.delete(filePath);
      renderTimeline();
      return peaks;
    })
    .catch(() => {
      waveformByPath.set(filePath, []);
      waveformLoads.delete(filePath);
      return [];
    });
  waveformLoads.set(filePath, load);
  return load;
}

function drawClipWaveform(canvas, clip) {
  const peaks = waveformByPath.get(clip.path);
  if (!peaks || !peaks.length || !clip.duration) return;
  const width = Math.max(80, Math.min(1200, Math.round(canvas.getBoundingClientRect().width * 2)));
  const height = 100;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(151, 214, 255, 0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startFraction = Math.max(0, clip.trimStart / clip.duration);
  const endFraction = Math.min(1, clip.trimEnd / clip.duration);
  for (let x = 0; x < width; x += 1) {
    const fraction = startFraction + (x / Math.max(1, width - 1)) * (endFraction - startFraction);
    const peak = peaks[Math.min(peaks.length - 1, Math.floor(fraction * peaks.length))] || 0;
    const amplitude = Math.max(1, peak * height * 0.46);
    ctx.moveTo(x + 0.5, height / 2 - amplitude);
    ctx.lineTo(x + 0.5, height / 2 + amplitude);
  }
  ctx.stroke();
}

function pruneExportSelection() {
  const validIds = new Set(clips.map((clip) => clip.id));
  exportSelectedClipIds = new Set(
    [...exportSelectedClipIds].filter((id) => validIds.has(id))
  );
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
  pruneExportSelection();
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
      ensureWaveform(p);
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
  if (firstAdded && !projectNameInput.value.trim()) {
    projectNameInput.value = firstAdded.name.replace(/\.[^.]+$/, '');
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
  exportSelectedClipIds.delete(id);
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

function duplicateClip(id) {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return;
  pushHistory();
  const duplicate = JSON.parse(JSON.stringify(clips[index]));
  duplicate.id = nextId++;
  duplicate.name = `${clips[index].name}（複製）`;
  clips.splice(index + 1, 0, duplicate);
  // Insert a new cut between the original and its duplicate. The existing
  // transition at this index shifts right and remains between the duplicate
  // and the clip that originally followed it.
  transitions.splice(index, 0, { type: 'cut', duration: 0.5 });
  sequencePlaying = false;
  selectClip(duplicate.id);
  statusText.textContent = `${clips[index].name} を複製しました`;
}

function replaceClipData(clip, snapshot) {
  Object.keys(clip).forEach((key) => delete clip[key]);
  Object.assign(clip, JSON.parse(JSON.stringify(snapshot)));
}

function setClipTrimStart(clip, requestedStart) {
  const oldStart = clip.trimStart;
  const newStart = Math.max(0, Math.min(requestedStart, clip.trimEnd - 0.1));
  const delta = newStart - oldStart;
  if (Math.abs(delta) < 0.0001) return;

  const oldKfs = [...(clip.panKeyframes || [])].sort((a, b) => a.t - b.t);
  const boundaryPan = oldKfs.length
    ? getEffectivePan(clip, Math.max(0, delta))
    : null;
  const newDuration = clip.trimEnd - newStart;
  let shiftedKfs = oldKfs
    .map((kf) => ({ ...kf, t: kf.t - delta }))
    .filter((kf) => kf.t >= -0.001 && kf.t <= newDuration + 0.001)
    .map((kf) => ({ ...kf, t: Math.max(0, Math.min(newDuration, kf.t)) }));
  if (boundaryPan && (!shiftedKfs.length || shiftedKfs[0].t > 0.001)) {
    shiftedKfs.unshift({ t: 0, x: boundaryPan.x, y: boundaryPan.y });
  }

  clip.trimStart = newStart;
  clip.panKeyframes = shiftedKfs;
  clip.speedSegments = (clip.speedSegments || [])
    .map((segment) => ({
      ...segment,
      start: Math.max(0, segment.start - delta),
      end: Math.min(newDuration, segment.end - delta),
    }))
    .filter((segment) => segment.end - segment.start > 0.001);
}

function setClipTrimEnd(clip, requestedEnd) {
  const newEnd = Math.min(clip.duration, Math.max(requestedEnd, clip.trimStart + 0.1));
  const newDuration = newEnd - clip.trimStart;
  if (Math.abs(newEnd - clip.trimEnd) < 0.0001) return;

  const oldKfs = [...(clip.panKeyframes || [])].sort((a, b) => a.t - b.t);
  const boundaryPan = oldKfs.length ? getEffectivePan(clip, newDuration) : null;
  let clippedKfs = oldKfs
    .filter((kf) => kf.t <= newDuration + 0.001)
    .map((kf) => ({ ...kf, t: Math.min(newDuration, kf.t) }));
  if (boundaryPan && (!clippedKfs.length || Math.abs(clippedKfs[clippedKfs.length - 1].t - newDuration) > 0.001)) {
    clippedKfs.push({ t: newDuration, x: boundaryPan.x, y: boundaryPan.y });
  }

  clip.trimEnd = newEnd;
  clip.panKeyframes = clippedKfs;
  clip.speedSegments = (clip.speedSegments || [])
    .map((segment) => ({ ...segment, end: Math.min(newDuration, segment.end) }))
    .filter((segment) => segment.end - segment.start > 0.001);
}

function joinWithNext(i) {
  const front = clips[i];
  const back = clips[i + 1];
  if (!front || !back || front.path !== back.path) return;
  pushHistory();
  const keepExportPick = exportSelectedClipIds.has(front.id) || exportSelectedClipIds.has(back.id);
  front.trimEnd = back.trimEnd;
  clips.splice(i + 1, 1);
  exportSelectedClipIds.delete(back.id);
  if (keepExportPick) exportSelectedClipIds.add(front.id);
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
  pruneExportSelection();
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
    const exportPick = document.createElement('label');
    exportPick.className = 'clip-export-pick';
    exportPick.title = 'このクリップを複数選択書き出しに含める';
    exportPick.innerHTML = `<input type="checkbox" ${exportSelectedClipIds.has(clip.id) ? 'checked' : ''} /> 書出`;
    exportPick.addEventListener('click', (e) => e.stopPropagation());
    exportPick.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) exportSelectedClipIds.add(clip.id);
      else exportSelectedClipIds.delete(clip.id);
      render();
    });
    const clipName = document.createElement('span');
    clipName.className = 'clip-name';
    clipName.textContent = `${i + 1}. ${clip.name}`;
    const identity = document.createElement('div');
    identity.className = 'clip-identity';
    identity.appendChild(exportPick);
    identity.appendChild(clipName);
    const actions = document.createElement('div');
    actions.className = 'clip-actions';
    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'duplicate-btn';
    duplicateBtn.textContent = '複製';
    duplicateBtn.title = 'このクリップと編集設定を複製';
    duplicateBtn.addEventListener('click', () => duplicateClip(clip.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => removeClip(clip.id));
    actions.appendChild(duplicateBtn);
    actions.appendChild(delBtn);
    row1.appendChild(identity);
    row1.appendChild(actions);

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
        if (field === 'trimStart') setClipTrimStart(clip, val);
        else setClipTrimEnd(clip, val);
        render();
        if (clip.id === selectedClipId) updateScrubberUI();
      });
    });

    li.appendChild(row1);
    li.appendChild(trimRow);
    clipList.appendChild(li);
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
  const exportSelectionCount = exportSelectedClipIds.size;
  exportSelectedBtn.disabled = exportSelectionCount === 0 || exporting;
  exportSelectedBtn.textContent = exportSelectionCount
    ? `チェックした${exportSelectionCount}クリップを書き出す`
    : '書き出すクリップをチェック';
  saveProjectBtn.disabled = clips.length === 0 || exporting;
  recordModeBtn.disabled = !selectedClipId || exporting;
  renderComparisonControls();
  renderTimeline();
}

function comparisonClip(select) {
  return clips.find((clip) => String(clip.id) === select.value) || null;
}

function activeComparisonVideo() {
  const b = comparisonClip(compareClipBSelect);
  return b && b.id === selectedClipId ? compareVideoB : compareVideoA;
}

function activeEditingVideo() {
  return comparisonMode ? activeComparisonVideo() : previewVideo;
}

function activateComparisonPane(side) {
  const clip = comparisonClip(side === 'b' ? compareClipBSelect : compareClipASelect);
  if (!clip) return;
  selectedClipId = clip.id;
  comparePaneA.classList.toggle('selected', side === 'a');
  comparePaneB.classList.toggle('selected', side === 'b');
  compareEditABtn.classList.toggle('active', side === 'a');
  compareEditBBtn.classList.toggle('active', side === 'b');
  [playPauseBtn, stepBackBtn, stepForwardBtn, setInBtn, setOutBtn, playAllBtn, zoomSlider, zoomResetBtn, exportSelectedBtn, panAnimatedToggle, addKeyframeBtn, removeKeyframeBtn, autoTrackBtn, speedSelect, speedSegStartBtn, speedSegEndBtn, speedSegSpeed, speedSegAddBtn]
    .forEach((button) => { button.disabled = false; });
  syncZoomUI();
  updateScrubberUI();
  render();
}

function clampComparisonStart(input, clip) {
  if (!clip) return 0;
  const value = Number(input.value);
  const start = Number.isFinite(value) ? value : clip.trimStart;
  const clamped = Math.max(clip.trimStart, Math.min(clip.trimEnd - 0.1, start));
  input.value = clamped.toFixed(3);
  return clamped;
}

function renderComparisonControls() {
  const previousA = compareClipASelect.value;
  const previousB = compareClipBSelect.value;
  const options = ['<option value="">動画を選択</option>']
    .concat(clips.map((clip, index) => `<option value="${clip.id}">${index + 1}. ${clip.name}</option>`));
  compareClipASelect.innerHTML = options.join('');
  compareClipBSelect.innerHTML = options.join('');
  if (clips.some((clip) => String(clip.id) === previousA)) compareClipASelect.value = previousA;
  else if (clips[0]) compareClipASelect.value = String(clips[0].id);
  if (clips.some((clip) => String(clip.id) === previousB)) compareClipBSelect.value = previousB;
  else if (clips[1]) compareClipBSelect.value = String(clips[1].id);

  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  const valid = Boolean(a && b && a.id !== b.id);
  if (!valid && comparisonMode) {
    comparisonMode = false;
    compareVideoA.pause();
    compareVideoB.pause();
    comparisonEditor.classList.add('hidden');
    previewVideoBox.classList.remove('comparison-active');
  }
  comparePreviewBtn.disabled = !valid || exporting;
  compareExportBtn.disabled = !valid || exporting;
  compareAutoSyncBtn.disabled = !valid || exporting || comparisonSyncing;
  compareAutoSyncEditorBtn.disabled = !valid || exporting || comparisonSyncing;
  comparePreviewBtn.textContent = comparisonMode ? '1画面編集へ戻る' : '2画面で編集';
  if (a && !compareStartA.dataset.edited) compareStartA.value = a.trimStart.toFixed(3);
  if (b && !compareStartB.dataset.edited) compareStartB.value = b.trimStart.toFixed(3);
}

function markComparisonStartChanged(input, clip) {
  input.dataset.edited = 'true';
  clampComparisonStart(input, clip);
}

function nudgeComparisonStart(input, clip, direction) {
  if (!clip) return;
  const frame = 1 / (clip.fps || 30);
  const a = comparisonClip(compareClipASelect);
  const oldAStart = a ? clampComparisonStart(compareStartA, a) : 0;
  const elapsed = comparisonMode && a
    ? Math.max(0, compareVideoA.currentTime - oldAStart)
    : 0;
  const currentStart = clampComparisonStart(input, clip);
  const nextStart = Math.max(clip.trimStart, Math.min(clip.trimEnd - 0.1, currentStart + direction * frame));
  input.value = nextStart.toFixed(3);
  markComparisonStartChanged(input, clip);
  if (comparisonMode) {
    const b = comparisonClip(compareClipBSelect);
    compareVideoA.pause();
    compareVideoB.pause();
    compareVideoA.currentTime = clampComparisonStart(compareStartA, a) + Math.min(elapsed, comparisonDuration());
    compareVideoB.currentTime = clampComparisonStart(compareStartB, b) + Math.min(elapsed, comparisonDuration());
    compareSeekA.value = compareVideoA.currentTime;
    compareSeekB.value = compareVideoB.currentTime;
    comparePlayBtn.textContent = '▶ 同時再生';
    compareTime.textContent = `${fmtTime(elapsed)} / ${fmtTime(comparisonDuration())}`;
    updateScrubberUI();
    applyComparisonTransforms();
  }
}

function comparisonDuration() {
  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  if (!a || !b) return 0;
  const startA = clampComparisonStart(compareStartA, a);
  const startB = clampComparisonStart(compareStartB, b);
  return Math.max(0, Math.min(a.trimEnd - startA, b.trimEnd - startB));
}

function restartComparisonPreview() {
  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  if (!a || !b) return;
  compareVideoA.pause();
  compareVideoB.pause();
  compareVideoA.currentTime = clampComparisonStart(compareStartA, a);
  compareVideoB.currentTime = clampComparisonStart(compareStartB, b);
  compareSeekA.value = compareVideoA.currentTime;
  compareSeekB.value = compareVideoB.currentTime;
  comparePlayBtn.textContent = '▶ 同時再生';
  compareTime.textContent = `00:00 / ${fmtTime(comparisonDuration())}`;
  applyComparisonTransforms();
}

async function toggleComparisonPlayback() {
  if (!comparisonMode) return;
  if (!compareVideoA.paused || !compareVideoB.paused) {
    compareVideoA.pause();
    compareVideoB.pause();
    comparePlayBtn.textContent = '▶ 同時再生';
    return;
  }
  const duration = comparisonDuration();
  const a = comparisonClip(compareClipASelect);
  if (!a || duration <= 0.1) return;
  const elapsed = compareVideoA.currentTime - clampComparisonStart(compareStartA, a);
  if (elapsed >= duration - 0.05) restartComparisonPreview();
  comparePlayBtn.textContent = '⏸ 停止';
  compareVideoA.play().catch(() => {});
  compareVideoB.play().catch(() => {});
}

function openComparisonPreview() {
  if (comparisonMode) {
    closeComparisonPreview();
    return;
  }
  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  if (!a || !b || a.id === b.id) return;
  comparisonMode = true;
  previewVideo.pause();
  stopShuttleTimer();
  resetShuttle();
  previewVideoBox.classList.add('comparison-active');
  comparisonStage.classList.toggle('portrait', orientationSelect.value === 'portrait');
  comparisonStage.classList.toggle('landscape', orientationSelect.value !== 'portrait');
  compareVideoA.src = 'file://' + encodeURI(a.path);
  compareVideoB.src = 'file://' + encodeURI(b.path);
  compareSeekA.min = a.trimStart;
  compareSeekA.max = Math.max(a.trimStart, a.trimEnd - 0.001);
  compareSeekB.min = b.trimStart;
  compareSeekB.max = Math.max(b.trimStart, b.trimEnd - 0.001);
  comparisonEditor.classList.remove('hidden');
  activateComparisonPane('a');
  renderComparisonControls();
  const waitForMetadata = (video) => video.readyState >= 1
    ? Promise.resolve()
    : new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  Promise.all([waitForMetadata(compareVideoA), waitForMetadata(compareVideoB)])
    .then(restartComparisonPreview)
    .catch(() => {});
}

function closeComparisonPreview() {
  const activeClip = selectedClip();
  const currentComparisonTime = activeComparisonVideo().currentTime;
  const activeTime = Number.isFinite(currentComparisonTime) ? currentComparisonTime : activeClip?.trimStart;
  comparisonMode = false;
  compareVideoA.pause();
  compareVideoB.pause();
  comparisonEditor.classList.add('hidden');
  previewVideoBox.classList.remove('comparison-active');
  renderComparisonControls();
  if (activeClip) selectClip(activeClip.id, { seekTo: activeTime });
}

function refreshOpenComparisonEditor() {
  if (!comparisonMode) return;
  closeComparisonPreview();
  openComparisonPreview();
}

compareClipASelect.addEventListener('change', () => { delete compareStartA.dataset.edited; renderComparisonControls(); refreshOpenComparisonEditor(); });
compareClipBSelect.addEventListener('change', () => { delete compareStartB.dataset.edited; renderComparisonControls(); refreshOpenComparisonEditor(); });
compareStartA.addEventListener('change', () => { markComparisonStartChanged(compareStartA, comparisonClip(compareClipASelect)); if (comparisonMode) restartComparisonPreview(); });
compareStartB.addEventListener('change', () => { markComparisonStartChanged(compareStartB, comparisonClip(compareClipBSelect)); if (comparisonMode) restartComparisonPreview(); });
compareABackBtn.addEventListener('click', () => nudgeComparisonStart(compareStartA, comparisonClip(compareClipASelect), -1));
compareAForwardBtn.addEventListener('click', () => nudgeComparisonStart(compareStartA, comparisonClip(compareClipASelect), 1));
compareBBackBtn.addEventListener('click', () => nudgeComparisonStart(compareStartB, comparisonClip(compareClipBSelect), -1));
compareBForwardBtn.addEventListener('click', () => nudgeComparisonStart(compareStartB, comparisonClip(compareClipBSelect), 1));
compareSyncMode.addEventListener('change', () => { compareSyncModeEditor.value = compareSyncMode.value; });
compareSyncModeEditor.addEventListener('change', () => { compareSyncMode.value = compareSyncModeEditor.value; });

async function autoSyncComparison() {
  if (comparisonSyncing) return;
  const left = comparisonClip(compareClipASelect);
  const right = comparisonClip(compareClipBSelect);
  if (!left || !right || left.id === right.id) return;
  comparisonSyncing = true;
  compareSyncStatus.className = 'compare-sync-status';
  compareSyncStatus.textContent = '姿勢AIでテイクオフを解析しています…（動画はMacの外へ送信しません）';
  compareAutoSyncBtn.textContent = '解析中…';
  compareAutoSyncEditorBtn.textContent = '解析中…';
  renderComparisonControls();
  try {
    const leftPan = getEffectivePan(left, Math.max(0, clampComparisonStart(compareStartA, left) - left.trimStart));
    const rightPan = getEffectivePan(right, Math.max(0, clampComparisonStart(compareStartB, right) - right.trimStart));
    const result = await window.api.autoSyncComparison({
      mode: compareSyncMode.value,
      left: {
        path: left.path, trimStart: left.trimStart, trimEnd: left.trimEnd,
        start: clampComparisonStart(compareStartA, left), zoom: left.zoom,
        syncPanX: leftPan.x, syncPanY: leftPan.y,
      },
      right: {
        path: right.path, trimStart: right.trimStart, trimEnd: right.trimEnd,
        start: clampComparisonStart(compareStartB, right), zoom: right.zoom,
        syncPanX: rightPan.x, syncPanY: rightPan.y,
      },
    });
    compareStartA.value = Math.max(left.trimStart, Math.min(left.trimEnd - 0.1, result.leftTime)).toFixed(3);
    compareStartB.value = Math.max(right.trimStart, Math.min(right.trimEnd - 0.1, result.rightTime)).toFixed(3);
    compareStartA.dataset.edited = 'true';
    compareStartB.dataset.edited = 'true';
    const confidence = Math.round(Math.min(result.leftConfidence, result.rightConfidence) * 100);
    compareSyncStatus.className = 'compare-sync-status success';
    compareSyncStatus.textContent = `${result.eventLabel}で揃えました（AI確信度 ${confidence}%）。必要なら±1コマで微調整してください。`;
    if (comparisonMode) restartComparisonPreview();
    statusText.textContent = `2画面を${result.eventLabel}で自動同期しました`;
  } catch (error) {
    compareSyncStatus.className = 'compare-sync-status error';
    compareSyncStatus.textContent = error.message;
  } finally {
    comparisonSyncing = false;
    compareAutoSyncBtn.textContent = 'AIでタイミングを揃える';
    compareAutoSyncEditorBtn.textContent = 'AIで揃える';
    renderComparisonControls();
  }
}

compareAutoSyncBtn.addEventListener('click', autoSyncComparison);
compareAutoSyncEditorBtn.addEventListener('click', autoSyncComparison);
comparePreviewBtn.addEventListener('click', openComparisonPreview);
compareCloseBtn.addEventListener('click', closeComparisonPreview);
comparePlayBtn.addEventListener('click', toggleComparisonPlayback);
compareRestartBtn.addEventListener('click', restartComparisonPreview);
compareEditABtn.addEventListener('click', () => activateComparisonPane('a'));
compareEditBBtn.addEventListener('click', () => activateComparisonPane('b'));
compareActiveBackBtn.addEventListener('click', () => {
  const editingB = comparisonClip(compareClipBSelect)?.id === selectedClipId;
  nudgeComparisonStart(
    editingB ? compareStartB : compareStartA,
    comparisonClip(editingB ? compareClipBSelect : compareClipASelect),
    -1
  );
});
compareActiveForwardBtn.addEventListener('click', () => {
  const editingB = comparisonClip(compareClipBSelect)?.id === selectedClipId;
  nudgeComparisonStart(
    editingB ? compareStartB : compareStartA,
    comparisonClip(editingB ? compareClipBSelect : compareClipASelect),
    1
  );
});
function setComparisonStartFromScrubber(side) {
  const input = side === 'a' ? compareStartA : compareStartB;
  const seek = side === 'a' ? compareSeekA : compareSeekB;
  const clip = comparisonClip(side === 'a' ? compareClipASelect : compareClipBSelect);
  if (!clip) return;
  input.value = Number(seek.value).toFixed(3);
  markComparisonStartChanged(input, clip);
  restartComparisonPreview();
  activateComparisonPane(side);
}
compareSeekA.addEventListener('input', () => setComparisonStartFromScrubber('a'));
compareSeekB.addEventListener('input', () => setComparisonStartFromScrubber('b'));
compareVideoA.addEventListener('timeupdate', () => {
  if (!comparisonMode) return;
  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  if (!a || !b) return;
  const elapsed = Math.max(0, compareVideoA.currentTime - clampComparisonStart(compareStartA, a));
  const duration = comparisonDuration();
  compareTime.textContent = `${fmtTime(elapsed)} / ${fmtTime(duration)}`;
  const desiredB = clampComparisonStart(compareStartB, b) + elapsed;
  if (Math.abs(compareVideoB.currentTime - desiredB) > 0.08) compareVideoB.currentTime = desiredB;
  compareSeekA.value = compareVideoA.currentTime;
  compareSeekB.value = compareVideoB.currentTime;
  updateScrubberUI();
  applyComparisonTransforms();
  if (elapsed >= duration - 0.02) restartComparisonPreview();
});
compareVideoB.addEventListener('timeupdate', applyComparisonTransforms);

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

function timelineTargetFromClientX(clientX) {
  const rect = timelineTrack.getBoundingClientRect();
  const x = clientX - rect.left;
  const { layout } = computeTimelineLayout();
  for (const item of layout) {
    if (x < item.x || x > item.x + item.width) continue;
    const fraction = Math.min(1, Math.max(0, (x - item.x) / item.width));
    return {
      clipId: item.clip.id,
      time: item.clip.trimStart + fraction * item.dur,
      timelineX: item.x + fraction * item.width,
    };
  }
  return null;
}

function stopSkimSeeking() {
  skimRunId++;
  pendingSkimTarget = null;
  skimSeekInFlight = false;
}

function processPendingSkim() {
  if (!skimmingToggle.checked || !skimmerOverTimeline || skimSeekInFlight || !pendingSkimTarget) return;
  const target = pendingSkimTarget;
  pendingSkimTarget = null;
  const runId = skimRunId;
  skimSeekInFlight = true;
  const previousTime = previewVideo.currentTime;
  let finished = false;
  let fallbackTimer = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    previewVideo.removeEventListener('seeked', finish);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    requestAnimationFrame(() => {
      if (runId !== skimRunId) return;
      skimSeekInFlight = false;
      processPendingSkim();
    });
  };

  previewVideo.addEventListener('seeked', finish, { once: true });
  if (selectedClipId !== target.clipId) {
    selectClip(target.clipId, { seekTo: target.time });
  } else {
    sequencePlaying = false;
    previewVideo.pause();
    stopShuttleTimer();
    previewVideo.currentTime = target.time;
    updateScrubberUI();
    applyPreviewZoom();
  }
  if (Math.abs(previousTime - target.time) < 0.001 && selectedClipId === target.clipId) {
    finish();
  } else {
    // Local media normally seeks much faster. This fallback avoids getting
    // stuck forever on a damaged frame while still preventing seek floods.
    fallbackTimer = setTimeout(finish, 500);
  }
}

function queueSkim(target) {
  pendingSkimTarget = target;
  processPendingSkim();
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

function beginTimelineEdgeTrim(event, clip, edge) {
  event.preventDefault();
  event.stopPropagation();
  sequencePlaying = false;
  previewVideo.pause();
  stopShuttleTimer();
  resetShuttle();
  if (selectedClipId !== clip.id) {
    selectClip(clip.id, { seekTo: edge === 'start' ? clip.trimStart : clip.trimEnd });
  }

  pushHistory();
  const snapshot = JSON.parse(JSON.stringify(clip));
  const startX = event.clientX;
  const sourceSecondsPerPixel = (snapshot.speed && snapshot.speed > 0 ? snapshot.speed : 1) / PX_PER_SEC;
  document.body.classList.add('timeline-trimming');

  const onMove = (e) => {
    const deltaSeconds = (e.clientX - startX) * sourceSecondsPerPixel;
    replaceClipData(clip, snapshot);
    if (edge === 'start') {
      setClipTrimStart(clip, snapshot.trimStart + deltaSeconds);
      previewVideo.currentTime = clip.trimStart;
    } else {
      setClipTrimEnd(clip, snapshot.trimEnd + deltaSeconds);
      previewVideo.currentTime = Math.max(clip.trimStart, clip.trimEnd - 0.001);
    }
    updateScrubberUI();
    renderTimeline();
    statusText.textContent = `${clip.name}：${fmtTime(clip.trimStart)} 〜 ${fmtTime(clip.trimEnd)}`;
  };

  const onUp = () => {
    document.body.classList.remove('timeline-trimming');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    render();
    updateScrubberUI();
    statusText.textContent = `${clip.name} の${edge === 'start' ? '開始' : '終了'}位置を調整しました`;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
    block.title = `${item.clip.name}\n${fmtTime(item.dur)}\n中央をドラッグ：並べ替え\n左右端をドラッグ：長さ調整`;
    const label = document.createElement('span');
    label.className = 'tl-clip-label';
    label.textContent = String(i + 1);
    const waveform = document.createElement('canvas');
    waveform.className = 'tl-waveform';
    const leftHandle = document.createElement('div');
    leftHandle.className = 'tl-trim-handle tl-trim-left';
    leftHandle.title = '開始位置を伸縮';
    const rightHandle = document.createElement('div');
    rightHandle.className = 'tl-trim-handle tl-trim-right';
    rightHandle.title = '終了位置を伸縮';
    [leftHandle, rightHandle].forEach((handle) => {
      handle.draggable = false;
      handle.addEventListener('click', (e) => e.stopPropagation());
      handle.addEventListener('dragstart', (e) => e.preventDefault());
    });
    leftHandle.addEventListener('mousedown', (e) => beginTimelineEdgeTrim(e, item.clip, 'start'));
    rightHandle.addEventListener('mousedown', (e) => beginTimelineEdgeTrim(e, item.clip, 'end'));
    block.appendChild(waveform);
    block.appendChild(leftHandle);
    block.appendChild(label);
    block.appendChild(rightHandle);
    block.draggable = true;
    block.addEventListener('dragstart', (e) => {
      if (e.target.classList.contains('tl-trim-handle')) {
        e.preventDefault();
        return;
      }
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
    requestAnimationFrame(() => drawClipWaveform(waveform, item.clip));

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
  if (e.target.classList.contains('tl-transition') || e.target.classList.contains('tl-trim-handle')) return;
  const target = timelineTargetFromClientX(e.clientX);
  if (!target) return;
  sequencePlaying = false;
  selectClip(target.clipId, { seekTo: target.time });
});

timelineTrack.addEventListener('mousemove', (e) => {
  if (!skimmingToggle.checked || document.body.classList.contains('timeline-trimming')) return;
  lastTimelinePointer = { clientX: e.clientX, clientY: e.clientY };
  const target = timelineTargetFromClientX(e.clientX);
  if (!target) {
    timelineSkimmer.style.display = 'none';
    skimmerTarget = null;
    return;
  }
  skimmerOverTimeline = true;
  skimmerTarget = target;
  timelineSkimmer.style.display = 'block';
  timelineSkimmer.style.left = `${target.timelineX}px`;
  queueSkim(target);
});

timelineTrack.addEventListener('mouseleave', () => {
  skimmerOverTimeline = false;
  skimmerTarget = null;
  lastTimelinePointer = null;
  timelineSkimmer.style.display = 'none';
  stopSkimSeeking();
});

timelineWrap.addEventListener('scroll', () => {
  if (!skimmingToggle.checked || !skimmerOverTimeline || !lastTimelinePointer) return;
  if (timelineScrollFrame) cancelAnimationFrame(timelineScrollFrame);
  timelineScrollFrame = requestAnimationFrame(() => {
    timelineScrollFrame = null;
    if (!skimmingToggle.checked || !skimmerOverTimeline || !lastTimelinePointer) return;
    const target = timelineTargetFromClientX(lastTimelinePointer.clientX);
    if (!target) {
      timelineSkimmer.style.display = 'none';
      skimmerTarget = null;
      return;
    }
    // Horizontal scrolling moves the timeline underneath the stationary mouse.
    // Recalculate the hovered time so both skimmer and playhead remain at the
    // same screen position; never warp the physical pointer for scrolling.
    skimmerTarget = target;
    timelineSkimmer.style.display = 'block';
    timelineSkimmer.style.left = `${target.timelineX}px`;
    queueSkim(target);
  });
});

function setSkimmingEnabled(enabled, { announce = false } = {}) {
  skimmingToggle.checked = enabled;
  localStorage.setItem('skimmingEnabled', String(enabled));
  if (!enabled) {
    skimmerOverTimeline = false;
    skimmerTarget = null;
    lastTimelinePointer = null;
    timelineSkimmer.style.display = 'none';
    stopSkimSeeking();
  }
  if (announce) statusText.textContent = `スキムを${enabled ? 'オン' : 'オフ'}にしました`;
}

skimmingToggle.addEventListener('change', () => {
  setSkimmingEnabled(skimmingToggle.checked);
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
  if (!skimmerOverTimeline && (x < visibleLeft + 20 || x > visibleRight - 20)) {
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
  const editingVideo = activeEditingVideo();
  const dur = clip.duration || 1;
  const startPct = (clip.trimStart / dur) * 100;
  const endPct = (clip.trimEnd / dur) * 100;
  scrubberRange.style.left = `${startPct}%`;
  scrubberRange.style.right = `${100 - endPct}%`;
  handleStart.style.left = `${startPct}%`;
  handleEnd.style.left = `${endPct}%`;
  const cur = editingVideo.currentTime || 0;
  scrubberPlayhead.style.left = `${(cur / dur) * 100}%`;
  previewTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  const trimDur = Math.max(clip.trimEnd - clip.trimStart, 0.001);
  const localCur = Math.max(0, Math.min(trimDur, cur - clip.trimStart));
  kfStripPlayhead.style.left = `${(localCur / trimDur) * 100}%`;
  updateTimelinePlayhead();
}

// ---- Zoom (crop-in) + keyframed pan ----

function getLocalT(clip) {
  return activeEditingVideo().currentTime - clip.trimStart;
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

// The <video> element fills the preview box while object-fit:contain places the
// actual source image inside it. Convert between source-normalized coordinates
// and element-normalized coordinates so pan math remains correct when the
// source and output orientations differ (the unused area is letterboxed before
// the auto-fit scale is applied).
function sourceToPreviewPoint(clip, x, y) {
  if (!clip.width || !clip.height) return { x, y };
  const videoAspect = clip.width / clip.height;
  const boxAspect = orientationSelect.value === 'portrait' ? 9 / 16 : 16 / 9;
  if (videoAspect > boxAspect) {
    const contentH = boxAspect / videoAspect;
    return { x, y: (1 - contentH) / 2 + y * contentH };
  }
  if (videoAspect < boxAspect) {
    const contentW = videoAspect / boxAspect;
    return { x: (1 - contentW) / 2 + x * contentW, y };
  }
  return { x, y };
}

function previewToSourcePoint(clip, x, y) {
  if (!clip.width || !clip.height) return { x, y };
  const videoAspect = clip.width / clip.height;
  const boxAspect = orientationSelect.value === 'portrait' ? 9 / 16 : 16 / 9;
  if (videoAspect > boxAspect) {
    const contentH = boxAspect / videoAspect;
    return { x, y: (y - (1 - contentH) / 2) / contentH };
  }
  if (videoAspect < boxAspect) {
    const contentW = videoAspect / boxAspect;
    return { x: (x - (1 - contentW) / 2) / contentW, y };
  }
  return { x, y };
}

// ffmpeg clamps the crop window at the source edges. Apply the equivalent
// clamp in the preview so centering a point near an edge never reveals empty
// space and the preview continues to match the exported frame.
function clampPreviewPanPoint(clip, point, scale) {
  const topLeft = sourceToPreviewPoint(clip, 0, 0);
  const bottomRight = sourceToPreviewPoint(clip, 1, 1);
  const halfVisible = 0.5 / scale;
  const minX = topLeft.x + halfVisible;
  const maxX = bottomRight.x - halfVisible;
  const minY = topLeft.y + halfVisible;
  const maxY = bottomRight.y - halfVisible;
  return {
    x: minX <= maxX ? Math.min(maxX, Math.max(minX, point.x)) : 0.5,
    y: minY <= maxY ? Math.min(maxY, Math.max(minY, point.y)) : 0.5,
  };
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
  // Keep the enlarged timeline fully visible even on a small window. The
  // preview remains larger on taller displays because this scales with height.
  const maxHeight = window.innerHeight * (largePreview ? 0.68 : 0.38);

  let boxWidth = availWidth;
  let boxHeight = boxWidth / ratio;
  if (boxHeight > maxHeight) {
    boxHeight = maxHeight;
    boxWidth = boxHeight * ratio;
  }
  previewVideoBox.style.width = `${Math.round(boxWidth)}px`;
  previewVideoBox.style.height = `${Math.round(boxHeight)}px`;
  comparisonStage.classList.toggle('portrait', orientationSelect.value === 'portrait');
  comparisonStage.classList.toggle('landscape', orientationSelect.value !== 'portrait');
  requestAnimationFrame(applyComparisonTransforms);
}
window.addEventListener('resize', updatePreviewBoxAspect);

function applyPreviewZoom() {
  const clip = selectedClip();
  if (!clip) {
    previewVideo.style.transform = 'none';
    applyComparisonTransforms();
    return;
  }
  const totalScale = getAutoFitScale(clip) * (clip.zoom || 1);
  const pan = getEffectivePan(clip, getLocalT(clip));
  const point = clampPreviewPanPoint(clip, sourceToPreviewPoint(clip, pan.x, pan.y), totalScale);
  const rect = previewVideoBox.getBoundingClientRect();
  const dx = totalScale * (0.5 - point.x) * rect.width;
  const dy = totalScale * (0.5 - point.y) * rect.height;
  previewVideo.style.transformOrigin = '50% 50%';
  previewVideo.style.transform = totalScale > 1.001
    ? `translate(${dx}px, ${dy}px) scale(${totalScale})`
    : 'none';
  applyComparisonTransforms();
}

function comparisonSourceToPanePoint(clip, x, y, pane) {
  const rect = pane.getBoundingClientRect();
  if (!clip.width || !clip.height || !rect.width || !rect.height) return { x, y };
  const videoAspect = clip.width / clip.height;
  const paneAspect = rect.width / rect.height;
  if (videoAspect > paneAspect) {
    const contentH = paneAspect / videoAspect;
    return { x, y: (1 - contentH) / 2 + y * contentH };
  }
  if (videoAspect < paneAspect) {
    const contentW = videoAspect / paneAspect;
    return { x: (1 - contentW) / 2 + x * contentW, y };
  }
  return { x, y };
}

function comparisonPaneToSourcePoint(clip, x, y, pane) {
  const rect = pane.getBoundingClientRect();
  if (!clip.width || !clip.height || !rect.width || !rect.height) return { x, y };
  const videoAspect = clip.width / clip.height;
  const paneAspect = rect.width / rect.height;
  if (videoAspect > paneAspect) {
    const contentH = paneAspect / videoAspect;
    return { x, y: (y - (1 - contentH) / 2) / contentH };
  }
  if (videoAspect < paneAspect) {
    const contentW = videoAspect / paneAspect;
    return { x: (x - (1 - contentW) / 2) / contentW, y };
  }
  return { x, y };
}

function clampComparisonPanPoint(clip, point, scale, pane) {
  const topLeft = comparisonSourceToPanePoint(clip, 0, 0, pane);
  const bottomRight = comparisonSourceToPanePoint(clip, 1, 1, pane);
  const halfVisible = 0.5 / scale;
  const minX = topLeft.x + halfVisible;
  const maxX = bottomRight.x - halfVisible;
  const minY = topLeft.y + halfVisible;
  const maxY = bottomRight.y - halfVisible;
  return {
    x: minX <= maxX ? Math.min(maxX, Math.max(minX, point.x)) : 0.5,
    y: minY <= maxY ? Math.min(maxY, Math.max(minY, point.y)) : 0.5,
  };
}

function applyComparisonVideoTransform(video, pane, clip) {
  if (!comparisonMode || !clip) {
    video.style.transform = 'none';
    return;
  }
  const scale = clip.zoom || 1;
  const localT = video.currentTime - clip.trimStart;
  const pan = getEffectivePan(clip, localT);
  const point = clampComparisonPanPoint(
    clip,
    comparisonSourceToPanePoint(clip, pan.x, pan.y, pane),
    scale,
    pane
  );
  const rect = pane.getBoundingClientRect();
  const dx = scale * (0.5 - point.x) * rect.width;
  const dy = scale * (0.5 - point.y) * rect.height;
  video.style.transformOrigin = '50% 50%';
  video.style.transform = scale > 1.001
    ? `translate(${dx}px, ${dy}px) scale(${scale})`
    : 'none';
}

function applyComparisonTransforms() {
  applyComparisonVideoTransform(compareVideoA, comparePaneA, comparisonClip(compareClipASelect));
  applyComparisonVideoTransform(compareVideoB, comparePaneB, comparisonClip(compareClipBSelect));
}

function sizeRecordingCanvas() {
  const portrait = orientationSelect.value === 'portrait';
  const [baseW, baseH] = recordingQuality === '4k' ? [3840, 2160] : [1920, 1080];
  recordingCanvas.width = portrait ? baseH : baseW;
  recordingCanvas.height = portrait ? baseW : baseH;
  recordingVideoFrameCanvas.width = recordingCanvas.width;
  recordingVideoFrameCanvas.height = recordingCanvas.height;
  const frameCtx = recordingVideoFrameCanvas.getContext('2d');
  frameCtx.fillStyle = '#000';
  frameCtx.fillRect(0, 0, recordingVideoFrameCanvas.width, recordingVideoFrameCanvas.height);
}

function drawAnnotationStroke(ctx, stroke, width, height) {
  if (!stroke.points.length) return;
  const points = stroke.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width * height;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (stroke.tool === 'arrow') {
    const end = points[points.length - 1];
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    if (points.length > 1) {
      const start = points[0];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const head = Math.max(16, ctx.lineWidth * 4);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRecordingAnnotations(ctx, width, height) {
  const now = performance.now();
  drawingStrokes = drawingStrokes.filter((stroke) =>
    stroke === activeDrawingStroke || !stroke.expiresAt || stroke.expiresAt > now
  );
  drawingStrokes.forEach((stroke) => drawAnnotationStroke(ctx, stroke, width, height));
}

function recordingCanvasPoint(event) {
  const rect = recordingCanvas.getBoundingClientRect();
  const scale = Math.min(rect.width / recordingCanvas.width, rect.height / recordingCanvas.height);
  const contentWidth = recordingCanvas.width * scale;
  const contentHeight = recordingCanvas.height * scale;
  const left = rect.left + (rect.width - contentWidth) / 2;
  const top = rect.top + (rect.height - contentHeight) / 2;
  if (event.clientX < left || event.clientX > left + contentWidth ||
      event.clientY < top || event.clientY > top + contentHeight) return null;
  return {
    x: (event.clientX - left) / contentWidth,
    y: (event.clientY - top) / contentHeight,
  };
}

function drawRecordingCanvasFrame(timestamp = performance.now()) {
  if (!recordingMode) return;
  // The captured stream is 30fps, so drawing the two Full-HD canvases at the
  // display's 60/120Hz refresh rate only wastes GPU work. While paused, 5fps is
  // sufficient for annotation expiry and volume/tool feedback; active video,
  // reverse shuttle, and pointer drawing stay capped at 30fps.
  const activeVisuals = !previewVideo.paused || Boolean(shuttleTimer) || Boolean(activeDrawingStroke);
  const interval = activeVisuals ? (1000 / 30) : 200;
  if (recordingLastDrawAt && timestamp - recordingLastDrawAt < interval) {
    recordingDrawFrame = requestAnimationFrame(drawRecordingCanvasFrame);
    return;
  }
  recordingLastDrawAt = timestamp;
  const ctx = recordingCanvas.getContext('2d');
  const frameCtx = recordingVideoFrameCanvas.getContext('2d');
  const outW = recordingCanvas.width;
  const outH = recordingCanvas.height;
  const clip = selectedClip();
  // Keep the last completely decoded video frame while a reverse-shuttle seek
  // is pending. Clearing the visible canvas first made slow/4K seeks appear as
  // a long black freeze even though the shuttle itself was still progressing.
  if (!seekPending && clip && previewVideo.readyState >= 2 && previewVideo.videoWidth && previewVideo.videoHeight) {
    const srcW = previewVideo.videoWidth;
    const srcH = previewVideo.videoHeight;
    const outAspect = outW / outH;
    const srcAspect = srcW / srcH;
    let baseW = srcW;
    let baseH = srcH;
    if (srcAspect > outAspect) baseW = srcH * outAspect;
    else if (srcAspect < outAspect) baseH = srcW / outAspect;
    const zoom = Math.max(1, clip.zoom || 1);
    const cropW = baseW / zoom;
    const cropH = baseH / zoom;
    const pan = getEffectivePan(clip, getLocalT(clip));
    const sx = Math.max(0, Math.min(srcW - cropW, pan.x * srcW - cropW / 2));
    const sy = Math.max(0, Math.min(srcH - cropH, pan.y * srcH - cropH / 2));
    frameCtx.fillStyle = '#000';
    frameCtx.fillRect(0, 0, outW, outH);
    frameCtx.drawImage(previewVideo, sx, sy, cropW, cropH, 0, 0, outW, outH);
  }
  ctx.drawImage(recordingVideoFrameCanvas, 0, 0, outW, outH);
  drawRecordingAnnotations(ctx, outW, outH);
  recordingDrawFrame = requestAnimationFrame(drawRecordingCanvasFrame);
}

async function ensureRecordingAudioGraph() {
  if (!recordingAudioContext) {
    recordingAudioContext = new AudioContext();
    recordingVideoSource = recordingAudioContext.createMediaElementSource(previewVideo);
    recordingSpeakerGain = recordingAudioContext.createGain();
    recordingVideoSource.connect(recordingSpeakerGain);
    recordingSpeakerGain.connect(recordingAudioContext.destination);
  }
  await recordingAudioContext.resume();
}

async function enterRecordingMode() {
  if (!selectedClip() || recordingMode) return;
  recordingMode = true;
  drawingStrokes = [];
  activeDrawingStroke = null;
  recordingLastDrawAt = 0;
  recordingStatus.textContent = '';
  sizeRecordingCanvas();
  recordingOverlay.classList.remove('hidden');
  await window.api.setFullScreen(true);
  drawRecordingCanvasFrame();
}

async function exitRecordingMode() {
  if (recordingActive) return;
  recordingMode = false;
  if (recordingDrawFrame) cancelAnimationFrame(recordingDrawFrame);
  recordingDrawFrame = null;
  recordingOverlay.classList.add('hidden');
  await window.api.setFullScreen(false);
}

function updateRecordingVolumeLabels() {
  sourceVolumeValue.textContent = `${Math.round(Number(sourceVolume.value) * 100)}%`;
  micVolumeValue.textContent = `${Math.round(Number(micVolume.value) * 100)}%`;
  sourceMuteBtn.textContent = sourceMuted ? '🔇' : '🔊';
  micMuteBtn.textContent = micMuted ? '🚫🎤' : '🎤';
  sourceMuteBtn.classList.toggle('active', sourceMuted);
  micMuteBtn.classList.toggle('active', micMuted);
  if (recordingSourceGain) recordingSourceGain.gain.value = sourceMuted ? 0 : Number(sourceVolume.value);
  if (recordingMicGain) recordingMicGain.gain.value = micMuted ? 0 : Number(micVolume.value);
}

async function startReviewRecording(outputOverride = null) {
  if (recordingActive || !selectedClip()) return;
  const outputPath = outputOverride || await window.api.selectOutput(`review_${new Date().toISOString().slice(0, 10)}.mp4`);
  if (!outputPath) return;
  try {
    recordingStatus.textContent = 'マイクを準備中…';
    recordingMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    await ensureRecordingAudioGraph();
    const mixDestination = recordingAudioContext.createMediaStreamDestination();
    recordingSourceGain = recordingAudioContext.createGain();
    recordingSourceGain.gain.value = sourceMuted ? 0 : Number(sourceVolume.value);
    recordingVideoSource.connect(recordingSourceGain);
    recordingSourceGain.connect(mixDestination);
    const micSource = recordingAudioContext.createMediaStreamSource(recordingMicStream);
    recordingMicGain = recordingAudioContext.createGain();
    recordingMicGain.gain.value = micMuted ? 0 : Number(micVolume.value);
    micSource.connect(recordingMicGain);
    recordingMicGain.connect(mixDestination);

    const canvasStream = recordingCanvas.captureStream(30);
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...mixDestination.stream.getAudioTracks(),
    ]);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm;codecs=vp8,opus';
    recordingSessionId = await window.api.startReviewRecording(outputPath);
    recordingWriteChain = Promise.resolve();
    mediaRecorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: recordingQuality === '4k' ? 35_000_000 : 12_000_000,
      audioBitsPerSecond: 192_000,
    });
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (!event.data || event.data.size === 0 || !recordingSessionId) return;
      recordingWriteChain = recordingWriteChain.then(async () => {
        const chunk = await event.data.arrayBuffer();
        await window.api.appendReviewRecording({ id: recordingSessionId, chunk });
      });
    });
    mediaRecorder.start(1000);
    recordingActive = true;
    recordingStartedAt = Date.now();
    recordingControls.classList.add('recording');
    recordingBadge.classList.remove('hidden');
    stopRecordingBtn.classList.remove('hidden');
    startRecordingBtn.classList.add('hidden');
    exitRecordingBtn.disabled = true;
    recordingFhdBtn.disabled = true;
    recording4kBtn.disabled = true;
    recordingStatus.textContent = '';
    recordingClock = setInterval(() => {
      recordingTime.textContent = fmtTime((Date.now() - recordingStartedAt) / 1000);
    }, 250);
    previewVideo.play();
  } catch (error) {
    if (recordingSessionId) await window.api.cancelReviewRecording(recordingSessionId);
    recordingSessionId = null;
    if (recordingMicStream) recordingMicStream.getTracks().forEach((track) => track.stop());
    recordingMicStream = null;
    recordingStatus.textContent = `収録を開始できません: ${error.message}`;
  }
}

async function stopReviewRecording() {
  if (!recordingActive || !mediaRecorder) return;
  stopRecordingBtn.disabled = true;
  recordingStatus.textContent = 'MP4を作成中…';
  const stopped = new Promise((resolve) => mediaRecorder.addEventListener('stop', resolve, { once: true }));
  mediaRecorder.stop();
  await stopped;
  await recordingWriteChain;
  clearInterval(recordingClock);
  recordingClock = null;
  try {
    const result = await window.api.finishReviewRecording(recordingSessionId);
    rememberExportedVideo(result.outputPath);
    recordingStatus.textContent = `保存しました: ${result.outputPath}`;
    statusText.textContent = `画面収録を保存しました: ${result.outputPath}`;
  } catch (error) {
    recordingStatus.textContent = error.message;
  } finally {
    recordingActive = false;
    recordingSessionId = null;
    mediaRecorder = null;
    if (recordingMicStream) recordingMicStream.getTracks().forEach((track) => track.stop());
    recordingMicStream = null;
    if (recordingSourceGain) recordingSourceGain.disconnect();
    if (recordingMicGain) recordingMicGain.disconnect();
    recordingSourceGain = null;
    recordingMicGain = null;
    recordingControls.classList.remove('recording');
    recordingBadge.classList.add('hidden');
    stopRecordingBtn.classList.add('hidden');
    startRecordingBtn.classList.remove('hidden');
    exitRecordingBtn.disabled = false;
    recordingFhdBtn.disabled = false;
    recording4kBtn.disabled = false;
    stopRecordingBtn.disabled = false;
  }
}

recordModeBtn.addEventListener('click', enterRecordingMode);
exitRecordingBtn.addEventListener('click', exitRecordingMode);
startRecordingBtn.addEventListener('click', () => startReviewRecording());
stopRecordingBtn.addEventListener('click', stopReviewRecording);
sourceVolume.addEventListener('input', updateRecordingVolumeLabels);
micVolume.addEventListener('input', updateRecordingVolumeLabels);
sourceMuteBtn.addEventListener('click', () => {
  sourceMuted = !sourceMuted;
  updateRecordingVolumeLabels();
});
micMuteBtn.addEventListener('click', () => {
  micMuted = !micMuted;
  updateRecordingVolumeLabels();
});
function setDrawingTool(tool) {
  drawingTool = tool;
  penToolBtn.classList.toggle('active', tool === 'pen');
  arrowToolBtn.classList.toggle('active', tool === 'arrow');
}
penToolBtn.addEventListener('click', () => setDrawingTool('pen'));
arrowToolBtn.addEventListener('click', () => setDrawingTool('arrow'));
function setRecordingQuality(quality) {
  if (recordingActive) return;
  recordingQuality = quality === '4k' ? '4k' : 'fhd';
  localStorage.setItem('recordingQuality', recordingQuality);
  recordingFhdBtn.classList.toggle('active', recordingQuality === 'fhd');
  recording4kBtn.classList.toggle('active', recordingQuality === '4k');
  if (recordingMode) {
    sizeRecordingCanvas();
    recordingLastDrawAt = 0;
  }
  recordingStatus.textContent = recordingQuality === '4k'
    ? '4K録画：高画質（PC負荷は高くなります）'
    : 'フルHD録画：低負荷';
}
recordingFhdBtn.addEventListener('click', () => setRecordingQuality('fhd'));
recording4kBtn.addEventListener('click', () => setRecordingQuality('4k'));
setRecordingQuality(recordingQuality);
function setDrawingLifetime(value) {
  drawingLifetimeMs = value === 'always' ? null : Number(value);
  localStorage.setItem('drawingLifetime', value);
  drawing2sBtn.classList.toggle('active', value === '2000');
  drawing3sBtn.classList.toggle('active', value === '3000');
  drawingAlwaysBtn.classList.toggle('active', value === 'always');
}
drawing2sBtn.addEventListener('click', () => setDrawingLifetime('2000'));
drawing3sBtn.addEventListener('click', () => setDrawingLifetime('3000'));
drawingAlwaysBtn.addEventListener('click', () => setDrawingLifetime('always'));
setDrawingLifetime(drawingLifetimeMs === null ? 'always' : String(drawingLifetimeMs));
clearDrawingBtn.addEventListener('click', () => {
  drawingStrokes = [];
  activeDrawingStroke = null;
});
recordingCanvas.addEventListener('pointerdown', (event) => {
  const point = recordingCanvasPoint(event);
  if (!point || !recordingMode) return;
  event.preventDefault();
  recordingCanvas.setPointerCapture(event.pointerId);
  activeDrawingStroke = {
    tool: drawingTool,
    color: drawingColor.value,
    width: Number(drawingWidth.value) / 1080,
    points: [point],
    expiresAt: null,
  };
  drawingStrokes.push(activeDrawingStroke);
});
recordingCanvas.addEventListener('pointermove', (event) => {
  if (!activeDrawingStroke) return;
  const point = recordingCanvasPoint(event);
  if (!point) return;
  event.preventDefault();
  if (activeDrawingStroke.tool === 'arrow') activeDrawingStroke.points = [activeDrawingStroke.points[0], point];
  else activeDrawingStroke.points.push(point);
});
const finishDrawingStroke = () => {
  if (activeDrawingStroke) {
    activeDrawingStroke.expiresAt = drawingLifetimeMs === null
      ? null
      : performance.now() + drawingLifetimeMs;
  }
  activeDrawingStroke = null;
};
recordingCanvas.addEventListener('pointerup', finishDrawingStroke);
recordingCanvas.addEventListener('pointercancel', finishDrawingStroke);
updateRecordingVolumeLabels();

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
      activeEditingVideo().currentTime = absT;
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
      activeEditingVideo().currentTime = absT;
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
  speedSegPending.textContent = `${fmtOrDash(pendingSegStart)} → ${fmtOrDash(pendingSegEnd)}`;
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

async function addKeyframeAtCurrentTime() {
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
  statusText.textContent = `${fmtTime(activeEditingVideo().currentTime)} にキーフレームを追加しました`;
}

addKeyframeBtn.addEventListener('click', addKeyframeAtCurrentTime);

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
  if (comparisonMode) return;
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
  const startPoint = clampPreviewPanPoint(
    clip,
    sourceToPreviewPoint(clip, panDrag.startZoomX, panDrag.startZoomY),
    zoom
  );
  const sourcePoint = previewToSourcePoint(clip, startPoint.x - dx / zoom, startPoint.y - dy / zoom);
  const nx = Math.min(1, Math.max(0, sourcePoint.x));
  const ny = Math.min(1, Math.max(0, sourcePoint.y));
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
  if (comparisonMode) return;
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
  // With the current pan point centered, a displayed click at f corresponds
  // to source element coordinate pan + (f - 0.5) / scale. The old formula
  // subtracted the pan coordinate instead of the preview center, so every
  // keyframe after the first accumulated an offset whenever pan != 0.5.
  const prevPoint = clampPreviewPanPoint(clip, sourceToPreviewPoint(clip, prev.x, prev.y), zoom);
  const sourcePoint = previewToSourcePoint(
    clip,
    prevPoint.x + (fx - 0.5) / zoom,
    prevPoint.y + (fy - 0.5) / zoom
  );
  const nx = Math.min(1, Math.max(0, sourcePoint.x));
  const ny = Math.min(1, Math.max(0, sourcePoint.y));

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

let comparisonPanDrag = null;
let comparisonDragJustHappened = false;

function beginComparisonPan(event, side) {
  if (event.target.classList.contains('compare-pane-scrubber')) return;
  const clip = comparisonClip(side === 'a' ? compareClipASelect : compareClipBSelect);
  if (!clip) return;
  activateComparisonPane(side);
  const video = side === 'a' ? compareVideoA : compareVideoB;
  const pane = side === 'a' ? comparePaneA : comparePaneB;
  const start = getEffectivePan(clip, video.currentTime - clip.trimStart);
  comparisonPanDrag = {
    clipId: clip.id,
    video,
    pane,
    startX: event.clientX,
    startY: event.clientY,
    startZoomX: start.x,
    startZoomY: start.y,
    pushed: false,
  };
}

comparePaneA.addEventListener('mousedown', (event) => beginComparisonPan(event, 'a'));
comparePaneB.addEventListener('mousedown', (event) => beginComparisonPan(event, 'b'));

document.addEventListener('mousemove', (event) => {
  if (!comparisonPanDrag) return;
  const clip = clips.find((item) => item.id === comparisonPanDrag.clipId);
  if (!clip) {
    comparisonPanDrag = null;
    return;
  }
  const rect = comparisonPanDrag.pane.getBoundingClientRect();
  const dx = (event.clientX - comparisonPanDrag.startX) / rect.width;
  const dy = (event.clientY - comparisonPanDrag.startY) / rect.height;
  if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) return;
  comparisonDragJustHappened = true;
  if (!comparisonPanDrag.pushed) {
    pushHistory();
    comparisonPanDrag.pushed = true;
  }
  const scale = clip.zoom || 1;
  const startPoint = clampComparisonPanPoint(
    clip,
    comparisonSourceToPanePoint(clip, comparisonPanDrag.startZoomX, comparisonPanDrag.startZoomY, comparisonPanDrag.pane),
    scale,
    comparisonPanDrag.pane
  );
  const sourcePoint = comparisonPaneToSourcePoint(
    clip,
    startPoint.x - dx / scale,
    startPoint.y - dy / scale,
    comparisonPanDrag.pane
  );
  const nx = Math.min(1, Math.max(0, sourcePoint.x));
  const ny = Math.min(1, Math.max(0, sourcePoint.y));
  if (clip.panAnimated) {
    upsertKeyframeAt(clip, comparisonPanDrag.video.currentTime - clip.trimStart, nx, ny);
    renderKeyframeMarkers();
  } else {
    clip.zoomX = nx;
    clip.zoomY = ny;
  }
  applyComparisonTransforms();
});

document.addEventListener('mouseup', () => {
  comparisonPanDrag = null;
});

function centerComparisonPane(event, side) {
  if (event.target.classList.contains('compare-pane-scrubber')) return;
  if (comparisonDragJustHappened) {
    comparisonDragJustHappened = false;
    return;
  }
  const clip = comparisonClip(side === 'a' ? compareClipASelect : compareClipBSelect);
  if (!clip) return;
  activateComparisonPane(side);
  const video = side === 'a' ? compareVideoA : compareVideoB;
  const pane = side === 'a' ? comparePaneA : comparePaneB;
  const rect = pane.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  const scale = clip.zoom || 1;
  const previous = getEffectivePan(clip, video.currentTime - clip.trimStart);
  const previousPoint = clampComparisonPanPoint(
    clip,
    comparisonSourceToPanePoint(clip, previous.x, previous.y, pane),
    scale,
    pane
  );
  const sourcePoint = comparisonPaneToSourcePoint(
    clip,
    previousPoint.x + (fx - 0.5) / scale,
    previousPoint.y + (fy - 0.5) / scale,
    pane
  );
  const nx = Math.min(1, Math.max(0, sourcePoint.x));
  const ny = Math.min(1, Math.max(0, sourcePoint.y));
  pushHistory();
  if (clip.panAnimated) {
    upsertKeyframeAt(clip, video.currentTime - clip.trimStart, nx, ny);
    renderKeyframeMarkers();
  } else {
    clip.zoomX = nx;
    clip.zoomY = ny;
  }
  applyComparisonTransforms();
}

comparePaneA.addEventListener('click', (event) => centerComparisonPane(event, 'a'));
comparePaneB.addEventListener('click', (event) => centerComparisonPane(event, 'b'));

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
  shuttleRunId++;
  if (shuttleTimer) {
    clearTimeout(shuttleTimer);
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
previewVideo.addEventListener('seeking', () => { seekPending = true; });
previewVideo.addEventListener('seeked', () => { seekPending = false; });

function waitForFrameSettled() {
  return new Promise((resolve) => {
    const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (comparisonMode) { afterPaint(); return; }
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

// Reverse playback is not supported natively. Decode one seek completely before
// requesting the next one. Each decoded step advances a fixed amount instead of
// using accumulated wall time, so a slow 4K decode cannot suddenly jump several
// seconds after appearing to pause. Forward shuttle uses native playbackRate.
function startShuttleTimer(rate, direction) {
  stopShuttleTimer();
  const runId = shuttleRunId;
  previewVideo.pause();
  const run = () => {
    if (runId !== shuttleRunId) return;
    const clip = selectedClip();
    if (!clip) {
      stopShuttleTimer();
      return;
    }
    const step = rate / 12;
    let t = previewVideo.currentTime + (direction === 'forward' ? step : -step);
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
    if (hitStart || hitEnd) return;

    let resumed = false;
    const afterDecodedFrame = () => {
      if (resumed || runId !== shuttleRunId) return;
      resumed = true;
      previewVideo.removeEventListener('seeked', afterDecodedFrame);
      // Give the newly decoded frame a paint opportunity before requesting the
      // next one. This also keeps the retained recording frame in sync.
      shuttleTimer = setTimeout(run, 16);
    };
    previewVideo.addEventListener('seeked', afterDecodedFrame, { once: true });
    // Some codecs do not emit seeked for every nearby target. This is only a
    // safety fallback; importantly, there can still be only one pending seek.
    shuttleTimer = setTimeout(afterDecodedFrame, 250);
  };
  shuttleTimer = setTimeout(run, 0);
}

function startForwardShuttlePlayback(clip, rate) {
  stopShuttleTimer();
  const runId = shuttleRunId;
  previewVideo.pause();
  const begin = () => {
    if (runId !== shuttleRunId || shuttleDirection !== 'forward') return;
    previewVideo.preservesPitch = false;
    previewVideo.playbackRate = Math.min(16, rate * (clip.speed || 1));
    previewVideo.play().catch(() => {});
    updatePlayLabel();
  };
  if (seekPending) {
    previewVideo.addEventListener('seeked', () => requestAnimationFrame(begin), { once: true });
  } else {
    begin();
  }
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
  startForwardShuttlePlayback(clip, rate);
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

function cutAtPlayhead(targetOverride = null) {
  const clip = targetOverride
    ? clips.find((candidate) => candidate.id === targetOverride.clipId)
    : selectedClip();
  if (!clip) return;
  sequencePlaying = false;
  const t = targetOverride ? targetOverride.time : previewVideo.currentTime;
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
  const originalTrimDur = clip.trimEnd - clip.trimStart;
  const speedSegments = clip.speedSegments || [];
  const frontSpeedSegments = speedSegments
    .map((s) => ({ ...s, end: Math.min(s.end, splitLocalT) }))
    .filter((s) => s.end - s.start > 0.001);
  const backSpeedSegments = speedSegments
    .map((s) => ({
      ...s,
      start: Math.max(s.start, splitLocalT) - splitLocalT,
      end: Math.min(s.end, originalTrimDur) - splitLocalT,
    }))
    .filter((s) => s.end - s.start > 0.001);
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
    speedSegments: backSpeedSegments,
  };
  clip.panKeyframes = frontKfs;
  clip.speedSegments = frontSpeedSegments;
  clip.trimEnd = t;
  clips.splice(idx + 1, 0, newClip);
  transitions.splice(idx, 0, { type: 'cut', duration: 0.5 });
  if (exportSelectedClipIds.has(clip.id)) exportSelectedClipIds.add(newClip.id);

  // Always retarget selection to the back half (same file, so currentTime/playback
  // state is left untouched) — playing or paused, the playhead is now sitting at the
  // start of the new segment, ready for the next consecutive blade cut (FCP-style).
  if (targetOverride) {
    selectClip(newClip.id, { seekTo: t });
    skimmerTarget = null;
    timelineSkimmer.style.display = 'none';
  } else {
    selectClip(newClip.id, { keepPlayback: true });
  }
  statusText.textContent = `${clip.name} を ${fmtTime(t)} で分割しました`;
}

document.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const tag = active && active.tagName;
  const isTypingField = tag === 'TEXTAREA' || tag === 'SELECT' ||
    (tag === 'INPUT' && !['checkbox', 'range'].includes(active.type));
  if (isTypingField) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (comparisonMode) {
    const key = e.key.toLowerCase();
    if (e.key === '@') {
      e.preventDefault();
      closeComparisonPreview();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeComparisonPreview();
    } else if ((key === 'k' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      toggleComparisonPlayback();
    } else if (key === 'l' && !e.repeat) {
      e.preventDefault();
      if (compareVideoA.paused) toggleComparisonPlayback();
    } else if (key === 'j' && !e.repeat) {
      e.preventDefault();
      restartComparisonPreview();
    } else if ((key === ';' || e.key === '+') && !e.repeat) {
      e.preventDefault();
      addKeyframeAtCurrentTime();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.repeat) {
      e.preventDefault();
      compareVideoA.pause();
      compareVideoB.pause();
      const step = (e.key === 'ArrowLeft' ? -1 : 1) / 30;
      const a = comparisonClip(compareClipASelect);
      const b = comparisonClip(compareClipBSelect);
      if (a && b) {
        const elapsed = Math.max(0, Math.min(comparisonDuration(), compareVideoA.currentTime - clampComparisonStart(compareStartA, a) + step));
        compareVideoA.currentTime = clampComparisonStart(compareStartA, a) + elapsed;
        compareVideoB.currentTime = clampComparisonStart(compareStartB, b) + elapsed;
      }
    }
    return;
  }

  if (recordingMode) {
    if (e.key.toLowerCase() === 'r' && !e.repeat) {
      e.preventDefault();
      if (recordingActive) stopReviewRecording();
      else startReviewRecording();
    } else if (e.key === 'Escape' && !recordingActive) {
      e.preventDefault();
      exitRecordingMode();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) spacePlayPause();
    } else if (e.key.toLowerCase() === 'j' && !e.repeat) {
      e.preventDefault();
      pressJ();
    } else if (e.key.toLowerCase() === 'k' && !e.repeat) {
      e.preventDefault();
      pressK();
    } else if (e.key.toLowerCase() === 'l' && !e.repeat) {
      e.preventDefault();
      pressL();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepFrame(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepFrame(1);
    }
    return;
  }

  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      spacePlayPause();
      break;
    case 'l':
      if (e.repeat) break;
      pressL();
      break;
    case 'k':
      if (e.repeat) break;
      pressK();
      break;
    case 'j':
      if (e.repeat) break;
      pressJ();
      break;
    case 'b':
      cutAtPlayhead(skimmingToggle.checked && skimmerOverTimeline ? skimmerTarget : null);
      break;
    case 'f':
      if (e.repeat || !selectedClipId) break;
      e.preventDefault();
      duplicateClip(selectedClipId);
      break;
    case 'e':
      if (e.repeat || exporting || exportSelectedClipIds.size === 0) break;
      e.preventDefault();
      exportSelectedBtn.click();
      break;
    case 'r':
      if (e.repeat || !selectedClipId) break;
      e.preventDefault();
      enterRecordingMode();
      break;
    case 'w':
      if (e.repeat) break;
      e.preventDefault();
      waveformsVisible = !waveformsVisible;
      document.body.classList.toggle('waveforms-hidden', !waveformsVisible);
      localStorage.setItem('waveformsVisible', String(waveformsVisible));
      statusText.textContent = `音声波形を${waveformsVisible ? '表示' : '非表示'}にしました`;
      break;
    case 'a':
      if (e.repeat) break;
      e.preventDefault();
      setSkimmingEnabled(false);
      statusText.textContent = '選択モードに切り替えました';
      break;
    case 's':
      if (e.repeat) break;
      e.preventDefault();
      setSkimmingEnabled(!skimmingToggle.checked, { announce: true });
      break;
    case '@':
      if (e.repeat || comparePreviewBtn.disabled) break;
      e.preventDefault();
      openComparisonPreview();
      break;
    case ';':
    case '+':
      if (e.repeat || !selectedClipId) break;
      e.preventDefault();
      addKeyframeAtCurrentTime();
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
      trimStartToPlayhead(skimmingToggle.checked && skimmerOverTimeline ? skimmerTarget : null);
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

function trimStartToPlayhead(targetOverride = null) {
  const clip = targetOverride
    ? clips.find((candidate) => candidate.id === targetOverride.clipId)
    : selectedClip();
  if (!clip) return;
  if (targetOverride) {
    // A skim seek may still be decoding an older hover position. Use the exact
    // orange-skimmer target for N, cancel that pending seek, and explicitly put
    // the red playhead back on the retained boundary after the timeline rerenders.
    stopSkimSeeking();
    sequencePlaying = false;
    previewVideo.pause();
  }
  pushHistory();
  const requestedTime = targetOverride ? targetOverride.time : previewVideo.currentTime;
  const t = Math.min(requestedTime, clip.trimEnd - 0.1);
  setClipTrimStart(clip, Math.max(0, t));
  render();
  if (targetOverride) {
    skimmerOverTimeline = false;
    skimmerTarget = null;
    timelineSkimmer.style.display = 'none';
    selectClip(clip.id, { seekTo: t });
    requestAnimationFrame(() => {
      const { layout } = computeTimelineLayout();
      const item = layout.find((entry) => entry.clip.id === clip.id);
      if (!item) return;
      const trackRect = timelineTrack.getBoundingClientRect();
      window.api.moveCursor({
        clientX: trackRect.left + item.x,
        clientY: trackRect.top + trackRect.height / 2,
      });
    });
  } else {
    updateScrubberUI();
  }
  statusText.textContent = `${clip.name} の再生位置より前を削除しました`;
}

function trimEndToPlayhead() {
  const clip = selectedClip();
  if (!clip) return;
  pushHistory();
  const t = Math.max(previewVideo.currentTime, clip.trimStart + 0.1);
  setClipTrimEnd(clip, Math.min(clip.duration, t));
  updateScrubberUI();
  render();
  statusText.textContent = `${clip.name} の再生位置より後ろを削除しました`;
}

setInBtn.addEventListener('click', () => trimStartToPlayhead());
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
  const originalClip = selectedClip();
  const snapshot = originalClip ? JSON.parse(JSON.stringify(originalClip)) : null;
  const onMove = (e) => {
    const clip = selectedClip();
    if (!clip || clip !== originalClip || !snapshot || !dragHandle) return;
    replaceClipData(clip, snapshot);
    const t = timeFromClientX(e.clientX);
    if (dragHandle === 'start') {
      setClipTrimStart(clip, t);
      previewVideo.currentTime = clip.trimStart;
    } else {
      setClipTrimEnd(clip, t);
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
  const target = timeFromClientX(e.clientX);
  if (comparisonMode) {
    compareVideoA.pause();
    compareVideoB.pause();
    const a = comparisonClip(compareClipASelect);
    const b = comparisonClip(compareClipBSelect);
    const activeStart = clip.id === (b && b.id)
      ? clampComparisonStart(compareStartB, b)
      : clampComparisonStart(compareStartA, a);
    const elapsed = Math.max(0, Math.min(comparisonDuration(), target - activeStart));
    compareVideoA.currentTime = clampComparisonStart(compareStartA, a) + elapsed;
    compareVideoB.currentTime = clampComparisonStart(compareStartB, b) + elapsed;
  } else {
    previewVideo.currentTime = target;
  }
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

// ---- Lightweight project save / restore ----

let savedProjectSummaries = [];

function currentProjectData() {
  return {
    clips: JSON.parse(JSON.stringify(clips)),
    transitions: JSON.parse(JSON.stringify(transitions)),
    selectedClipId,
    exportSelectedClipIds: [...exportSelectedClipIds],
    settings: {
      orientation: orientationSelect.value,
      quality: qualitySelect.value,
      codec: codecSelect.value,
      fps: fpsSelect.value,
      skimming: skimmingToggle.checked,
      comparison: {
        clipAId: Number(compareClipASelect.value) || null,
        clipBId: Number(compareClipBSelect.value) || null,
        startA: Number(compareStartA.value) || 0,
        startB: Number(compareStartB.value) || 0,
        audio: compareAudioSelect.value,
      },
    },
  };
}

function formatProjectDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function refreshSavedProjects(preferredId = currentProjectId) {
  try {
    savedProjectSummaries = await window.api.listProjects();
    savedProjectSelect.innerHTML = '';
    if (!savedProjectSummaries.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '保存データはありません';
      savedProjectSelect.appendChild(option);
    } else {
      savedProjectSummaries.forEach((project) => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = `${project.name}（${project.clipCount}クリップ・${formatProjectDate(project.updatedAt)}）`;
        savedProjectSelect.appendChild(option);
      });
      savedProjectSelect.value = savedProjectSummaries.some((p) => p.id === preferredId)
        ? preferredId
        : savedProjectSummaries[0].id;
    }
    loadProjectBtn.disabled = !savedProjectSelect.value;
    // This button also clears cache, so it remains useful with no saved projects.
    deleteProjectsBtn.disabled = false;
  } catch (e) {
    statusText.textContent = `保存データ一覧の取得に失敗しました: ${e.message}`;
  }
}

saveProjectBtn.addEventListener('click', async () => {
  if (!clips.length) return;
  saveProjectBtn.disabled = true;
  saveProjectBtn.textContent = '保存中…';
  try {
    const saved = await window.api.saveProject({
      id: currentProjectId,
      name: projectNameInput.value,
      data: currentProjectData(),
    });
    currentProjectId = saved.id;
    projectNameInput.value = saved.name;
    await refreshSavedProjects(saved.id);
    statusText.textContent = `「${saved.name}」を保存しました（動画本体はコピーしていません）`;
  } catch (e) {
    statusText.textContent = `保存に失敗しました: ${e.message}`;
  } finally {
    saveProjectBtn.textContent = '保存';
    saveProjectBtn.disabled = clips.length === 0 || exporting;
  }
});

savedProjectSelect.addEventListener('change', () => {
  loadProjectBtn.disabled = !savedProjectSelect.value;
});

loadProjectBtn.addEventListener('click', async () => {
  const id = savedProjectSelect.value;
  if (!id) return;
  if (clips.length && !window.confirm('現在の編集内容を閉じて、保存した編集を開きますか？')) return;
  loadProjectBtn.disabled = true;
  try {
    const result = await window.api.loadProject(id);
    const doc = result.project;
    const data = doc.data;
    previewVideo.pause();
    stopShuttleTimer();
    resetShuttle();
    loadedPath = null;
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewEmpty.style.display = 'flex';

    clips = data.clips.map((clip) => ({
      ...clip,
      zoom: clip.zoom || 1,
      zoomX: clip.zoomX != null ? clip.zoomX : 0.5,
      zoomY: clip.zoomY != null ? clip.zoomY : 0.5,
      panAnimated: !!clip.panAnimated,
      panKeyframes: Array.isArray(clip.panKeyframes) ? clip.panKeyframes : [],
      speed: clip.speed || 1,
      speedSegments: Array.isArray(clip.speedSegments) ? clip.speedSegments : [],
    }));
    clips.forEach((clip) => ensureWaveform(clip.path));
    exportSelectedClipIds = new Set(
      (Array.isArray(data.exportSelectedClipIds) ? data.exportSelectedClipIds : [])
        .filter((id) => clips.some((clip) => clip.id === id))
    );
    transitions = data.transitions.slice(0, Math.max(0, clips.length - 1));
    while (transitions.length < clips.length - 1) transitions.push({ type: 'cut', duration: 0.5 });
    nextId = clips.reduce((max, clip) => Math.max(max, Number(clip.id) || 0), 0) + 1;
    selectedClipId = null;
    historyStack = [];
    redoStack = [];
    currentProjectId = doc.id;
    projectNameInput.value = doc.name;

    const settings = data.settings || {};
    if (['portrait', 'landscape'].includes(settings.orientation)) orientationSelect.value = settings.orientation;
    if (['4k', 'fhd'].includes(settings.quality)) qualitySelect.value = settings.quality;
    if (['h264', 'h265'].includes(settings.codec)) codecSelect.value = settings.codec;
    if (['30', '60'].includes(String(settings.fps))) fpsSelect.value = String(settings.fps);
    if (typeof settings.skimming === 'boolean') {
      skimmingToggle.checked = settings.skimming;
      localStorage.setItem('skimmingEnabled', String(settings.skimming));
    }
    const comparison = settings.comparison || {};
    renderComparisonControls();
    if (clips.some((clip) => clip.id === comparison.clipAId)) compareClipASelect.value = String(comparison.clipAId);
    if (clips.some((clip) => clip.id === comparison.clipBId)) compareClipBSelect.value = String(comparison.clipBId);
    if (Number.isFinite(Number(comparison.startA))) {
      compareStartA.value = Number(comparison.startA).toFixed(3);
      compareStartA.dataset.edited = 'true';
    }
    if (Number.isFinite(Number(comparison.startB))) {
      compareStartB.value = Number(comparison.startB).toFixed(3);
      compareStartB.dataset.edited = 'true';
    }
    if (['left', 'right', 'both', 'none'].includes(comparison.audio)) compareAudioSelect.value = comparison.audio;
    updateExportLabel();
    updatePreviewBoxAspect();
    render();

    const missing = new Set(result.missingPaths || []);
    const firstAvailable = clips.find((clip) => !missing.has(clip.path));
    if (firstAvailable) selectClip(firstAvailable.id);
    if (missing.size) {
      statusText.textContent = `「${doc.name}」を開きました。元動画が${missing.size}個見つかりません。元の場所へ戻すと再び使えます。`;
    } else {
      const requested = clips.find((clip) => clip.id === data.selectedClipId) || firstAvailable;
      if (requested && requested.id !== selectedClipId) selectClip(requested.id);
      statusText.textContent = `「${doc.name}」を開きました`;
    }
  } catch (e) {
    statusText.textContent = `保存データを開けませんでした: ${e.message}`;
  } finally {
    loadProjectBtn.disabled = !savedProjectSelect.value;
  }
});

deleteProjectsBtn.addEventListener('click', async () => {
  const ok = window.confirm(
    '保存した編集データとアプリの一時キャッシュをすべて削除しますか？\n\n元動画と書き出し済み動画は削除されません。'
  );
  if (!ok) return;
  deleteProjectsBtn.disabled = true;
  deleteProjectsBtn.textContent = '削除中…';
  try {
    const result = await window.api.deleteProjectsAndCache();
    currentProjectId = null;
    const freedMB = (result.freedBytes / 1024 / 1024).toFixed(1);
    await refreshSavedProjects(null);
    statusText.textContent = `保存データ${result.projectCount}件とキャッシュを削除しました（約${freedMB}MB解放）。現在の編集と元動画は残っています。`;
  } catch (e) {
    statusText.textContent = `一括削除に失敗しました: ${e.message}`;
  } finally {
    deleteProjectsBtn.textContent = '保存データとキャッシュを一括削除';
    deleteProjectsBtn.disabled = false;
  }
});

// ---- Export ----

function computeResolution() {
  const base = qualitySelect.value === 'fhd' ? [1920, 1080] : [3840, 2160];
  const [w, h] = orientationSelect.value === 'portrait' ? [base[1], base[0]] : base;
  return `${w}x${h}`;
}

function rememberExportedVideo(filePath) {
  if (!filePath) return;
  lastExportedPath = filePath;
  localStorage.setItem('lastExportedPath', filePath);
  analyzeExportBtn.disabled = false;
  analyzeExportBtn.title = `解析する動画: ${filePath.split('/').pop()}`;
}

function addAnalysisMetric(container, label, value) {
  const item = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = value == null ? '—' : String(value);
  const caption = document.createElement('span');
  caption.textContent = label;
  item.append(strong, caption);
  container.appendChild(item);
}

function renderAnalysisResult(result) {
  analysisResult.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'analysis-summary';
  addAnalysisMetric(summary, '総合スコア', result.total_score == null ? '—' : `${result.total_score}点`);
  addAnalysisMetric(summary, 'レベル', result.level || '—');
  addAnalysisMetric(summary, '解析フレーム', result.frame_count == null ? '—' : `${result.frame_count}枚`);
  addAnalysisMetric(summary, 'テイクオフ', result.takeoff_timing?.score == null ? '—' : `${result.takeoff_timing.score}点`);
  addAnalysisMetric(summary, '体のバランス', result.body_balance?.score == null ? '—' : `${result.body_balance.score}点`);
  addAnalysisMetric(summary, '目線・手', result.hands_eyes?.score == null ? '—' : `${result.hands_eyes.score}点`);
  addAnalysisMetric(summary, '足のスタンス', result.foot_stance?.score == null ? '—' : `${result.foot_stance.score}点`);
  analysisResult.appendChild(summary);

  const heading = document.createElement('h3');
  heading.textContent = 'シーン判定';
  analysisResult.appendChild(heading);
  const scenes = document.createElement('ul');
  scenes.className = 'analysis-scenes';
  (Array.isArray(result.frames) ? result.frames : []).forEach((frame) => {
    const item = document.createElement('li');
    const scene = document.createElement('b');
    scene.textContent = `フレーム${frame.frame_no || ''}：${frame.scene || '判定なし'}`;
    const comment = document.createElement('span');
    comment.textContent = frame.frame_comment ? ` — ${frame.frame_comment}` : '';
    item.append(scene, comment);
    scenes.appendChild(item);
  });
  if (!scenes.children.length) {
    const item = document.createElement('li');
    item.textContent = 'シーン判定が返されませんでした';
    scenes.appendChild(item);
  }
  analysisResult.appendChild(scenes);

  if (result.overall_comment) {
    const comment = document.createElement('p');
    comment.textContent = result.overall_comment;
    analysisResult.appendChild(comment);
  }
  if (Array.isArray(result.improvement_points) && result.improvement_points.length) {
    const title = document.createElement('h3');
    title.textContent = '改善ポイント';
    const list = document.createElement('ul');
    list.className = 'analysis-improvements';
    result.improvement_points.forEach((point) => {
      const item = document.createElement('li');
      item.textContent = point;
      list.appendChild(item);
    });
    analysisResult.append(title, list);
  }
}

async function analyzeLastExport() {
  if (!lastExportedPath || analysisInProgress) return;
  analysisInProgress = true;
  const filename = lastExportedPath.split('/').pop();
  analysisFileName.textContent = filename;
  referenceNameInput.value = filename.replace(/\.[^.]+$/, '');
  referenceDescriptionInput.value = '';
  referenceSaveStatus.textContent = '';
  analysisError.classList.add('hidden');
  analysisResult.classList.add('hidden');
  referenceSaveForm.classList.add('hidden');
  analysisLoading.classList.remove('hidden');
  analysisOverlay.classList.remove('hidden');
  analysisCloseBtn.disabled = true;
  analyzeExportBtn.disabled = true;
  try {
    const result = await window.api.analyzeExportedVideo(lastExportedPath);
    renderAnalysisResult(result);
    analysisResult.classList.remove('hidden');
    referenceSaveForm.classList.remove('hidden');
  } catch (error) {
    analysisError.textContent = error.message;
    analysisError.classList.remove('hidden');
  } finally {
    analysisLoading.classList.add('hidden');
    analysisCloseBtn.disabled = false;
    analyzeExportBtn.disabled = false;
    analysisInProgress = false;
  }
}

analyzeExportBtn.addEventListener('click', analyzeLastExport);
analysisCloseBtn.addEventListener('click', () => {
  if (!analysisInProgress) analysisOverlay.classList.add('hidden');
});
saveReferenceBtn.addEventListener('click', async () => {
  if (!lastExportedPath) return;
  const name = referenceNameInput.value.trim();
  if (!name) {
    referenceSaveStatus.textContent = '名前を入力してください';
    return;
  }
  saveReferenceBtn.disabled = true;
  referenceSaveStatus.textContent = '参考動画として保存中…';
  try {
    const result = await window.api.saveExportedAsReference({
      filePath: lastExportedPath,
      name,
      description: referenceDescriptionInput.value.trim(),
    });
    referenceSaveStatus.textContent = `保存しました（ID: ${result.id}／${result.frame_count}フレーム）`;
  } catch (error) {
    referenceSaveStatus.textContent = error.message;
  } finally {
    saveReferenceBtn.disabled = false;
  }
});

function updateExportLabel() {
  const qualityLabel = qualitySelect.value === 'fhd' ? 'フルHD' : '4K';
  const orientationLabel = orientationSelect.value === 'portrait' ? '縦' : '横';
  qualityFhdBtn.classList.toggle('active', qualitySelect.value === 'fhd');
  quality4kBtn.classList.toggle('active', qualitySelect.value === '4k');
  exportBtn.textContent = `${qualityLabel}(${orientationLabel})で書き出す`;
}
orientationSelect.addEventListener('change', () => {
  updateExportLabel();
  updatePreviewBoxAspect();
  applyPreviewZoom();
});
function selectExportQuality(quality) {
  qualitySelect.value = quality;
  updateExportLabel();
}
qualityFhdBtn.addEventListener('click', () => selectExportQuality('fhd'));
quality4kBtn.addEventListener('click', () => selectExportQuality('4k'));
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
    rememberExportedVideo(result.outputPath);
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

compareExportBtn.addEventListener('click', async () => {
  const a = comparisonClip(compareClipASelect);
  const b = comparisonClip(compareClipBSelect);
  if (!a || !b || a.id === b.id) return;
  const startA = clampComparisonStart(compareStartA, a);
  const startB = clampComparisonStart(compareStartB, b);
  const duration = comparisonDuration();
  if (duration < 0.2) {
    statusText.textContent = '比較できる共通時間が短すぎます';
    return;
  }
  const outputPath = await window.api.selectOutput(`comparison_${new Date().toISOString().slice(0, 10)}.mp4`);
  if (!outputPath) return;
  exporting = true;
  render();
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = '0%';
  statusText.textContent = '2画面比較を書き出し中…';
  cancelExportBtn.classList.remove('hidden');
  cancelExportBtn.disabled = false;
  try {
    const result = await window.api.exportComparison({
      left: {
        path: a.path, start: startA, end: a.trimEnd, trimStart: a.trimStart,
        width: a.width, height: a.height, zoom: a.zoom, zoomX: a.zoomX,
        zoomY: a.zoomY, panAnimated: a.panAnimated, panKeyframes: a.panKeyframes,
      },
      right: {
        path: b.path, start: startB, end: b.trimEnd, trimStart: b.trimStart,
        width: b.width, height: b.height, zoom: b.zoom, zoomX: b.zoomX,
        zoomY: b.zoomY, panAnimated: b.panAnimated, panKeyframes: b.panKeyframes,
      },
      settings: {
        outputPath,
        resolution: computeResolution(),
        orientation: orientationSelect.value,
        codec: codecSelect.value,
        fps: parseInt(fpsSelect.value, 10),
        audio: compareAudioSelect.value,
      },
    });
    rememberExportedVideo(result.outputPath);
    statusText.textContent = `比較動画を保存しました: ${result.outputPath}`;
  } catch (error) {
    statusText.textContent = error.message === 'CANCELLED' ? '書き出しを中止しました' : `比較書き出しエラー: ${error.message}`;
  } finally {
    cancelExportBtn.classList.add('hidden');
    exporting = false;
    render();
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
  const picked = clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => exportSelectedClipIds.has(clip.id));
  if (!picked.length) return;
  for (const { clip } of picked) {
    if (clip.trimEnd - clip.trimStart < 0.2) {
      statusText.textContent = `${clip.name} のトリム範囲が短すぎます`;
      return;
    }
  }

  const pickedTransitions = [];
  for (let i = 1; i < picked.length; i += 1) {
    const previousIndex = picked[i - 1].index;
    const currentIndex = picked[i].index;
    pickedTransitions.push(
      currentIndex === previousIndex + 1
        ? { ...transitions[previousIndex] }
        : { type: 'cut', duration: 0.5 }
    );
  }

  let defaultName;
  if (picked.length === 1) {
    const clip = picked[0].clip;
    const base = clip.name.replace(/\.[^.]+$/, '');
    defaultName = `${base}_${fmtTime(clip.trimStart).replace(':', '')}-${fmtTime(clip.trimEnd).replace(':', '')}.mp4`;
  } else {
    defaultName = `selected_${picked.length}clips_${new Date().toISOString().slice(0, 10)}.mp4`;
  }
  await runExport(
    picked.map(({ clip }) => clipExportPayload(clip)),
    pickedTransitions,
    defaultName
  );
});

let latestUpdateInfo = null;

function showUpdateBanner({ title, message = '', kind = 'available', canInstall = false }) {
  updateBanner.className = `update-banner ${kind === 'available' ? '' : kind}`.trim();
  updateTitle.textContent = title;
  updateMessage.textContent = message;
  updateInstallBtn.classList.toggle('hidden', !canInstall);
  updateInstallBtn.disabled = !canInstall;
  updateDismissBtn.disabled = kind === 'working';
}

async function checkForAppUpdate() {
  const result = await window.api.checkForUpdate();
  if (!result.ok) {
    showUpdateBanner({
      title: 'アップデートを確認できませんでした',
      message: result.error,
      kind: 'error',
    });
    return;
  }
  if (!result.updateAvailable) return;
  latestUpdateInfo = result;
  showUpdateBanner({
    title: `アップデートがあります（v${result.latestVersion}）`,
    message: `現在のバージョン: v${result.currentVersion}`,
    canInstall: result.assetAvailable,
  });
  if (!result.assetAvailable) updateMessage.textContent = 'Mac用ZIPがリリースに添付されていません。';
}

updateInstallBtn.addEventListener('click', async () => {
  if (!latestUpdateInfo) return;
  showUpdateBanner({ title: 'アップデートを準備しています', message: 'しばらくお待ちください…', kind: 'working' });
  try {
    await window.api.installUpdate();
  } catch (error) {
    showUpdateBanner({ title: 'アップデートに失敗しました', message: error.message, kind: 'error' });
  }
});

updateDismissBtn.addEventListener('click', () => updateBanner.classList.add('hidden'));
window.api.onUpdateProgress(({ message }) => {
  showUpdateBanner({ title: 'アップデート中', message, kind: 'working' });
});

if (lastExportedPath) rememberExportedVideo(lastExportedPath);
render();
refreshSavedProjects();
setTimeout(() => checkForAppUpdate().catch((error) => {
  showUpdateBanner({ title: 'アップデートを確認できませんでした', message: error.message, kind: 'error' });
}), 1500);

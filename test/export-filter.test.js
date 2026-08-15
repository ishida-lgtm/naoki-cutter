const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadBuildFilterGraph() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf('const XFADE_NAMES');
  const end = source.indexOf("ipcMain.handle('export-video'");
  assert.ok(start >= 0 && end > start, 'export filter source slice');
  const spawnSync = () => ({ error: null, status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
  const FFMPEG = 'ffmpeg';
  const FFPROBE = 'ffprobe';
  let loaded;
  eval(`${source.slice(start, end)}\nloaded = buildFilterGraph;`);
  return loaded;
}

function clip(id, duration) {
  return {
    id, path: `/missing-${id}.mp4`, name: `clip-${id}`, width: 1920, height: 1080,
    trimStart: 0, trimEnd: duration, zoom: 1, zoomX: 0.5, zoomY: 0.5,
    panAnimated: false, panKeyframes: [], speed: 1, speedSegments: [],
  };
}

test('カットは小さなxfadeではなく映像・音声concatを使う', () => {
  const buildFilterGraph = loadBuildFilterGraph();
  const result = buildFilterGraph(
    [clip(1, 10), clip(2, 8), clip(3, 12), clip(4, 14)],
    Array.from({ length: 3 }, () => ({ type: 'cut', duration: 0.5 })),
    { resolution: '1920x1080', fps: 30 }
  );
  assert.match(result.filterComplex, /concat=n=2:v=1:a=0/);
  assert.match(result.filterComplex, /concat=n=2:v=0:a=1/);
  assert.doesNotMatch(result.filterComplex, /xfade=/);
  assert.equal(result.totalDuration, 44);
});

test('ディゾルブだけはxfadeを使い重なり時間を差し引く', () => {
  const buildFilterGraph = loadBuildFilterGraph();
  const result = buildFilterGraph(
    [clip(1, 10), clip(2, 8)],
    [{ type: 'dissolve', duration: 0.5 }],
    { resolution: '1920x1080', fps: 30 }
  );
  assert.match(result.filterComplex, /xfade=transition=dissolve:duration=0\.5/);
  assert.equal(result.totalDuration, 17.5);
});

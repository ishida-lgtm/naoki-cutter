const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cloneClipSettingsForTarget, cloneZoomForTarget, upsertPanKeyframe,
  comparisonPairFromSelection, removeSelectedClipsFromTimeline,
  clipPlaybackDuration, sequencePlaybackDuration, estimateExportSize,
} = require('../clip-settings');

test('Zoom・位置・速度設定を別クリップへコピーできる', () => {
  const source = {
    zoom: 3, zoomX: 0.25, zoomY: 0.7, panAnimated: true,
    panKeyframes: [{ t: 1, x: 0.2, y: 0.4 }, { t: 8, x: 0.7, y: 0.6 }],
    speed: 0.5,
    speedSegments: [{ start: 1, end: 3, speed: 2 }, { start: 7, end: 9, speed: 0.5 }],
  };
  const target = { trimStart: 10, trimEnd: 15 };
  cloneClipSettingsForTarget(source, target);
  assert.equal(target.zoom, 3);
  assert.equal(target.zoomX, 0.25);
  assert.deepEqual(target.panKeyframes, [{ t: 1, x: 0.2, y: 0.4 }]);
  assert.deepEqual(target.speedSegments, [{ start: 1, end: 3, speed: 2 }]);
});

test('コピー後の配列は元クリップと共有しない', () => {
  const source = {
    zoom: 2, zoomX: 0.5, zoomY: 0.5, panAnimated: true,
    panKeyframes: [{ t: 1, x: 0.4, y: 0.4 }], speed: 1,
    speedSegments: [{ start: 0, end: 2, speed: 0.5 }],
  };
  const target = { trimStart: 0, trimEnd: 4 };
  cloneClipSettingsForTarget(source, target);
  target.panKeyframes[0].x = 0.9;
  target.speedSegments[0].speed = 2;
  assert.equal(source.panKeyframes[0].x, 0.4);
  assert.equal(source.speedSegments[0].speed, 0.5);
});

test('Zoomだけの一括反映では位置・キーフレーム・速度を変更しない', () => {
  const source = { zoom: 3, zoomX: 0.2, speed: 2 };
  const target = {
    zoom: 1, zoomX: 0.8, zoomY: 0.7, panAnimated: true,
    panKeyframes: [{ t: 1, x: 0.8, y: 0.7 }], speed: 0.5,
    speedSegments: [{ start: 0, end: 2, speed: 0.25 }],
  };
  const before = JSON.parse(JSON.stringify(target));
  cloneZoomForTarget(source, target);
  assert.equal(target.zoom, 3);
  assert.deepEqual({ ...target, zoom: before.zoom }, before);
});

test('画面位置を動かすとキーフレームを自動で有効化して追加する', () => {
  const clip = { trimStart: 10, trimEnd: 20, panAnimated: false, panKeyframes: [] };
  const result = upsertPanKeyframe(clip, 2.5, 0.25, 0.75);
  assert.equal(result.created, true);
  assert.equal(clip.panAnimated, true);
  assert.deepEqual(clip.panKeyframes, [{ t: 2.5, x: 0.25, y: 0.75 }]);
});

test('同じ再生位置を動かし直すと既存キーフレームを更新する', () => {
  const clip = {
    trimStart: 0, trimEnd: 10, panAnimated: true,
    panKeyframes: [{ t: 3, x: 0.2, y: 0.3 }],
  };
  const result = upsertPanKeyframe(clip, 3.08, 0.8, 0.7);
  assert.equal(result.created, false);
  assert.deepEqual(clip.panKeyframes, [{ t: 3.08, x: 0.8, y: 0.7 }]);
});

test('タイムライン順で選択した2クリップを比較ペアにする', () => {
  const clips = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(comparisonPairFromSelection(clips, new Set([3, 1])), [clips[0], clips[2]]);
  assert.equal(comparisonPairFromSelection(clips, new Set([1])), null);
  assert.equal(comparisonPairFromSelection(clips, new Set([1, 2, 3])), null);
});

test('複数クリップ削除後の新しい隙間はカットで接続する', () => {
  const clips = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const transitions = [
    { type: 'crossfade', duration: 1 },
    { type: 'dissolve', duration: 2 },
    { type: 'crossfade', duration: 3 },
  ];
  const result = removeSelectedClipsFromTimeline(clips, transitions, new Set([2, 3]));
  assert.deepEqual(result.clips.map((clip) => clip.id), [1, 4]);
  assert.deepEqual(result.transitions, [{ type: 'cut', duration: 0.5 }]);
});

test('複数削除後も元から隣接するクリップのつなぎ目を維持する', () => {
  const clips = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const transitions = [
    { type: 'crossfade', duration: 1 },
    { type: 'dissolve', duration: 2 },
    { type: 'crossfade', duration: 3 },
  ];
  const result = removeSelectedClipsFromTimeline(clips, transitions, new Set([1, 4]));
  assert.deepEqual(result.clips.map((clip) => clip.id), [2, 3]);
  assert.deepEqual(result.transitions, [{ type: 'dissolve', duration: 2 }]);
});

test('速度区間とトランジションを含む書き出し時間を計算する', () => {
  const clips = [
    { trimStart: 0, trimEnd: 10, speed: 2, speedSegments: [] },
    { trimStart: 2, trimEnd: 12, speed: 1, speedSegments: [{ start: 0, end: 4, speed: 0.5 }] },
  ];
  assert.equal(clipPlaybackDuration(clips[0]), 5);
  assert.equal(clipPlaybackDuration(clips[1]), 14);
  assert.equal(sequencePlaybackDuration(clips, [{ type: 'crossfade', duration: 1 }]), 18);
});

test('4KはフルHDより大きくH.265はH.264より小さく見積もる', () => {
  const fhd = estimateExportSize({ duration: 60, quality: 'fhd', codec: 'h264', fps: 30 });
  const fourK = estimateExportSize({ duration: 60, quality: '4k', codec: 'h264', fps: 30 });
  const hevc = estimateExportSize({ duration: 60, quality: '4k', codec: 'h265', fps: 30 });
  assert.ok(fourK.bytes > fhd.bytes);
  assert.ok(hevc.bytes < fourK.bytes);
  assert.ok(fourK.lowBytes < fourK.bytes && fourK.highBytes > fourK.bytes);
});

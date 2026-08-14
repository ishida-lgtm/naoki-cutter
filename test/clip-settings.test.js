const test = require('node:test');
const assert = require('node:assert/strict');
const { cloneClipSettingsForTarget, removeSelectedClipsFromTimeline } = require('../clip-settings');

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

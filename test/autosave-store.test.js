const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeAutosave, loadLatestAutosave, clearAutosaves } = require('../autosave-store');

test('最新の編集を復元でき、古い復元ポイントを5世代に整理する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naoki-autosave-'));
  const source = path.join(dir, 'original.mov');
  fs.writeFileSync(source, 'original');
  try {
    for (let index = 0; index < 7; index += 1) {
      writeAutosave(dir, {
        projectId: 'project-1',
        name: 'テスト',
        data: {
          clips: [{ id: 1, path: source, zoom: index + 1 }],
          transitions: [],
        },
      }, { now: 1_000_000 + index * 10_000, checkpointIntervalMs: 1000, maxCheckpoints: 5 });
    }
    const restored = loadLatestAutosave(dir);
    assert.equal(restored.data.clips[0].zoom, 7);
    assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('checkpoint-')).length, 5);
    clearAutosaves(dir);
    assert.equal(loadLatestAutosave(dir), null);
    assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

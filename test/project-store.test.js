const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deleteProjectFile } = require('../project-store');

test('選択した保存データだけを削除し、他の保存データと元動画を残す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naoki-project-delete-'));
  try {
    const selected = path.join(dir, 'selected.json');
    const selectedTemp = `${selected}.tmp`;
    const other = path.join(dir, 'other.json');
    const source = path.join(dir, 'source.mp4');
    fs.writeFileSync(selected, '{"selected":true}');
    fs.writeFileSync(selectedTemp, 'temporary');
    fs.writeFileSync(other, '{"other":true}');
    fs.writeFileSync(source, 'original video');

    const freedBytes = deleteProjectFile(selected);

    assert.equal(freedBytes, Buffer.byteLength('{"selected":true}'));
    assert.equal(fs.existsSync(selected), false);
    assert.equal(fs.existsSync(selectedTemp), false);
    assert.equal(fs.existsSync(other), true);
    assert.equal(fs.existsSync(source), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('存在しない保存データは分かりやすいエラーにする', () => {
  const missing = path.join(os.tmpdir(), `naoki-missing-${Date.now()}.json`);
  assert.throws(() => deleteProjectFile(missing), /選択した保存データが見つかりません/);
});

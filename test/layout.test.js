const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

test('2画面比較の設定欄と起動ボタンを交互に隠せる', () => {
  assert.match(css, /\.comparison-box\.hidden\s*,\s*\.compare-panel-toggle\.hidden\s*\{\s*display:\s*none;/);
});

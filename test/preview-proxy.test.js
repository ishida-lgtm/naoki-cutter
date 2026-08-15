const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { proxyCacheKey, pruneProxyCache, clearProxyCache } = require('../preview-proxy');

test('元動画の変更を識別し、古い軽量プレビューだけを整理する', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naoki-proxy-'));
  const source = path.join(dir, 'original.mov');
  fs.writeFileSync(source, 'source-a');
  const firstKey = proxyCacheKey(source);
  fs.appendFileSync(source, 'source-b');
  const secondKey = proxyCacheKey(source);
  assert.notEqual(firstKey, secondKey);

  const proxies = [0, 1, 2].map((index) => path.join(dir, `proxy-${index}.mp4`));
  proxies.forEach((proxy, index) => {
    fs.writeFileSync(proxy, Buffer.alloc(10));
    const time = new Date(10_000 + index * 1000);
    fs.utimesSync(proxy, time, time);
  });
  pruneProxyCache(dir, { maxFiles: 2, maxBytes: 100, keepPath: proxies[0] });
  assert.equal(fs.existsSync(proxies[0]), true);
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.mp4')).length, 2);
  clearProxyCache(dir);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.mp4')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

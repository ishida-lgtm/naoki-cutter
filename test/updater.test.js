const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RELEASE_ASSET_NAME,
  normalizedVersion,
  compareVersions,
  publicReleaseSummary,
} = require('../updater');

test('v付きのセマンティックバージョンを比較できる', () => {
  assert.deepEqual(normalizedVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('v1.0.1', '1.0.1'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});

test('不正なバージョン番号を拒否する', () => {
  assert.equal(normalizedVersion('latest'), null);
  assert.throws(() => compareVersions('latest', '1.0.0'));
});

test('GitHubリリースから公開用の更新情報を作る', () => {
  const summary = publicReleaseSummary({
    tag_name: 'v1.1.0',
    name: 'Naoki Cutter v1.1.0',
    body: '更新内容',
    assets: [{ name: RELEASE_ASSET_NAME, browser_download_url: 'https://example.invalid/app.zip' }],
  }, '1.0.0');
  assert.equal(summary.updateAvailable, true);
  assert.equal(summary.assetAvailable, true);
  assert.equal(summary.latestVersion, '1.1.0');
});

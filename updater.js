const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const GITHUB_OWNER = 'ishida-lgtm';
const GITHUB_REPO = 'naoki-cutter';
const RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASE_ASSET_NAME = 'Naoki-Cutter-mac-arm64.zip';
const TARGET_APP_PATH = '/Applications/Naoki Cutter.app';
const BUNDLE_ID = 'com.naoki.cutter';
const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 3 * 1024 * 1024 * 1024;

function normalizedVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = normalizedVersion(left);
  const b = normalizedVersion(right);
  if (!a || !b) throw new Error('バージョン番号の形式が正しくありません。');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function request(url, { destination, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: destination ? 'application/octet-stream' : 'application/vnd.github+json',
        'User-Agent': `Naoki-Cutter/${require('./package.json').version}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 30000,
    }, (response) => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('アップデートのダウンロード先が何度も変更されたため中止しました。'));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        request(nextUrl, { destination, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (statusCode === 404) {
            reject(new Error('GitHubに公開済みのアップデートがまだありません。'));
            return;
          }
          reject(new Error(`GitHubとの通信に失敗しました（HTTP ${statusCode}）。`));
        });
        return;
      }

      if (!destination) {
        const chunks = [];
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > 10 * 1024 * 1024) {
            req.destroy(new Error('GitHubからの応答が大きすぎます。'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('GitHubから正しい更新情報を取得できませんでした。'));
          }
        });
        return;
      }

      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > MAX_DOWNLOAD_BYTES) {
        response.resume();
        reject(new Error('アップデートファイルが大きすぎるため中止しました。'));
        return;
      }
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES) req.destroy(new Error('アップデートファイルが大きすぎます。'));
      });
      response.pipe(output);
      output.on('finish', () => output.close(() => resolve({ bytes: received })));
      output.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('GitHubへの接続がタイムアウトしました。')));
    req.on('error', (error) => {
      if (destination) fs.rmSync(destination, { force: true });
      if (['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(error.code)) {
        reject(new Error('インターネットに接続できません。接続を確認してからもう一度お試しください。'));
      } else {
        reject(error);
      }
    });
  });
}

function findReleaseAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return assets.find((asset) => asset.name === RELEASE_ASSET_NAME)
    || assets.find((asset) => /arm64.*\.zip$/i.test(asset.name || ''))
    || assets.find((asset) => /\.zip$/i.test(asset.name || ''))
    || null;
}

function publicReleaseSummary(release, currentVersion) {
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  if (!normalizedVersion(latestVersion)) throw new Error('GitHubの最新リリースに正しいバージョン番号がありません。');
  const asset = findReleaseAsset(release);
  return {
    ok: true,
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseName: String(release.name || `v${latestVersion}`),
    releaseNotes: String(release.body || '').slice(0, 4000),
    assetAvailable: Boolean(asset),
  };
}

function runChecked(command, args, errorMessage, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim().slice(-1200);
    throw new Error(detail ? `${errorMessage}\n${detail}` : errorMessage);
  }
  return result;
}

function validateExtractedApp(appPath) {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(infoPlist)) throw new Error('ZIP内に正しいNaoki Cutter.appが見つかりません。');
  const bundle = runChecked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', infoPlist],
    'アップデートのアプリ情報を確認できませんでした。');
  if (bundle.stdout.trim() !== BUNDLE_ID) throw new Error('アップデートのアプリIDがNaoki Cutterと一致しません。');
  runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath],
    'アップデートの署名確認に失敗しました。');
}

function assertApplicationsWritable() {
  try {
    fs.accessSync('/Applications', fs.constants.W_OK);
  } catch {
    throw new Error('「アプリケーション」フォルダへ書き込む権限がありません。ZIPを展開し、Naoki Cutter.appを手動で「アプリケーション」へ入れ替えてください。');
  }
}

function helperScript() {
  return `#!/bin/zsh
set -u
old_pid="$1"
source_app="$2"
target_app="$3"
work_dir="$4"
log_file="$5"
backup_app="\${target_app}.update-backup"
incoming_app="\${target_app}.update-incoming"

fail_update() {
  message="$1"
  print -r -- "$message" > "$log_file"
  /bin/rm -rf "$incoming_app"
  if [[ ! -e "$target_app" && -e "$backup_app" ]]; then /bin/mv "$backup_app" "$target_app"; fi
  /usr/bin/osascript -e 'display dialog "Naoki Cutterの更新に失敗しました。ZIPから手動でアプリを入れ替えてください。" buttons {"OK"} default button "OK" with icon stop' >/dev/null 2>&1 || true
  exit 1
}

for attempt in {1..150}; do
  /bin/kill -0 "$old_pid" >/dev/null 2>&1 || break
  /bin/sleep 0.2
done
/bin/kill -0 "$old_pid" >/dev/null 2>&1 && fail_update "アプリの終了を待てませんでした。"

/bin/rm -rf "$backup_app" "$incoming_app"
if [[ -e "$target_app" ]]; then
  /bin/mv "$target_app" "$backup_app" || fail_update "古いアプリを移動できませんでした。"
fi
/usr/bin/ditto "$source_app" "$incoming_app" || fail_update "新しいアプリをコピーできませんでした。"
/usr/bin/xattr -dr com.apple.quarantine "$incoming_app" >/dev/null 2>&1 || true
/bin/mv "$incoming_app" "$target_app" || fail_update "新しいアプリを配置できませんでした。"
/usr/bin/open "$target_app" || fail_update "更新後のアプリを起動できませんでした。"
/bin/rm -rf "$backup_app" "$work_dir"
exit 0
`;
}

function createUpdater({ app, getMainWindow }) {
  let cachedRelease = null;
  let installing = false;

  const notify = (stage, message, progress = null) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('update-progress', { stage, message, progress });
  };

  async function fetchLatestRelease() {
    cachedRelease = await request(RELEASE_API_URL);
    return cachedRelease;
  }

  async function check() {
    try {
      const release = await fetchLatestRelease();
      return publicReleaseSummary(release, app.getVersion());
    } catch (error) {
      return { ok: false, currentVersion: app.getVersion(), error: error.message || 'アップデートを確認できませんでした。' };
    }
  }

  async function install() {
    if (installing) throw new Error('アップデート処理はすでに進行中です。');
    if (process.platform !== 'darwin') throw new Error('自動更新はmacOS版のみ対応しています。');
    assertApplicationsWritable();
    installing = true;
    let workDir;
    try {
      notify('checking', '最新バージョンを確認しています…');
      const release = cachedRelease || await fetchLatestRelease();
      const summary = publicReleaseSummary(release, app.getVersion());
      if (!summary.updateAvailable) throw new Error('現在のNaoki Cutterは最新です。');
      const asset = findReleaseAsset(release);
      if (!asset?.browser_download_url) throw new Error('リリースにMac用ZIPが添付されていません。');

      workDir = fs.mkdtempSync(path.join(app.getPath('temp') || os.tmpdir(), 'naoki-cutter-update-'));
      const zipPath = path.join(workDir, RELEASE_ASSET_NAME);
      const extractDir = path.join(workDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      notify('downloading', `v${summary.latestVersion}をダウンロードしています…`);
      await request(asset.browser_download_url, { destination: zipPath });

      notify('preparing', 'アップデートを確認・準備しています…');
      runChecked('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], 'アップデートZIPを展開できませんでした。');
      const stagedApp = path.join(extractDir, 'Naoki Cutter.app');
      validateExtractedApp(stagedApp);
      spawnSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', stagedApp], { stdio: 'ignore' });

      const helperPath = path.join(workDir, 'apply-update.zsh');
      const logPath = path.join(os.tmpdir(), 'naoki-cutter-update-error.log');
      fs.writeFileSync(helperPath, helperScript(), { mode: 0o700 });
      notify('restarting', '準備ができました。アプリを更新して再起動します…', 1);
      const child = spawn('/bin/zsh', [helperPath, String(process.pid), stagedApp, TARGET_APP_PATH, workDir, logPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      setTimeout(() => app.quit(), 500);
      return { ok: true, restarting: true, latestVersion: summary.latestVersion };
    } catch (error) {
      installing = false;
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      throw error;
    }
  }

  return { check, install };
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASE_API_URL,
  RELEASE_ASSET_NAME,
  TARGET_APP_PATH,
  normalizedVersion,
  compareVersions,
  publicReleaseSummary,
  createUpdater,
};

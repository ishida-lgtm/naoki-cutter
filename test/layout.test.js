const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('2画面比較の設定欄と起動ボタンを交互に隠せる', () => {
  assert.match(css, /\.comparison-box\.hidden\s*,\s*\.compare-panel-toggle\.hidden\s*\{\s*display:\s*none;/);
});

test('AI学習データと生徒比較用の参考動画を別々に案内する', () => {
  assert.match(html, /AI精度向上用[\s\S]*学習データ/);
  assert.match(html, /生徒との比較用[\s\S]*参考動画/);
  assert.match(html, /id="saveLatestAsReferenceBtn"/);
  assert.match(preload, /listReferenceVideos/);
  assert.match(preload, /deleteReferenceVideo/);
});

test('フォーム解析AIの状態と再起動を画面から確認できる', () => {
  assert.match(html, /id="surfAnalyzerStatusBtn"/);
  assert.match(preload, /surfAnalyzerStatus/);
  assert.match(preload, /restartSurfAnalyzer/);
});

test('生徒履歴とレッスン動画作成をフォーム解析から利用できる', () => {
  assert.match(html, /id="formStudentName"/);
  assert.match(html, /id="analysisHistoryList"/);
  assert.match(html, /id="formLessonVideoBtn"/);
  assert.match(preload, /saveAnalysisHistory/);
  assert.match(preload, /createLessonVideo/);
});

test('学習データを題名ごとに分けて保存できる入力欄がある', () => {
  assert.match(html, /id="editTrainingTitle"/);
  assert.match(html, /id="formLearningTitle"/);
});

test('AI検出候補を確認・修正して学習できる画面がある', () => {
  assert.match(html, /id="aiCandidateReviewOverlay"/);
  assert.match(html, /id="candidateLearningTitle"/);
  assert.match(html, /id="candidateReviewApplyBtn"/);
  assert.match(preload, /saveTrainingFeedback/);
});

test('一括AI処理キューを停止・再開し、用途別に振り分けられる', () => {
  assert.match(html, /id="batchAiStartBtn"/);
  assert.match(html, /id="batchAiRole"[\s\S]*value="learning"[\s\S]*value="reference"/);
  assert.match(html, /id="batchAiPauseBtn"/);
  assert.match(html, /id="batchAiCancelBtn"/);
  assert.match(html, /id="aiQueueList"/);
});

test('参考動画タグ検索と軽量バックアップを利用できる', () => {
  assert.match(html, /id="referenceSearchInput"/);
  assert.match(html, /id="exportAiBackupBtn"/);
  assert.match(html, /id="importAiBackupBtn"/);
  assert.match(preload, /saveReferenceTags/);
  assert.match(preload, /exportAiDataBackup/);
  assert.match(preload, /importAiDataBackup/);
});

test('比較同期でキャッチ・手離れ・ボトムターン・ターンを選べる', () => {
  assert.match(html, /value="catch_start"/);
  assert.match(html, /value="takeoff_end"/);
  assert.match(html, /value="bottom_turn"/);
  assert.match(html, /value="turn_start"/);
});

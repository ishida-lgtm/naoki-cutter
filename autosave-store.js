const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CHECKPOINTS = 5;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

function autosaveFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^checkpoint-\d+\.json$/.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        const timestamp = Number(entry.name.match(/^checkpoint-(\d+)\.json$/)[1]);
        return { path: fullPath, timestamp };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

function writeAutosave(dir, payload, options = {}) {
  if (!payload?.data || !Array.isArray(payload.data.clips)) {
    throw new Error('自動保存する編集データが不正です');
  }
  const now = Number(options.now) || Date.now();
  const maxCheckpoints = Math.max(1, Number(options.maxCheckpoints) || DEFAULT_MAX_CHECKPOINTS);
  const checkpointIntervalMs = Math.max(
    1000,
    Number(options.checkpointIntervalMs) || DEFAULT_CHECKPOINT_INTERVAL_MS
  );
  const doc = {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    projectId: payload.projectId || null,
    name: String(payload.name || '').trim().slice(0, 100),
    data: payload.data,
  };
  const encoded = JSON.stringify(doc, null, 2);
  if (Buffer.byteLength(encoded, 'utf8') > 10 * 1024 * 1024) {
    throw new Error('自動保存データが大きすぎます');
  }
  fs.mkdirSync(dir, { recursive: true });
  const latestPath = path.join(dir, 'latest.json');
  const tempPath = `${latestPath}.tmp`;
  fs.writeFileSync(tempPath, encoded, 'utf8');
  fs.renameSync(tempPath, latestPath);

  let checkpoints = autosaveFiles(dir);
  if (!checkpoints.length || now - checkpoints[0].timestamp >= checkpointIntervalMs) {
    const checkpointPath = path.join(dir, `checkpoint-${now}.json`);
    fs.writeFileSync(checkpointPath, encoded, 'utf8');
    checkpoints = autosaveFiles(dir);
  }
  checkpoints.slice(maxCheckpoints).forEach((checkpoint) => fs.rmSync(checkpoint.path, { force: true }));
  return { updatedAt: doc.updatedAt, checkpointCount: Math.min(checkpoints.length, maxCheckpoints) };
}

function loadLatestAutosave(dir) {
  const latestPath = path.join(dir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    if (!doc?.data || !Array.isArray(doc.data.clips) || !Array.isArray(doc.data.transitions)) return null;
    return doc;
  } catch {
    return null;
  }
}

function clearAutosaves(dir) {
  let count = 0;
  let freedBytes = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(latest|checkpoint-\d+)\.json(?:\.tmp)?$/.test(entry.name)) continue;
      const target = path.join(dir, entry.name);
      try {
        freedBytes += fs.statSync(target).size;
        fs.unlinkSync(target);
        count += 1;
      } catch {}
    }
  } catch {}
  return { count, freedBytes };
}

module.exports = { writeAutosave, loadLatestAutosave, clearAutosaves };

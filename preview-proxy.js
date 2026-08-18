const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function proxyCacheKey(filePath) {
  const stat = fs.statSync(filePath);
  return crypto.createHash('sha256')
    .update(`${filePath}\0${stat.size}\0${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 24);
}

function pruneProxyCache(dir, options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 6);
  const maxBytes = Math.max(1, Number(options.maxBytes) || 1024 * 1024 * 1024);
  const keepPaths = new Set(options.keepPaths || []);
  if (options.keepPath) keepPaths.add(options.keepPath);
  let entries = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.tmp')) {
        fs.rmSync(fullPath, { force: true });
        continue;
      }
      if (!entry.name.endsWith('.mp4')) continue;
      const stat = fs.statSync(fullPath);
      entries.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  } catch {
    return { removedFiles: 0, freedBytes: 0 };
  }
  entries.sort((a, b) => {
    if (keepPaths.has(a.path) && !keepPaths.has(b.path)) return -1;
    if (keepPaths.has(b.path) && !keepPaths.has(a.path)) return 1;
    return b.mtimeMs - a.mtimeMs;
  });
  let keptFiles = 0;
  let keptBytes = 0;
  let removedFiles = 0;
  let freedBytes = 0;
  for (const entry of entries) {
    const keep = keepPaths.has(entry.path) || (keptFiles < maxFiles && keptBytes + entry.size <= maxBytes);
    if (keep) {
      keptFiles += 1;
      keptBytes += entry.size;
    } else {
      try {
        fs.unlinkSync(entry.path);
        removedFiles += 1;
        freedBytes += entry.size;
      } catch {}
    }
  }
  return { removedFiles, freedBytes };
}

function clearProxyCache(dir) {
  let removedFiles = 0;
  let freedBytes = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || (!entry.name.endsWith('.mp4') && !entry.name.endsWith('.tmp'))) continue;
      const target = path.join(dir, entry.name);
      try {
        freedBytes += fs.statSync(target).size;
        fs.unlinkSync(target);
        removedFiles += 1;
      } catch {}
    }
  } catch {}
  return { removedFiles, freedBytes };
}

module.exports = { proxyCacheKey, pruneProxyCache, clearProxyCache };

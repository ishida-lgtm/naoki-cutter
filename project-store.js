const fs = require('fs');

function deleteProjectFile(target) {
  let freedBytes = 0;
  try {
    freedBytes = fs.statSync(target).size;
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('選択した保存データが見つかりません');
    throw error;
  }
  fs.unlinkSync(target);
  fs.rmSync(`${target}.tmp`, { force: true });
  return freedBytes;
}

module.exports = { deleteProjectFile };

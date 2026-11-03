const fs = require('node:fs');

// A single index avoids comparing every completed episode with the whole queue.
module.exports = function completedFiles(tasks) {
  const owners = new Map(), conflicts = new Set();
  for (const task of tasks) {
    if (!task.savePath) continue;
    const vid = String(task.hongguoInfo?.vid);
    if (owners.has(task.savePath) && owners.get(task.savePath) !== vid) conflicts.add(task.savePath);
    owners.set(task.savePath, vid);
  }
  const checked = new Map();
  return task => {
    if (!task.savePath || task.pathConflict || conflicts.has(task.savePath)) return false;
    if (!checked.has(task.savePath)) {
      try {
        const stat = fs.statSync(task.savePath);
        checked.set(task.savePath, stat.isFile() && stat.size > 1024 * 100);
      } catch { checked.set(task.savePath, false); }
    }
    return checked.get(task.savePath);
  };
};

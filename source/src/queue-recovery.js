const fs = require('node:fs');
const path = require('node:path');

function restore(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map(task => ({ ...task,
    status: ['queued', 'resolving', 'downloading', 'retrying'].includes(task.status) ? 'queued' : task.status,
    speedBps: 0,
  }));
}
function load(file) {
  for (const candidate of [file, file + '.bak']) {
    try { const data = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (data && Array.isArray(data.tasks)) return data; } catch {}
  }
  return { tasks: [] };
}
function save(file, state) {
  const temporary = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(state, null, 2));
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  // Preserve only a readable previous queue; never replace the backup with
  // a corrupted file that we recovered from.
  try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, file + '.bak'); } catch (error) {
    if (!['ENOENT'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
  }
  fs.renameSync(temporary, file);
}
module.exports = { restore, load, save };

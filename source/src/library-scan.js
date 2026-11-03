const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const playable = /\.(mp4|m4v|mov|webm)$/i;
const key = value => path.resolve(value).toLowerCase();
const episodeNumber = filename => {
  const stem = path.basename(filename, path.extname(filename));
  const match = stem.match(/(?:episode|ep|第)\s*0*(\d{1,4})(?:\s*集)?(?:\D|$)/i) || stem.match(/(?:^|[ _-])(\d{1,4})$/);
  return match ? Number(match[1]) : 0;
};
// Read only: never move, rename or delete the user's video files.
module.exports = function scanLibrary(root, tasks, registry) {
  try {
    if (!root || !fs.statSync(root).isDirectory()) throw new Error('Folder unavailable');
    fs.accessSync(root, fs.constants.R_OK);
  } catch (_) { return { success: false, error: 'The selected folder is unavailable. Connect the drive or choose another folder.' }; }
  const files = [], warnings = [];
  const queue = [{ dir: path.resolve(root), depth: 0 }];
  const directories = new Map();
  let visited = 0;
  while (queue.length && visited < 20000) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { warnings.push(`${dir}: ${error.code}`); continue; }
    for (const entry of entries) {
      if (++visited > 20000) break;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth < 5) queue.push({ dir: full, depth: depth + 1 });
      if (!entry.isFile() || !playable.test(entry.name)) continue;
      try {
        const size = fs.statSync(full).size;
        if (size <= 102400) continue;
        files.push({ path: full, dir, filename: entry.name, size });
      } catch (_) {}
    }
  }
  if (visited >= 20000) warnings.push('Scan limit reached. Choose a more specific video folder.');
  const byName = new Map();
  for (const file of files) {
    const name = file.filename.toLowerCase();
    const matches = byName.get(name) || []; matches.push(file); byName.set(name, matches);
  }
  const used = new Set();
  let relocated = 0, added = 0, missing = 0;
  const good = filename => { try { return fs.statSync(filename).isFile() && fs.statSync(filename).size > 102400; } catch (_) { return false; } };
  for (const task of tasks) {
    if (!task.hongguoInfo || ['downloading', 'pending'].includes(task.status)) continue;
    const matches = byName.get(path.basename(task.savePath || task.filename || '').toLowerCase()) || [];
    const exact = matches.find(file => task.savePath && key(file.path) === key(task.savePath));
    const found = exact || (matches.length === 1 ? matches[0] : null);
    if (found) {
      if (!task.savePath || key(task.savePath) !== key(found.path)) relocated++;
      Object.assign(task, { savePath: found.path, customDir: found.dir, filename: found.filename,
        status: 'completed', progress: 100, receivedBytes: found.size, totalBytes: found.size });
      delete task.error; delete task.missingFile;
      used.add(key(found.path));
      const sid = String(task.hongguoInfo.series_id);
      const ids = directories.get(key(found.dir)) || new Set(); ids.add(sid); directories.set(key(found.dir), ids);
    } else if (task.status === 'completed' && !good(task.savePath)) {
      task.status = 'stopped'; task.progress = 0; task.missingFile = true;
      task.error = 'Video file not found. Select its new folder to locate it.'; missing++;
    }
  }
  const groups = new Map();
  for (const file of files) {
    if (used.has(key(file.path))) continue;
    const group = groups.get(key(file.dir)) || []; group.push(file); groups.set(key(file.dir), group);
  }
  for (const [dirKey, group] of groups) {
    group.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    const ids = directories.get(dirKey);
    let series = ids?.size === 1 ? registry.find(s => String(s.series_id) === [...ids][0]) : null;
    const directoryTitle = path.basename(group[0].dir);
    if (!series) series = registry.find(s => s.series_title === directoryTitle);
    if (!series) {
      const id = 'local_' + crypto.createHash('sha256').update(dirKey).digest('hex').slice(0, 20);
      series = registry.find(s => String(s.series_id) === id);
      if (!series) { series = { series_id: id, series_title: directoryTitle, cover: '', episodes: [], local: true }; registry.push(series); }
    }
    const sid = String(series.series_id);
    const existing = new Set(tasks.filter(t => String(t.hongguoInfo?.series_id) === sid).map(t => Number(t.hongguoInfo.vid_index)));
    for (const file of group) {
      let index = episodeNumber(file.filename);
      if (!index || existing.has(index)) {
        if (!series.local) continue; // Never guess an episode identity for a service show.
        index = 1; while (existing.has(index)) index++;
      }
      existing.add(index);
      const vid = `local_${crypto.createHash('sha256').update(key(file.path)).digest('hex').slice(0, 20)}`;
      const episode = (series.episodes || []).find(ep => Number(ep.vid_index) === index);
      if (!episode) (series.episodes ||= []).push({ vid, vid_index: index, title: path.parse(file.filename).name });
      tasks.unshift({ id: vid, batchId: 'local-scan', savePath: file.path, customDir: file.dir, filename: file.filename,
        title: `${series.series_title} — ${path.parse(file.filename).name}`, platform: 'hongguo', type: 'hongguo',
        status: 'completed', progress: 100, receivedBytes: file.size, totalBytes: file.size, startTime: Date.now(),
        videoInfo: { author: series.series_title, title: path.parse(file.filename).name, cover: series.cover || '' },
        hongguoInfo: { series_id: sid, series_title: series.series_title, vid_index: index,
          vid: episode?.vid || vid, ep_title: episode?.title || path.parse(file.filename).name } });
      added++;
    }
    series.total = Math.max(series.total || 0, series.episodes.length);
  }
  return { success: true, count: added, relocated, missing, scanned: files.length, warnings };
};

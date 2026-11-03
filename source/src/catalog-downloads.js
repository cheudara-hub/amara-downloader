const fs = require('node:fs');
const path = require('node:path');

// Use provider identities and files on disk, never a title-only match.
module.exports = function catalogDownloads(tasks, roots = []) {
  const groups = new Map();
  const candidates = [...tasks];
  // Queue cleanup keeps videos and album metadata. Recover their exact provider
  // identities without relying on titles or repopulating the download queue.
  const directories = new Set(tasks.filter(t => t.catalog).map(t => t.directory));
  for (const root of new Set(roots.filter(Boolean))) {
    try {
      for (const entry of fs.readdirSync(path.join(root, 'Amara'), { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) directories.add(path.join(root, 'Amara', entry.name));
      }
    } catch {}
  }
  for (const directory of directories) {
    try {
      const album = JSON.parse(fs.readFileSync(path.join(directory, 'album.json'), 'utf8'));
      if (!/^[a-z0-9_-]+$/i.test(album.platform) || !Array.isArray(album.episodes)) continue;
      // Older albums stored identity in the generated folder suffix.
      const suffix = path.basename(directory).match(/\[([^\]]+)\]$/)?.[1];
      const prefix = album.platform + '-';
      const dramaId = album.dramaId || (suffix?.startsWith(prefix) ? suffix.slice(prefix.length) : '');
      if (!dramaId) continue;
      for (const ep of album.episodes) {
        if (!Number.isSafeInteger(ep.number) || ep.number < 1 || ep.chapterId == null) continue;
        candidates.push({ directory, filename: `Episode ${String(ep.number).padStart(3, '0')}.mp4`, status: 'completed',
          catalog: { platform: album.platform, dramaId: String(dramaId), lang: album.lang || 'en', chapterId: String(ep.chapterId) } });
      }
    } catch {}
  }
  for (const task of candidates) {
    const c = task.catalog;
    if (!c || task.status !== 'completed') continue;
    try {
      const file = fs.statSync(path.join(task.directory, task.filename));
      if (!file.isFile() || file.size <= 0) continue;
    } catch { continue; }
    const key = JSON.stringify([c.platform, String(c.dramaId), c.lang || 'en']);
    if (!groups.has(key)) groups.set(key, { platform: c.platform, dramaId: String(c.dramaId), lang: c.lang || 'en', chapterIds: new Set() });
    groups.get(key).chapterIds.add(String(c.chapterId));
  }
  return [...groups.values()].map(group => ({ ...group, chapterIds: [...group.chapterIds] }));
};

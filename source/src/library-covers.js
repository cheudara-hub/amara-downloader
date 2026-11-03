const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

module.exports = function createCoverCache({ cacheDir, ffmpeg, run = execFile }) {
  const pending = new Map();
  return function coverFor(video) {
    const dir = path.dirname(video);
    if (pending.has(dir)) return pending.get(dir);
    const job = (async () => {
      let entries = [];
      try { entries = await fs.promises.readdir(dir); } catch (_) { return null; }
      const poster = entries.find(name => /^(poster|cover|folder|thumbnail)\.(jpe?g|png|webp)$/i.test(name));
      if (poster) return pathToFileURL(path.join(dir, poster)).href;
      if (!ffmpeg) return null;
      const stat = await fs.promises.stat(video);
      const hash = crypto.createHash('sha256').update(`${video}:${stat.size}:${stat.mtimeMs}`).digest('hex');
      await fs.promises.mkdir(cacheDir, { recursive: true });
      const output = path.join(cacheDir, hash + '.jpg');
      try { if ((await fs.promises.stat(output)).size > 0) return pathToFileURL(output).href; } catch (_) {}
      const extract = seek => new Promise(resolve => {
        run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-ss', seek,
          '-i', video, '-frames:v', '1', '-vf', 'scale=240:320:force_original_aspect_ratio=decrease',
          '-q:v', '4', '-y', output], { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 },
        error => resolve(!error));
      });
      if (!await extract('3')) await extract('0');
      try { if ((await fs.promises.stat(output)).size > 0) return pathToFileURL(output).href; } catch (_) {}
      return null;
    })().catch(() => null);
    pending.set(dir, job);
    job.finally(() => pending.delete(dir));
    return job;
  };
};

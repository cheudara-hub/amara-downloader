const fs = require('node:fs');
const path = require('node:path');

// A small or empty queue is still intentional user data. Only migrate missing
// files, and continue to the next old profile if one lacks the requested file.
module.exports = function migrateProfile(target, candidates) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['data.json', 'media-browser.json', 'amara-vip-license.json']) {
    const output = path.join(target, name);
    if (fs.existsSync(output)) continue;
    for (const candidate of candidates) {
      if (path.resolve(candidate) === path.resolve(target)) continue;
      try {
        const input = path.join(candidate, name);
        const data = JSON.parse(fs.readFileSync(input, 'utf8'));
        if (!data || (name === 'amara-vip-license.json'
          ? typeof data.key !== 'string' || !Number.isFinite(data.expiryTimestamp)
          : !Array.isArray(data.tasks))) continue;
        fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
        break;
      } catch (error) { if (error.code === 'EEXIST') break; }
    }
  }
};

module.exports.previousPortableProfiles = function previousPortableProfiles(executable) {
  const directory = path.dirname(executable || '');
  const pattern = /^AMARA-Downloader-v(\d+)\.(\d+)\.(\d+)-Windows-Portable$/;
  const current = pattern.exec(path.basename(directory));
  if (!current) return [];
  const compare = (a, b) => Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3]);
  try {
    return fs.readdirSync(path.dirname(directory), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => ({ name: entry.name, version: pattern.exec(entry.name) }))
      .filter(entry => entry.version && compare(entry.version, current) < 0)
      .sort((a, b) => compare(b.version, a.version))
      .map(entry => path.join(path.dirname(directory), entry.name, 'resources', 'english-user-data'));
  } catch { return []; }
};

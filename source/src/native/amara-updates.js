// Upstream discovery is separate from AMARA's reviewed release channel.
const fs = require('node:fs');
const path = require('node:path');
const INTERVAL = 6 * 60 * 60 * 1000;
function version(value) {
  const match = /^v?(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?$/.exec(String(value || ''));
  return match ? match.slice(1).map(v => Number(v || 0)) : null;
}
function newer(next, current) {
  const a = version(next), b = version(current);
  if (!a || !b) return false;
  const i = a.findIndex((part, index) => part !== b[index]);
  return i >= 0 && a[i] > b[i];
}
function repository(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) ? value : null;
}
function releaseInfo(data, repo) {
  if (!data || data.draft || data.prerelease || !version(data.tag_name)) return null;
  return { version: data.tag_name.replace(/^v/, ''), tag: data.tag_name,
    url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(data.tag_name)}` };
}
function assetUrl(asset, repo, tag) {
  if (!asset || typeof asset.name !== 'string') throw new Error('Missing release asset');
  const expected = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
  if (asset.browser_download_url !== expected) throw new Error('Unexpected release asset address');
  return expected;
}
function checkedManifest(data, info, release, repo) {
  const expectedName = `AMARA-Downloader-Setup-${info.version}.exe`;
  if (data?.product !== 'AMARA Downloader' || data.version !== info.version || data.platform !== 'win32-x64'
      || data.filename !== expectedName || !/^[a-f0-9]{64}$/.test(data.sha256 || '')
      || data.validation?.passed !== true || !Number.isSafeInteger(data.validation.testFiles) || data.validation.testFiles < 1) {
    throw new Error('AMARA release validation metadata is missing or invalid');
  }
  assetUrl((release.assets || []).find(asset => asset.name === expectedName), repo, info.tag);
  return info;
}
function createUpdateMonitor({ config, currentVersion, directory, request, isEnabled = () => true, now = Date.now }) {
  const upstreamRepo = repository(config.upstreamRepository);
  const ownRepo = repository(config.repository);
  if (!upstreamRepo || !version(config.integratedUpstreamVersion)) throw new Error('Invalid upstream configuration');
  if (config.repository && (!ownRepo || ownRepo.toLowerCase() === upstreamRepo.toLowerCase())) throw new Error('AMARA needs its own release repository');
  const cacheFile = path.join(directory, 'update-check.json');
  let cache = {}, pending = null;
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    // Cached remote fields never become install/open targets without fresh validation.
    if (saved.channel === JSON.stringify(config) && saved.currentVersion === currentVersion
        && Number.isFinite(saved.checkedAt) && saved.checkedAt <= now()) cache = { checkedAt: saved.checkedAt };
  } catch (_) {}
  let checkedInProcess = false;
  const state = () => ({ enabled: isEnabled(), checking: !!pending, checkedAt: cache.checkedAt || null,
    repository: ownRepo, errors: cache.errors || [],
    app: { current: currentVersion, latest: cache.app?.version || null,
      available: isEnabled() && newer(cache.app?.version, currentVersion), url: cache.app?.url || null },
    upstream: { integrated: config.integratedUpstreamVersion, latest: cache.upstream?.version || null,
      available: isEnabled() && newer(cache.upstream?.version, config.integratedUpstreamVersion),
      url: cache.upstream?.url || `https://github.com/${upstreamRepo}/releases` } });
  async function latest(repo) {
    return request(`https://api.github.com/repos/${repo}/releases/latest`);
  }
  function check({ force = false } = {}) {
    if (!isEnabled()) return Promise.resolve(state());
    if (pending) return pending.then(state);
    if (!force && checkedInProcess && cache.checkedAt && now() - cache.checkedAt < INTERVAL) return Promise.resolve(state());
    pending = (async () => {
      const errors = [];
      await Promise.all([
        (async () => {
          try {
            const info = releaseInfo(await latest(upstreamRepo), upstreamRepo);
            if (!info) throw new Error();
            cache.upstream = info;
          } catch (_) { errors.push('Could not check Hongguo upstream. Try again later.'); }
        })(),
        (async () => {
          if (!ownRepo) return;
          // Drop any previous actionable update before validating the current release.
          delete cache.app;
          try {
            const release = await latest(ownRepo), info = releaseInfo(release, ownRepo);
            if (!info) throw new Error();
            if (!newer(info.version, currentVersion)) { cache.app = info; return; }
            const asset = (release.assets || []).find(item => item.name === 'amara-update.json');
            const manifest = await request(assetUrl(asset, ownRepo, info.tag));
            cache.app = checkedManifest(manifest, info, release, ownRepo);
          } catch (_) { errors.push('Could not verify an AMARA release. No update will be offered.'); }
        })(),
      ]);
      // A failed check remains immediately retryable; a successful check is cached for six hours.
      cache.errors = errors;
      if (!errors.length) cache.checkedAt = now();
      checkedInProcess = !errors.length;
      try {
        fs.mkdirSync(directory, { recursive: true });
        const temporary = cacheFile + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({ checkedAt: cache.checkedAt || null, channel: JSON.stringify(config), currentVersion }));
        fs.renameSync(temporary, cacheFile);
      } catch (_) { /* A read-only profile must not prevent checking. */ }
    })().finally(() => { pending = null; });
    return pending.then(state);
  }
  return { state, check, interval: INTERVAL, async open(kind, openExternal) {
    if (!isEnabled()) throw new Error('Update checks are disabled in Settings.');
    if (kind === 'upstream') return openExternal(state().upstream.url);
    if (kind === 'app' && state().app.available && cache.app) return openExternal(cache.app.url);
    throw new Error(ownRepo ? 'No verified AMARA update is available.' : 'AMARA release repository is not configured yet.');
  } };
}
module.exports = { createUpdateMonitor, newer, repository, releaseInfo, checkedManifest, INTERVAL };

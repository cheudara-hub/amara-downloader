const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdateMonitor, newer } = require('../source/src/native/amara-updates');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amara-updates-'));
const base = { upstreamRepository: 'jackotom/hongguo-drama', integratedUpstreamVersion: '5.4', repository: null };
function monitor(overrides = {}) {
  return createUpdateMonitor({ directory, config: base, currentVersion: '2.8.10', ...overrides });
}
(async () => {
  assert.ok(newer('5.10', '5.4')); assert.ok(!newer('v5.4', '5.4.0')); assert.ok(!newer('5.4-beta', '5.3'));
  let calls = 0, enabled = true, now = 10000;
  const service = monitor({ isEnabled: () => enabled, now: () => now, request: async url => {
    calls++; assert.equal(url, 'https://api.github.com/repos/jackotom/hongguo-drama/releases/latest');
    return { tag_name: 'v5.5', html_url: 'https://attacker.example' };
  } });
  const concurrent = await Promise.all([service.check(), service.check(), service.check()]);
  assert.equal(calls, 1); assert.ok(concurrent.every(s => s.upstream.available));
  assert.equal(concurrent[0].app.available, false, 'upstream 5.x must not become an AMARA 2.x update');
  let opened;
  await service.open('upstream', url => { opened = url; });
  assert.equal(opened, 'https://github.com/jackotom/hongguo-drama/releases/tag/v5.5');
  await assert.rejects(service.open('app', () => assert.fail('no own release')));
  await service.check(); assert.equal(calls, 1);
  await service.check({ force: true }); assert.equal(calls, 2);
  now += service.interval; await service.check(); assert.equal(calls, 3);
  enabled = false; await service.check({ force: true }); assert.equal(calls, 3);
  await assert.rejects(service.open('upstream', () => assert.fail('disabled')));
  assert.equal(service.state().upstream.available, false);
  assert.throws(() => monitor({ config: { ...base, repository: base.upstreamRepository } }), /own release repository/);

  let attempts = 0;
  const retry = monitor({ request: async () => { if (++attempts === 1) throw new Error('network'); return { tag_name: 'v5.4' }; } });
  assert.equal((await retry.check()).errors.length, 1);
  assert.equal((await retry.check()).errors.length, 0); assert.equal(attempts, 2);

  const repo = 'example/amara', tag = 'v2.8.11';
  const asset = name => ({ name, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` });
  const release = { tag_name: tag, assets: [asset('amara-update.json'), asset('AMARA-Downloader-Setup-2.8.11.exe')] };
  const manifest = { product: 'AMARA Downloader', version: '2.8.11', platform: 'win32-x64',
    filename: 'AMARA-Downloader-Setup-2.8.11.exe', sha256: 'a'.repeat(64), validation: { passed: true, testFiles: 40 } };
  let invalid = false;
  const own = monitor({ config: { ...base, repository: repo }, request: async url => {
    if (url.includes('/jackotom/')) return { tag_name: 'v5.4' };
    if (url.includes('api.github.com')) return release;
    return invalid ? { ...manifest, validation: { passed: false } } : manifest;
  } });
  assert.equal((await own.check()).app.available, true);
  await own.open('app', url => { opened = url; });
  assert.equal(opened, 'https://github.com/example/amara/releases/tag/v2.8.11');
  invalid = true;
  assert.equal((await own.check({ force: true })).app.available, false, 'failed verification clears previous actionable update');
  release.assets[0].browser_download_url = 'https://attacker.example/manifest.json';
  assert.equal((await own.check({ force: true })).app.available, false);
  const restored = monitor({ request: async () => ({ tag_name: 'v5.4' }) });
  assert.equal(restored.state().app.available, false, 'cached data cannot authorize an update');
  console.log('PASS AMARA updates: separate version tracks, single-flight/cache, disabled checks, retry, release validation and trusted URLs');
})().finally(() => fs.rmSync(directory, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });

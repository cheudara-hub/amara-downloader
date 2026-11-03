const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const migrate = require('../source/src/profile-migration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amara-migration-'));
try {
  const target = path.join(root, 'current'), first = path.join(root, 'first'), second = path.join(root, 'second');
  for (const directory of [target, first, second]) fs.mkdirSync(directory);
  const queue = JSON.stringify({ tasks: [], folder: 'my-selected-folder' });
  fs.writeFileSync(path.join(target, 'media-browser.json'), queue);
  fs.writeFileSync(path.join(first, 'media-browser.json'), JSON.stringify({ tasks: [{ id: 'old' }] }));
  fs.writeFileSync(path.join(first, 'data.json'), '{broken');
  fs.writeFileSync(path.join(second, 'data.json'), JSON.stringify({ tasks: [], settings: { max_concurrent: 6 } }));
  migrate(target, [target, first, second]);
  assert.equal(fs.readFileSync(path.join(target, 'media-browser.json'), 'utf8'), queue, 'Never replace a small intentional queue');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'data.json'))).settings.max_concurrent, 6, 'Continue past missing or corrupt old profiles');
  fs.writeFileSync(path.join(target, 'data.json'), '{keep for recovery');
  migrate(target, [second]);
  assert.equal(fs.readFileSync(path.join(target, 'data.json'), 'utf8'), '{keep for recovery', 'Do not overwrite damaged data during migration');
  const portableRoot = path.join(root, 'releases');
  for (const version of ['2.8.6', '2.8.7', '2.8.8', '2.8.9']) {
    fs.mkdirSync(path.join(portableRoot, `AMARA-Downloader-v${version}-Windows-Portable/resources/english-user-data`), { recursive: true });
  }
  const executable = path.join(portableRoot, 'AMARA-Downloader-v2.8.8-Windows-Portable/AMARA Downloader.exe');
  const candidates = migrate.previousPortableProfiles(executable);
  assert.equal(candidates.length, 2, 'Never migrate from current or newer versions');
  assert.ok(candidates[0].includes('v2.8.7-'), 'Choose the most recent older portable profile first');
  fs.writeFileSync(path.join(candidates[0], 'media-browser.json'), queue);
  const license = { key: 'test-existing-key', expiryTimestamp: Date.now() + 86400000 };
  fs.writeFileSync(path.join(candidates[0], 'amara-vip-license.json'), JSON.stringify(license));
  const upgraded = path.join(path.dirname(executable), 'resources/english-user-data');
  migrate(upgraded, candidates);
  assert.equal(fs.readFileSync(path.join(upgraded, 'media-browser.json'), 'utf8'), queue);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(upgraded, 'amara-vip-license.json'))), license, 'Existing license is copied; normal startup still verifies it');
  assert.deepEqual(migrate.previousPortableProfiles(path.join(root, 'installed/AMARA Downloader.exe')), []);
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../source/main.js'), 'utf8');
  const setup = source.slice(source.indexOf('const portableUserData ='), source.indexOf("app.commandLine.appendSwitch('lang'"));
  for (const explicit of [false, true]) {
    const selected = [], identity = [], testDir = path.join(root, explicit ? 'explicit' : 'smoke');
    vm.runInNewContext(setup, { fs, path, __dirname: path.join(root, 'fake-source'),
      app: { commandLine: { getSwitchValue: () => explicit ? testDir : '' }, getPath: () => { throw new Error('Isolated checks must not read the real profile'); }, setPath: (_name, value) => selected.push(value) },
      process: { platform: 'win32', resourcesPath: path.join(testDir, 'app/resources'), argv: ['--pro-smoke-test'] },
      setDeviceIdentityFile: file => identity.push(file), require: () => { throw new Error('Isolated profiles must not migrate personal data'); }, console });
    assert.equal(selected.length, 1);
    assert.equal(identity[0], path.join(selected[0], 'danmaku-client.json'));
    if (explicit) assert.equal(selected[0], testDir, 'Explicit profile overrides smoke and portable defaults');
  }
  console.log('PASS: missing-file migration, cleared queue preservation, corrupt candidate fallback, existing data retained');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

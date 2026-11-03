const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const modulePath = path.resolve(__dirname, '../source/src/media-browser.js');
const realRequire = createRequire(modulePath);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await tick(); }
async function waitFor(check, action = () => {}) {
  const until = Date.now() + 5000;
  while (!check()) { if (Date.now() > until) throw new Error('Timed out waiting for the download queue'); action(); await new Promise(resolve => setTimeout(resolve, 10)); }
}

function fixture({ tasks = [], invalid = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amara-concurrency-'));
  fs.mkdirSync(path.join(root, 'profile'));
  let settings = { root, max_concurrent: 3 }, count = 0, peak = 0, aborts = 0, failSave = false;
  const gates = [], saved = [], quit = [];
  const ses = { setPermissionRequestHandler() {}, on() {}, webRequest: { onResponseStarted() {} }, cookies: { get: async () => [] }, getUserAgent: () => 'AMARA test' };
  const transport = async (url, file, options) => {
    count++; peak = Math.max(peak, count);
    fs.writeFileSync(file, invalid ? 'invalid' : 'verified-video');
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error) => {
        if (done) return; done = true; count--;
        options.signal.removeEventListener('abort', abort);
        if (error) reject(error); else { options.onProgress(14, 14, 1); resolve(true); }
      };
      const abort = () => { aborts++; finish(new Error('Aborted')); };
      options.signal.addEventListener('abort', abort, { once: true });
      gates.push({ url, file, get done() { return done; }, release: () => finish() });
    });
  };
  const childProcess = {
    execFile(_exe, args, _options, callback) {
      const file = args.at(-1);
      const valid = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === 'verified-video';
      setImmediate(() => callback(null, JSON.stringify(valid ? { format: { duration: '1' }, streams: [{ codec_type: 'video' }] } : { streams: [] })));
    },
    spawn(_exe, args) {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('close', 1);
      setImmediate(() => { fs.copyFileSync(args[args.indexOf('-i') + 1], args.at(-1)); child.emit('close', 0); });
      return child;
    },
  };
  const queueStorage = {
    ...realRequire('./queue-recovery'),
    load: () => ({ concurrency: 8, tasks: tasks.map(t => ({ ...t, directory: root })) }),
    save: (_file, value) => { if (failSave) throw new Error('Disk full'); saved.push(JSON.parse(JSON.stringify(value))); },
  };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, process: { platform: process.platform, argv: ['node', '--browser-probe'] },
    require: name => name === 'electron' ? {
      app: { getPath: key => key === 'userData' ? path.join(root, 'profile') : root, on: (name, fn) => { if (name === 'before-quit') quit.push(fn); } },
      ipcMain: { handle() {} }, session: { fromPartition: () => ses },
    } : name === 'child_process' ? childProcess : name === './parallel-download' ? transport : name === './queue-recovery' ? queueStorage : realRequire(name),
    AbortController, setTimeout, setInterval, clearInterval, setImmediate, console,
  });
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context);
  const browser = module.exports({ getSettings: () => settings, resolveFfmpeg: name => name, savePoster: async () => null,
    saveConcurrency: value => { settings = { ...settings, max_concurrent: value }; } });
  browser.setCatalogResolver(async task => ({ url: `https://video.example/${task.catalog.chapterId}.mp4`, referer: 'https://video.example/' }));
  const enqueue = (id, n) => browser.queueCatalog({ platform: 'dramabox', dramaId: id, title: 'Test show', episodes: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), index: i + 1 })) });
  return { browser, enqueue, gates, saved, root,
    setSaveFailure: value => { failSave = value; },
    get count() { return count; }, get peak() { return peak; }, get aborts() { return aborts; }, get settings() { return settings; },
    async cleanup() {
      for (const fn of quit) fn();
      await settle();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'amara-concurrency-')));
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
async function main() {
  const f = fixture();
  try {
    await f.enqueue('one', 10); await settle();
    assert.equal(f.count, 3, 'Honor the saved limit at startup, rather than the unrelated browser queue value');
    f.browser.setConcurrency(6); await settle(); assert.equal(f.count, 6, 'Raising the limit starts six tasks immediately');
    await f.enqueue('two', 1); await settle(); assert.equal(f.count, 6, 'Queuing another show must not reset the chosen speed');
    f.browser.setConcurrency(8); await settle(); assert.equal(f.count, 8, 'Eight independent episode transfers can run concurrently');
    assert.equal(f.settings.max_concurrent, 8); assert.equal(f.saved.at(-1).concurrency, 8);
    f.browser.setConcurrency(2); await settle(); assert.equal(f.count, 8, 'Lowering the limit does not interrupt existing transfers');
    f.gates.slice(0, 7).forEach(g => g.release());
    await waitFor(() => f.browser.stateForCheck().tasks.filter(t => t.status === 'completed').length >= 7);
    await settle();
    assert.equal(f.count, 2, 'Wait for free slots before starting further work after lowering the limit');
    assert.equal(f.aborts, 0);
    await waitFor(() => f.browser.stateForCheck().tasks.every(t => t.status === 'completed'), () => f.gates.filter(g => !g.done).forEach(g => g.release()));
    assert.equal(f.browser.stateForCheck().tasks.filter(t => t.status === 'completed').length, 11);
    assert.equal(f.peak, 8);
    for (const value of [0, 9, 2.5, 'not-a-number']) assert.throws(() => f.browser.setConcurrency(value), /1 and 8/);
  } finally { await f.cleanup(); }

  const task = id => ({ id, filename: 'Episode 001.mp4', url: 'https://video.example/1.mp4', direct: true, status: 'queued', bytes: 0 });
  const duplicate = fixture({ tasks: [task('a'), task('b')] });
  try {
    duplicate.browser.setConcurrency(8); await settle();
    assert.equal(duplicate.gates.length, 1, 'Two tasks for the same destination cannot write the same temporary file concurrently');
    duplicate.gates[0].release();
    await waitFor(() => duplicate.browser.stateForCheck().tasks.every(t => t.status === 'completed'));
    assert.equal(duplicate.browser.stateForCheck().tasks.filter(t => t.status === 'completed').length, 2);
    assert.equal(duplicate.gates.length, 1, 'The duplicate verifies and reuses the finished file');
  } finally { await duplicate.cleanup(); }

  const bad = fixture({ invalid: true });
  try {
    await bad.enqueue('bad', 1); await settle(); bad.gates[0].release();
    await waitFor(() => bad.browser.stateForCheck().tasks[0].status === 'retrying');
    const task = bad.browser.stateForCheck().tasks[0];
    assert.equal(task.status, 'retrying'); assert.match(task.error, /valid video/);
    assert.equal(fs.existsSync(path.join(task.directory, task.filename)), false, 'Do not publish an invalid video as completed');
  } finally { await bad.cleanup(); }
  const shutdown = fixture();
  try {
    shutdown.browser.setConcurrency(1);
    await shutdown.enqueue('shutdown', 4); await settle();
    assert.equal(shutdown.gates.length, 1);
  } finally { await shutdown.cleanup(); }
  assert.equal(shutdown.gates.length, 1, 'Closing the app must not start queued jobs after an active transfer aborts');
  const blocked = fixture();
  try {
    let checks = 0;
    blocked.browser.setCatalogPreflight(async () => { checks++; throw new Error('Provider unavailable'); });
    await assert.rejects(blocked.enqueue('unavailable', 80), /Provider unavailable/);
    assert.equal(checks, 1); assert.equal(blocked.browser.stateForCheck().tasks.length, 0);
    assert.equal(blocked.gates.length, 0, 'Reject an unavailable batch before creating 80 failed download jobs');
  } finally { await blocked.cleanup(); }
  const existing = fixture();
  try {
    existing.browser.setCatalogPreflight(async () => { throw new Error('Provider unavailable'); });
    const directory = path.join(existing.root, 'Amara', 'Test show [dramabox-existing]');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'Episode 001.mp4'), 'verified-video');
    await existing.enqueue('existing', 1);
    await waitFor(() => existing.browser.stateForCheck().tasks[0]?.status === 'completed');
    assert.equal(existing.gates.length, 0, 'Recover an existing valid file even if the provider is unavailable');
  } finally { await existing.cleanup(); }
  const entry = (id, status, dramaId = 'one') => ({ id, status, filename: id + '.mp4', catalog: { platform: 'dramabox', dramaId, chapterId: id, lang: 'en' } });
  const removing = fixture({ tasks: [entry('a', 'unavailable'), entry('b', 'failed'), entry('c', 'stopped'), entry('done', 'completed'), entry('busy', 'queued'), entry('other', 'failed', 'two')] });
  try {
    fs.writeFileSync(path.join(removing.root, 'a.mp4'), 'keep saved video');
    const result = await removing.browser.removeEntries('a', true);
    assert.equal(result.count, 3);
    assert.equal(removing.browser.stateForCheck().tasks.map(t => t.id).join(','), 'done,busy,other');
    assert.equal(fs.readFileSync(path.join(removing.root, 'a.mp4'), 'utf8'), 'keep saved video');
    assert.equal(removing.saved.at(-1).tasks.length, 3, 'Removal is persisted in the queue');
    await assert.rejects(removing.browser.removeEntries('done'), /Stop this download/);
    await assert.rejects(removing.browser.removeEntries('busy'), /Stop this download/);
    assert.equal((await removing.browser.removeEntries('other')).count, 1);
    let removedId;
    removing.browser.setNativeQueue({ list: () => [], concurrency: () => 3, remove: async id => { removedId = id; return { success: true }; } });
    await removing.browser.removeEntries('native:test-native'); assert.equal(removedId, 'test-native');
  } finally { await removing.cleanup(); }

  const mainSource = fs.readFileSync(path.resolve(__dirname, '../source/main.js'), 'utf8');
  const clearing = fixture({ tasks: [entry('done', 'completed'), entry('failed', 'failed')] });
  try {
    let nativeCalls = 0;
    clearing.browser.setNativeQueue({ list: () => [], concurrency: () => 3, clearCompleted: () => { nativeCalls++; }, clearAll: () => { nativeCalls++; } });
    clearing.setSaveFailure(true);
    await assert.rejects(clearing.browser.clearCompleted(), /Disk full/);
    await assert.rejects(clearing.browser.clearAll(), /Disk full/);
    assert.equal(clearing.browser.stateForCheck().tasks.length, 2, 'Failed cleanup restores entries');
    assert.equal(nativeCalls, 0, 'Do not report success or clear another queue when persistence fails');
  } finally { clearing.setSaveFailure(false); await clearing.cleanup(); }

  const albums = fixture();
  try {
    await albums.enqueue('album', 1); await settle(); albums.gates[0].release();
    await waitFor(() => albums.browser.stateForCheck().tasks[0]?.status === 'completed');
    await albums.browser.clearCompleted();
    assert.equal(albums.browser.stateForCheck().tasks.length, 0);
    assert.equal(albums.browser.catalogDownloads()[0].chapterIds.length, 1, 'Saved episode is recognized after clearing the list');
    await albums.browser.queueCatalog({ platform: 'dramabox', dramaId: 'album', title: 'Test show', episodes: [{ id: '2', index: 2 }] });
    const album = JSON.parse(fs.readFileSync(path.join(albums.root, 'Amara', 'Test show [dramabox-album]', 'album.json')));
    assert.equal(album.episodes.length, 2, 'Later batch metadata preserves earlier episode identities');
    assert.equal(album.dramaId, 'album'); assert.equal(album.lang, 'en');
    await settle();
  } finally { await albums.cleanup(); }
  const pending = [], nativeTasks = Array.from({ length: 10 }, (_, i) => ({ id: String(i), savePath: `video-${i}.mp4`, status: 'pending' }));
  const native = vm.createContext({ quitCleanup: false, downloadQueue: [...nativeTasks], activeDownloads: 0, MAX_CONCURRENT_DOWNLOADS: 6,
    runningDownloads: new Set(), runningDownloadPaths: new Set(), downloadRuns: new Map(), repairTaskDestination() {}, console,
    executeDownload: task => new Promise(resolve => pending.push(() => { task.status = 'completed'; resolve(); })),
  });
  vm.runInContext(mainSource.slice(mainSource.indexOf('function pumpQueue() {'), mainSource.indexOf('function processDownloadQueue() {')), native);
  native.pumpQueue(); assert.equal(native.activeDownloads, 6);
  native.MAX_CONCURRENT_DOWNLOADS = 8; native.pumpQueue(); assert.equal(native.activeDownloads, 8);
  native.MAX_CONCURRENT_DOWNLOADS = 2; native.pumpQueue(); assert.equal(native.activeDownloads, 8);
  pending.slice(0, 7).forEach(done => done()); await settle(); assert.equal(native.activeDownloads, 2);
  console.log('PASS: 6/8 concurrent videos, live increase/decrease, saved speed, no batch reset, destination locking and output verification');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

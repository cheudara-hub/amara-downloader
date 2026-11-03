const test = require('node:test');
const assert = require('node:assert/strict');
const { getMediaSources, setBuiltinSourceEnabled } = require('./media-sources');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('builtin source preferences persist without changing custom sources or other settings', () => {
  const settings = { root: '/downloads', custom_sources: [{ id: 'test', name: '片库', enabled: true }] };
  assert.deepEqual(getMediaSources(settings).map(s => s.id), ['hongguo', 'xifan', 'custom:test']);
  const disabled = setBuiltinSourceEnabled(settings, 'xifan', false);
  assert.deepEqual(getMediaSources(JSON.parse(JSON.stringify(disabled))).map(s => s.id), ['hongguo', 'custom:test']);
  assert.equal(disabled.root, settings.root);
  assert.equal(disabled.custom_sources, settings.custom_sources);
  const reenabled = setBuiltinSourceEnabled(disabled, 'xifan', true);
  assert.deepEqual(getMediaSources(reenabled).map(s => s.id), ['hongguo', 'xifan', 'custom:test']);
  assert.equal(getMediaSources({ builtin_sources: { hongguo: false } })[0].id, 'hongguo');
  assert.throws(() => setBuiltinSourceEnabled(settings, 'hongguo', false), /Hongguo/);
  assert.throws(() => setBuiltinSourceEnabled(settings, 'custom:test', false));
  assert.throws(() => setBuiltinSourceEnabled(settings, 'xifan', 'false'));
});

test('IPC persists source changes, notifies every window, and blocks disabled search and catalogs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-sources-'));
  const store = require('../store');
  const file = path.join(directory, 'settings.json');
  try {
    store.init(file);
    const handlers = {}, events = [];
    const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
    const context = {
      require: name => { assert.equal(name, './src/native/media-sources'); return { getMediaSources, setBuiltinSourceEnabled }; },
      store, getCurrentSettings: () => store.getSettings(),
      seriesSearch: { searchSeries: (keyword, load) => load(keyword) },
      BrowserWindow: { getAllWindows: () => [1, 2].map(id => ({ webContents: { isDestroyed: () => false, send: event => events.push([id, event]) } })) },
      sendToRenderer: (channel, data) => events.push([1, channel, data]),
      ipcMain: { handle: (name, fn) => handlers[name] = fn }, console,
    };
    const searchStart = source.indexOf('async function searchAtSource(');
    vm.runInNewContext(source.slice(searchStart, source.indexOf('\n}', searchStart) + 2), context);
    for (const name of ['get-media-sources', 'set-builtin-source-enabled', 'browse-list', 'search-series', 'search-series-more']) {
      const start = source.indexOf(`ipcMain.handle('${name}'`);
      const end = name === 'get-media-sources' ? source.indexOf('\n', start) : source.indexOf('\n});', start) + 4;
      vm.runInNewContext(source.slice(start, end), context);
    }
    try {
      await handlers['set-builtin-source-enabled']({}, 'hongguo', false);
      assert.fail('should throw');
    } catch (e) {
      assert.match(e.message, /Hongguo/);
    }
    assert.equal((await handlers['set-builtin-source-enabled']({}, 'xifan', false)).success, true);
    store.init(file);
    assert.equal(store.getSettings().builtin_sources.xifan, false, 'reopening storage keeps the switch');
    assert.deepEqual((await handlers['get-media-sources']()).sources.map(s => s.id), ['hongguo']);
    assert.deepEqual(events.map(e => [e[0], e[1]]), [[1, 'media-sources-changed']]);
    for (const name of ['browse-list', 'search-series', 'search-series-more']) {
      const result = name === 'browse-list' ? await handlers[name]({}, { source: 'xifan' }) : await handlers[name]({}, '测试', { source: 'xifan', page: 2 });
      assert.equal(result.success, false);
      assert.match(result.error, /disabled/i);
    }
    assert.equal((await handlers['set-builtin-source-enabled']({}, 'xifan', true)).success, true);
    assert.deepEqual((await handlers['get-media-sources']()).sources.map(s => s.id), ['hongguo', 'xifan']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

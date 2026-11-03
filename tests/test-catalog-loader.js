const assert = require('node:assert/strict');
const createLoader = require('../source/src/catalog-loader');
function fixture(mode, overrides = {}) {
  let loads = 0, stops = 0, current = '';
  const win = {
    isDestroyed: () => false,
    loadURL(url) {
      loads++; current = url;
      return mode === 'offline' ? Promise.reject(new Error('ERR_NAME_NOT_RESOLVED')) : new Promise(() => {});
    },
    webContents: {
      getURL: () => current,
      stop: () => { stops++; },
      executeJavaScript(script) {
        if (mode === 'hung-script') return new Promise(() => {});
        return Promise.resolve(JSON.stringify(script === 'meta' ? { page: 2, total: 12 } :
          mode === 'empty' || mode === 'offline' || (mode === 'retry' && loads === 1) ? [] : [{ series_id: '123456', series_title: 'Example' }]));
      },
    },
  };
  if (mode === 'direct') {
    let attached = false;
    win.webContents.debugger = {
      isAttached: () => attached,
      attach: () => { attached = true; },
      sendCommand: async (command, options) => {
        assert.equal(command, 'Runtime.evaluate');
        assert.equal(options.returnByValue, true);
        assert.ok(attached);
        return { result: { value: JSON.stringify(options.expression.includes('(meta)') ? { page: 2 } :
          [{ series_id: '123456', series_title: 'Direct DOM result' }]) } };
      },
    };
    win.webContents.executeJavaScript = () => { throw new Error('Must not wait for full load'); };
  }
  return { load: createLoader({ getWindow: () => win, cardsScript: 'cards', metaScript: 'meta',
    userAgent: 'test', site: 'https://example.test', timeoutMs: 100, pollMs: 5, ...overrides }),
    loads: () => loads, stops: () => stops };
}
(async () => {
  const fast = fixture('cards');
  const a = fast.load('https://example.test/category/a');
  const b = fast.load('https://example.test/category/a');
  assert.equal(a, b, 'Duplicate in-flight requests must share one navigation');
  const data = await a;
  assert.equal(data.success, true, 'Cards should return even if full page load never completes');
  assert.equal(data.meta.page, 2);
  assert.equal(data.results[0].url, 'https://example.test/detail?series_id=123456');
  assert.equal(fast.stops(), 1);
  await fast.load('https://example.test/category/a');
  assert.equal(fast.loads(), 1, 'Cache should avoid a second navigation');
  await fast.load('https://example.test/category/b');
  assert.equal(fast.loads(), 2, 'Different categories must not share results');
  const offline = fixture('offline');
  // A failed navigation with no DOM cards must surface an actionable error.
  assert.match((await offline.load('https://example.test/offline')).error, /connection or proxy/);
  const timed = fixture('empty');
  const start = Date.now();
  assert.equal((await timed.load('https://example.test/empty')).success, false);
  assert.ok(Date.now() - start < 500, 'Timeout must include navigation');
  const hung = fixture('hung-script');
  assert.equal((await hung.load('https://example.test/hung')).success, false);
  const expires = fixture('cards', { cacheMs: 0 });
  await expires.load('https://example.test/a');
  await expires.load('https://example.test/a');
  assert.equal(expires.loads(), 2, 'Expired cache must reload');
  const recovery = fixture('retry', { timeoutMs: 120 });
  const recovered = await recovery.load('https://example.test/retry');
  assert.equal(recovered.success, true, 'A slow first navigation should retry automatically');
  assert.equal(recovery.loads(), 2);
  const queued = fixture('retry', { timeoutMs: 120 });
  const first = queued.load('https://example.test/first');
  const second = queued.load('https://example.test/second');
  assert.equal((await first).success, true);
  assert.equal((await second).success, true, 'Queued requests receive their own active loading budget');
  const direct = fixture('direct');
  const directResult = await direct.load('https://example.test/direct');
  assert.equal(directResult.success, true);
  assert.equal(directResult.meta.page, 2);
  console.log('PASS: early cards, deduplication, cache, category separation, bounded waits, expiry, retry recovery, queued requests');
})().catch(error => { console.error(error); process.exitCode = 1; });

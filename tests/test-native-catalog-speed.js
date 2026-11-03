const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

let requests = 0, aborts = 0, now = Date.now();
const net = { request() {
  requests++;
  const request = new EventEmitter();
  request.abort = () => { aborts++; };
  request.end = () => setImmediate(() => {
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = {};
    request.emit('response', response);
    const html = '<script>window._ROUTER_DATA=' + JSON.stringify({ loaderData: { category: {
      categoryRoute: { contentType: 'ai-drama' }, isSuccess: true,
      recommendList: [{ series_id: '123456', series_name: 'Example' }],
      pagination: { pageNum: 1, total: 1, totalPages: 1 },
    } } }) + ';</script>';
    // Split the JSON across chunks and never finish the response.
    const split = Math.floor(html.length / 2);
    response.emit('data', Buffer.from(html.slice(0, split)));
    response.emit('data', Buffer.from(html.slice(split)));
    response.emit('error', new Error('Late error after early success'));
  });
  return request;
} };
const moduleFixture = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/src/native/catalog.js'), 'utf8'), {
  module: moduleFixture, require: name => name === 'electron' ? { net } : {},
  Buffer, AbortController, setTimeout, clearTimeout, URL,
  Date: class extends Date { static now() { return now; } },
});

(async () => {
  const { browseList } = moduleFixture.exports;
  const start = Date.now();
  const [first, duplicate] = await Promise.all([
    browseList({ category: 'ai-drama' }), browseList({ category: 'ai-drama' }),
  ]);
  assert.equal(first.success, true);
  assert.equal(first.results[0].series_title, 'Example');
  assert.equal(first.totalPages, 1);
  assert.equal(duplicate, first);
  assert.equal(requests, 1);
  assert.equal(aborts, 1, 'Stop the unfinished response after extracting complete data');
  assert.ok(Date.now() - start < 1000, 'Do not wait for the response end or timeout');
  now += 60000;
  await browseList({ category: 'ai-drama' });
  assert.equal(requests, 1, 'Revisiting after one minute should use cached data');
  await browseList({ category: 'ai-drama', forceRefresh: true });
  assert.equal(requests, 2, 'Explicit refresh must fetch again');
  now += 300001;
  await browseList({ category: 'ai-drama' });
  assert.equal(requests, 3, 'Expired results must fetch again');
  console.log('PASS: streamed category data, deduplication, early abort, five-minute cache, refresh and expiry');
})().catch(error => { console.error(error); process.exitCode = 1; });

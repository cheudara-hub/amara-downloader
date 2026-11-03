const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const download = require('../source/src/parallel-download');

async function main() {
  const directory = fs.mkdtempSync(path.join(__dirname, '.parallel-check-'));
  const output = path.join(directory, 'video');
  const body = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + Math.floor(i / 65536)) % 251;
  let active = 0, peak = 0, ranges = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.referer, 'https://player.example/');
    assert.equal(req.headers.cookie, 'session=test');
    res.setHeader('Content-Type', req.url === '/hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4');
    res.setHeader('ETag', '"sample-v1"');
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range ? Number(range[2]) : body.length - 1;
    if (req.url === '/ignore') { res.end(body); return; }
    if (range) {
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
      if (end > 0) {
        ranges++; active++; peak = Math.max(peak, active);
        res.once('close', () => active--);
        assert.equal(req.headers['if-range'], '"sample-v1"');
        if (req.url === '/changed') res.setHeader('ETag', '"sample-v2"');
        if (req.url === '/short') { res.end(body.subarray(start, start + 10)); return; }
      }
    }
    res.setHeader('Content-Length', end - start + 1);
    let position = start;
    const timer = setInterval(() => {
      const next = Math.min(end + 1, position + 65536);
      res.write(body.subarray(position, next)); position = next;
      if (position > end) { clearInterval(timer); res.end(); }
    }, 4);
    res.once('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const headers = { Referer: 'https://player.example/', Cookie: 'session=test' };
  try {
    const serialStart = Date.now();
    await new Promise((resolve, reject) => {
      http.get(address + '/serial', { headers }, response => {
        pipeline(response, fs.createWriteStream(output)).then(resolve, reject);
      }).on('error', reject);
    });
    const serialMs = Date.now() - serialStart;
    assert.deepEqual(fs.readFileSync(output), body); fs.unlinkSync(output);
    let progress = 0;
    const parallelStart = Date.now();
    assert.equal(await download(address + '/video', output, { headers, onFallback: detail => console.error('Range fallback:', detail), onProgress(bytes, total) {
      assert.ok(bytes >= progress && bytes <= total); progress = bytes;
    } }), true);
    const parallelMs = Date.now() - parallelStart;
    assert.deepEqual(fs.readFileSync(output), body);
    assert.equal(progress, body.length); assert.equal(peak, 4); assert.equal(ranges, 4);
    // Never truncate an existing destination.
    assert.equal(await download(address + '/video', output, { headers }), false);
    assert.deepEqual(fs.readFileSync(output), body); fs.unlinkSync(output);
    for (const route of ['/ignore', '/hls', '/changed', '/short']) {
      assert.equal(await download(address + route, output, { headers }), false, route);
      assert.equal(fs.existsSync(output), false, route + ' must not leave partial data');
    }
    const controller = new AbortController();
    const pending = download(address + '/video', output, { headers, signal: controller.signal,
      onProgress() { controller.abort(); } });
    await assert.rejects(pending);
    assert.equal(fs.existsSync(output), false);
    console.log(`PASS: exact output, four connections, headers, fallback, changed/truncated responses, cancellation and cleanup. Throttled loopback: serial ${serialMs}ms, parallel ${parallelMs}ms (${(serialMs / parallelMs).toFixed(1)}x).`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(directory);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { curlRequest } = require('../source/src/http-stream');
const parallelDownload = require('../source/src/parallel-download');

async function main() {
  const directory = fs.mkdtempSync(path.join(__dirname, '.system-http-check-'));
  const file = path.join(directory, 'video');
  const body = randomBytes(8 * 1048576);
  let active = 0, peak = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.referer, 'https://player.example/');
    assert.equal(req.headers.cookie, 'session=test');
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/video' }); res.end('Moved'); return; }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : body.length - 1;
    res.setHeader('Content-Type', 'video/mp4'); res.setHeader('ETag', '"fixture"');
    if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`); }
    res.setHeader('Content-Length', end - start + 1);
    if (end > 0) { active++; peak = Math.max(peak, active); res.once('close', () => active--); }
    let position = start;
    const timer = setInterval(() => {
      const next = Math.min(end + 1, position + 65536);
      res.write(body.subarray(position, next)); position = next;
      if (req.url === '/short' && end > 0) { res.destroy(); clearInterval(timer); }
      else if (position > end) { clearInterval(timer); res.end(); }
    }, 4);
    res.once('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const headers = { Referer: 'https://player.example/', Cookie: 'session=test' };
  try {
    const literal = await curlRequest(address + '/cover_[EN]_{poster}.webp', { headers });
    const chunks = [];
    for await (const chunk of literal.data) chunks.push(chunk);
    assert.equal(literal.status, 200);
    assert.deepEqual(Buffer.concat(chunks), body, 'Provider filenames with brackets and braces must be treated literally');
    assert.equal(await parallelDownload(address + '/redirect', file, { headers, request: curlRequest }), true);
    assert.deepEqual(fs.readFileSync(file), body); assert.equal(peak, 4); fs.unlinkSync(file);
    assert.equal(await parallelDownload(address + '/short', file, { headers, request: curlRequest }), false);
    assert.equal(fs.existsSync(file), false);
    const controller = new AbortController();
    await assert.rejects(parallelDownload(address + '/video', file, { headers, request: curlRequest,
      signal: controller.signal, onProgress() { controller.abort(); } }));
    assert.equal(fs.existsSync(file), false);
    console.log('PASS: system HTTP transport, redirected binary output, headers/cookies, concurrent ranges, exact bytes, truncation and cancellation cleanup');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(directory);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const axios = require('../source/node_modules/axios/dist/node/axios.cjs');
const createPosterSaver = require('../source/src/poster');

(async () => {
  const root = await fs.mkdtemp(path.join(__dirname, 'hongguo-poster-test-'));
  // 1x1 JPEG byte sequence
  const jpegHeader = Buffer.from('ffd8ffe000104a46494600010101006000600000ffdb004300', 'hex');
  const dummyJpeg = Buffer.concat([jpegHeader, Buffer.alloc(100, 0)]);
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    requestCount++;
    if (req.url === '/poster.jpg') {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(dummyJpeg);
    }
    if (req.url === '/forbidden' && req.headers.referer) {
      res.statusCode = 403;
      return res.end('Forbidden with referer');
    }
    if (req.url === '/forbidden' && !req.headers.referer) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(dummyJpeg);
    }
    res.statusCode = 404;
    res.end('Not found');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const downloadDir = path.join(root, 'Test Drama');
    const savePoster = createPosterSaver(axios.create({ proxy: false }), {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://novelquickapp.com/',
    });

    // 1. Initial poster download into series folder
    const posterUrl = `http://127.0.0.1:${port}/poster.jpg`;
    const savedPath = await savePoster(downloadDir, posterUrl);
    assert.equal(savedPath, path.join(downloadDir, 'poster.jpg'), 'Poster must be saved as poster.jpg');
    assert.ok(require('node:fs').existsSync(savedPath), 'poster.jpg file must exist in download folder');
    assert.equal(requestCount, 1, 'One request made for initial poster download');

    // 2. Subsequent episodes should reuse existing poster without network request
    const secondCall = await savePoster(downloadDir, posterUrl);
    assert.equal(secondCall, savedPath, 'Existing poster must be returned immediately');
    assert.equal(requestCount, 1, 'No new network request should be made for existing poster');

    // 3. Concurrent episode queue calls must be deduplicated
    const secondDir = path.join(root, 'Second Drama');
    const results = await Promise.all([
      savePoster(secondDir, posterUrl),
      savePoster(secondDir, posterUrl),
      savePoster(secondDir, posterUrl),
    ]);
    assert.equal(results.length, 3);
    assert.ok(results.every(p => p === path.join(secondDir, 'poster.jpg')));
    assert.equal(requestCount, 2, 'Concurrent calls for new drama must trigger only one network request');

    // 4. Test Referer retry fallback on 403
    const thirdDir = path.join(root, 'Third Drama');
    const forbiddenUrl = `http://127.0.0.1:${port}/forbidden`;
    const fallbackPath = await savePoster(thirdDir, forbiddenUrl);
    assert.equal(fallbackPath, path.join(thirdDir, 'poster.jpg'), 'Referer retry fallback succeeds');

    console.log('PASS: Hongguo poster download tests passed successfully.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

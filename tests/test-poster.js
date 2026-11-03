const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const axios = require('../source/node_modules/axios/dist/node/axios.cjs');
const createSaver = require('../source/src/poster');

(async () => {
  const root = await fs.mkdtemp(path.join(__dirname, 'poster-test-'));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=', 'base64');
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/bad') return res.end('<html>not a poster</html>');
    res.end(image);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const save = createSaver(axios.create({proxy: false}));
    const url = `http://127.0.0.1:${server.address().port}`;
    const show = path.join(root, 'Show');
    const results = await Promise.all([save(show, url), save(show, url), save(show, url)]);
    assert.equal(requests, 1, 'Concurrent episodes must share one poster request');
    assert(results.every(file => file === path.join(show, 'poster.png')));
    assert.deepEqual(await fs.readFile(results[0]), image);
    await save(show, url);
    assert.equal(requests, 1, 'Existing poster must be reused');
    const bad = path.join(root, 'Bad');
    assert.equal(await save(bad, url + '/bad'), null);
    assert.deepEqual(await fs.readdir(bad), [], 'Invalid responses must leave no files');
    assert.equal(await save(bad, null), null);
    assert(await save(bad, url), 'A failed request must be retryable');
    let loaded = 0;
    const catalogSave = createSaver(null, {}, { loadImage: async () => { loaded++; return image; } });
    const catalog = path.join(root, 'Catalog movie');
    const poster = await catalogSave(catalog, 'https://covers.example/movie.heic');
    assert.deepEqual(await fs.readFile(poster), image, 'Catalog poster uses the shared compatible image loader');
    await catalogSave(catalog, 'https://covers.example/movie.heic'); assert.equal(loaded, 1);
    console.log('Poster checks passed: image saved, concurrent requests deduplicated, existing image reused, invalid response skipped, retry succeeded.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

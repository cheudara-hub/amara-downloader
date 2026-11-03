const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const create = require('../source/src/library-covers');
const root = fs.mkdtempSync(path.join(__dirname, '.covers-check-'));
const cache = path.join(root, 'cache');
const video = path.join(root, 'episode.mp4');
const poster = path.join(root, 'poster.png');
(async () => {
  try {
    fs.writeFileSync(video, 'fixture'); fs.writeFileSync(poster, 'poster fixture');
    let calls = 0;
    const get = create({ cacheDir: cache, ffmpeg: 'ffmpeg', run: (_command, args, options, callback) => {
      calls++; assert.equal(options.windowsHide, true); assert.equal(options.timeout, 15000);
      fs.writeFileSync(args[args.length - 1], 'frame fixture'); callback(null);
    } });
    assert.equal(await get(video), pathToFileURL(poster).href, 'Use the local poster before extracting video');
    assert.equal(calls, 0);
    fs.unlinkSync(poster);
    const [a, b] = await Promise.all([get(video), get(video)]);
    assert.equal(a, b); assert.ok(a.endsWith('.jpg')); assert.equal(calls, 1, 'Concurrent requests share one extraction');
    assert.equal(await get(video), a); assert.equal(calls, 1, 'Cached thumbnail must avoid further extraction');
    const unavailable = create({ cacheDir: cache, ffmpeg: null });
    assert.equal(await unavailable(video), null);
    console.log('PASS: local poster priority, background extraction, shared requests, thumbnail cache, absent FFmpeg');
  } finally {
    if (fs.existsSync(poster)) fs.unlinkSync(poster);
    fs.unlinkSync(video);
    if (fs.existsSync(cache)) { for (const file of fs.readdirSync(cache)) fs.unlinkSync(path.join(cache, file)); fs.rmdirSync(cache); }
    fs.rmdirSync(root);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

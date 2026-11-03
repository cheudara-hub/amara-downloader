const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { imageType, createImageLoader } = require('../source/src/pro-images');
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const heic = Buffer.alloc(32); heic.write('ftyp', 4); heic.write('heic', 8);
async function main() {
  let requests = 0, converted = 0, active = 0, peak = 0, retryRequests = 0;
  const loader = createImageLoader({
    transport: async url => {
      requests++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15)); active--;
      if (url.includes('denied-proxy')) return { status: 403, data: Readable.from(['Forbidden']) };
      if (url.includes('retry') && ++retryRequests === 1) return { status: 503, data: Readable.from(['Temporarily unavailable']) };
      return { status: 200, data: Readable.from([url.includes('bad') ? Buffer.from('<html>not an image</html>') : url.includes('heic') ? heic : jpeg]) };
    },
    readBody: async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); },
    convert: async input => { assert.equal(imageType(input), 'image/heic'); converted++; return jpeg; },
    fallbackUrl: url => url.includes('denied-proxy') ? url.replace('denied-proxy', 'cdn') : null,
  });
  const images = await Promise.all(Array.from({ length: 12 }, () => loader.load('https://covers.example/cover.heic')));
  assert.equal(requests, 1); assert.equal(converted, 1); assert.ok(images.every(image => image.type === 'image/jpeg' && image.data.equals(jpeg)));
  await loader.load('https://covers.example/cover.heic'); assert.equal(requests, 1);
  await Promise.all(Array.from({ length: 12 }, (_value, index) => loader.load(`https://covers.example/${index}.jpg`))); assert.ok(peak <= 4);
  await assert.rejects(loader.load('https://covers.example/bad'), /Unsupported cover/);
  await assert.rejects(loader.load('https://covers.example/bad'), /Unsupported cover/);
  assert.equal(imageType(Buffer.from('<html>not an image</html>')), null);
  const recovered = await loader.load('https://covers.example/retry.jpg'); assert.equal(recovered.type, 'image/jpeg'); assert.equal(retryRequests, 2);
  assert.equal((await loader.load('https://covers.example/denied-proxy.jpg')).type, 'image/jpeg');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amara-cover-cache-'));
  try {
    const urls = ['https://covers.example/disk-a', 'https://covers.example/disk-b'];
    for (const url of urls) {
      const hash = crypto.createHash('sha256').update(url).digest('hex');
      fs.writeFileSync(path.join(directory, hash + '.bin'), jpeg);
      fs.writeFileSync(path.join(directory, hash + '.json'), JSON.stringify({ type: 'image/jpeg' }));
    }
    let downloads = 0;
    const disk = createImageLoader({ cacheDir: directory, maxBytes: jpeg.length,
      transport: async () => { downloads++; return { status: 200, data: Readable.from([jpeg]) }; },
      readBody: async stream => { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); } });
    await disk.load(urls[0]); await disk.load(urls[1]);
    assert.equal(downloads, 0);
    const hash = crypto.createHash('sha256').update(urls[0]).digest('hex');
    fs.unlinkSync(path.join(directory, hash + '.bin'));
    await disk.load(urls[0]);
    assert.equal(downloads, 1, 'Disk hits must honor the memory budget and evict older covers');
    // Allow the asynchronous disk write to finish before removing the fixture.
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log('PASS: HEIC conversion, supported image detection, cached/deduplicated covers, bounded concurrency, invalid responses and retry');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

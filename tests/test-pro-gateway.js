const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const start = require('../source/src/pro-gateway');
async function main() {
  let calls = 0;
  const transport = async (url, options) => {
    calls++;
    if (url.startsWith('https://media.example/')) {
      if (url.includes('master.m3u8')) return { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, data: Readable.from(['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts\n']) };
      assert.equal(options.headers.Referer, 'https://player.example/');
      return { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/5', 'content-length': '3' }, data: Readable.from(['abc']) };
    }
    assert.ok(options.headers['X-Signature']);
    const data = url.includes('/video') ? { streams: [{ url: 'https://media.example/master.m3u8' }, { url: 'https://media.example/video.mp4' }], streamHeaders: { Referer: 'https://player.example/' } } : [{ name: 'dramabox' }];
    return { status: 200, headers: {}, data: Readable.from([JSON.stringify({ success: true, data })]) };
  };
  const gateway = await start({ transport });
  try {
    await Promise.all([gateway.api('categories'), gateway.api('categories')]);
    await gateway.api('categories'); assert.equal(calls, 1, 'Concurrent and cached catalog requests share one fetch');
    await gateway.api('video', 'id=1'); await gateway.api('video', 'id=1'); assert.equal(calls, 3, 'Expiring video URLs are not cached');
    const playlist = await (await fetch(gateway.origin + '/api/stream-proxy?url=' + encodeURIComponent('https://media.example/master.m3u8'))).text();
    assert.ok(playlist.includes(encodeURIComponent('https://media.example/key.bin')));
    assert.ok(playlist.includes(encodeURIComponent('https://media.example/segment.ts')));
    const video = await fetch(gateway.origin + '/api/stream-proxy?url=' + encodeURIComponent('https://media.example/video.mp4'), { headers: { Range: 'bytes=0-2' } });
    assert.equal(video.status, 206); assert.equal(video.headers.get('content-range'), 'bytes 0-2/5'); assert.equal(await video.text(), 'abc');
    const blocked = await fetch(gateway.origin + '/api/stream-proxy?url=' + encodeURIComponent('http://127.0.0.1/private')); assert.equal(blocked.status, 502);
    const untrusted = await fetch(new URL('/api/categories', gateway.origin)); assert.equal(untrusted.status, 404);
    assert.throws(() => start.rewritePlaylist('#EXTM3U\nfile:///secret', 'https://example.com/master.m3u8', '/proxy?url='));
    console.log('PASS: catalog caching, fresh stream URLs, HLS playlist/key rewriting, provider headers, range forwarding, private URL rejection, token routing');
  } finally { gateway.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

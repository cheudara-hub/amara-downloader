const assert = require('node:assert/strict');
const vm = require('node:vm');
const { collectPage, mediaSources } = require('../source/src/media-page');
function scan(options, sources = [], playerError = '', scripts = [], links = [], frames = []) {
  const document = {
    scripts: scripts.map(textContent => ({ textContent })), title: 'Player', querySelector: selector => selector === '.vp_video_stub_txt' ? { textContent: playerError } : null,
    querySelectorAll(selector) {
      if (selector === '[data-options]') return options.map(value => ({ getAttribute: () => JSON.stringify(value) }));
      if (selector === 'video, source') return sources.map(src => ({ src }));
      if (selector === 'a[href], [data-video], [data-src], [data-file]') return links;
      if (selector === 'iframe[src]') return frames;
      return [];
    },
  };
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${collectPage.toString()})()`, { document, URL, location: { href: 'https://ok.ru/videoembed/123' }, performance: { getEntriesByType: () => [] } })));
}
const metadata = { hlsManifestUrl: 'https://cdn.example/video.m3u8?id=123&sig=valid', videos: [{ name: 'sd', url: 'https://cdn.example/?id=123&type=1' }, { name: 'hd', url: 'https://cdn.example/?id=123&type=2' }, { name: 'full', url: 'https://cdn.example/restricted', disallowed: true }] };
for (const value of [metadata, JSON.stringify(metadata)]) {
  const result = scan([{ flashvars: { metadata: value } }]);
  assert.equal(result.media[0], metadata.videos[1].url);
  assert.equal(result.media[2], metadata.hlsManifestUrl);
  assert.equal(result.media.length, 3);
  assert.equal(result.url, 'https://ok.ru/videoembed/123');
}
assert.deepEqual(scan([{ metadata: {} }]).media, []);
assert.deepEqual(scan([{ metadata: { drm: true, ...metadata } }]).media, []);
assert.deepEqual(scan([], ['https://cdn.example/?video=123', 'blob:https://ok.ru/123']).media, ['https://cdn.example/?video=123']);
assert.equal(scan([], [], 'The author of this video has not been found or is blocked').unavailable, 'The author of this video has not been found or is blocked');
assert.equal(scan([], [], 'Loading video').unavailable, '');
const playlist = scan([], [], '', ['options.player_list=[{"file":"//ok.ru/videoembed/123","title":"01.Episode"},{"file":"https://cdn.example/video.mp4","title":"02.Episode"},];']);
assert.deepEqual(playlist.episodes.map(episode => [episode.number, episode.url, episode.direct]), [[1, 'https://ok.ru/videoembed/123', false], [2, 'https://cdn.example/video.mp4', true]]);
console.log('PASS: OK player metadata objects/strings, signed HLS URLs, extensionless video, quality ordering, restricted/DRM sources excluded, empty values excluded.');

const sources = mediaSources({ media: [metadata.hlsManifestUrl, metadata.videos[1].url], sources: [{ url: metadata.videos[1].url, referer: 'https://player.example/' }] }, 'https://episode.example/');
assert.equal(sources[0].url, metadata.videos[1].url);
assert.equal(sources[0].referer, 'https://player.example/');
assert.equal(sources[1].url, metadata.hlsManifestUrl);
const row = (number, options = {}) => ({
  textContent: `${String(number).padStart(2, '0')} Sis Chbong Kompul Lbech ${number} October 21, 2026`, dataset: {},
  getAttribute: () => `https://luly.top/sis-chbong-kompul-lbech-${String(number).padStart(2, '0')}/`,
  closest: selector => !options.unrelated && selector.includes('.eplister') ? {} : null,
  querySelector: selector => selector.includes('.epl-num') ? { textContent: String(number) } : selector.includes('.epl-title') ? { textContent: `Sis Chbong Kompul Lbech ${number}` } : null,
});
const table = scan([], [], '', [], [row(10, { unrelated: true }), ...Array.from({ length: 10 }, (_value, index) => row(10 - index)), row(1)]);
assert.deepEqual(table.episodes.map(episode => episode.number), [1,2,3,4,5,6,7,8,9,10]);
assert.ok(table.episodes.every(episode => !episode.title.includes('October') && !episode.direct));
assert.equal(scan([], [], '', [], [row(1, { unrelated: true })]).episodes.length, 0, 'Unrelated title cards are not episodes');
const frame = (url, inPlayer) => ({ getAttribute: () => url, closest: () => inPlayer ? {} : null });
assert.deepEqual(scan([], [], '', [], [], [frame('https://s4.nizu.top/?id=123', true), frame('https://ads.example/banner', false), frame('https://doubleclick.net/player', true)]).players, ['https://s4.nizu.top/?id=123']);
console.log('PASS: theme episode tables, number/title columns, date exclusion, sorting, deduplication, unrelated cards excluded, primary player frames');
assert.equal(sources[1].referer, 'https://episode.example/');

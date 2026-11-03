const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../source/pro/app.js'), 'utf8');

function fixture() {
  const timers = new Map(); let timerId = 0;
  const element = () => {
    const classes = new Set();
    return { textContent: '', classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
    } };
  };
  const video = { src: '', pause() {}, load() {}, removeAttribute() { this.src = ''; }, play: () => Promise.resolve() };
  const DOM = Object.fromEntries(['playerOverlay', 'videoSpinner', 'bigPlayIcon', 'currentQualityText', 'playerDramaTitle', 'playerEpisodeTitle', 'episodeDrawer'].map(key => [key, element()]));
  DOM.mainVideoPlayer = video;
  const state = { currentPlatform: 'dramabox', currentLang: 'en', currentPlaying: { streams: [
    { quality: '1080p', url: 'https://media.example/high.mp4' },
    { quality: '720p', url: 'https://media.example/medium.mp4' },
    { quality: '540p', url: 'https://media.example/low.mp4' },
  ], currentQuality: '1080p' } };
  const messages = [];
  const context = vm.createContext({ DOM, state, window: {}, console,
    document: { body: { style: {} } }, renderDrawerEpisodes() {}, saveHistory() {},
    showToast: message => messages.push(message), desktopApiUrl: url => 'http://gateway.example' + url,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source.slice(source.indexOf('let hlsInstance ='), source.indexOf('// DOM Element Selectors')) +
    source.slice(source.indexOf('async function openDramaPlayer('), source.indexOf('function renderDrawerEpisodes(')), context);
  return { context, state, DOM, video, timers, messages };
}

async function main() {
  const a = fixture();
  a.video.play = () => a.video.src.includes('high.mp4') ? Promise.reject(new Error('Media unsupported')) : Promise.resolve();
  a.context.playStreamQuality('1080p');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(a.video.src.includes('medium.mp4'), 'A rejected high quality stream falls back to 720p through the gateway');
  assert.equal(a.state.currentPlaying.currentQuality, '720p');

  const b = fixture(); b.context.playStreamQuality('1080p');
  for (let index = 0; index < 3; index++) [...b.timers.values()][0]();
  assert.equal(b.video.src, '', 'Exhausted streams release the failed video');
  assert.equal(b.timers.size, 0, 'Retries terminate after all qualities fail');
  assert.ok(b.messages.at(-1).includes('Reopen this episode'));
  b.context.playStreamQuality('1080p');
  assert.ok(b.video.src.includes('high.mp4'), 'A manual quality selection starts a fresh attempt');
  b.context.closePlayer(); assert.equal(b.timers.size, 0);

  const c = fixture(); c.video.play = () => Promise.reject(Object.assign(new Error('User gesture required'), { name: 'NotAllowedError' }));
  c.context.playStreamQuality('1080p'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.state.currentPlaying.currentQuality, '1080p', 'Autoplay restrictions do not consume another quality');
  assert.equal(c.timers.size, 0); assert.equal(c.DOM.bigPlayIcon.classList.contains('hidden'), false);

  const d = fixture(); let resolveResponse;
  d.context.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  const pending = d.context.openDramaPlayer({ id: 'show', title: 'Test' }, 1, '1');
  d.context.closePlayer();
  resolveResponse({ json: async () => ({ success: true, data: { streams: [{ quality: '720p', url: 'https://media.example/stale.mp4' }] } }) });
  await pending; assert.equal(d.video.src, '', 'A late episode response cannot restart a closed player');
  console.log('PASS: failed stream fallback, bounded stall recovery, manual retry, autoplay handling, close cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

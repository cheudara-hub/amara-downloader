const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const create = require('../source/src/catalog-playback');
async function main() {
  let calls = 0, clock = 0;
  const bad = { platform: 'stardusttv', dramaId: '2866', chapterId: '1', lang: 'en' };
  const good = { ...bad, dramaId: 'working' };
  const player = create({ now: () => clock, video: async query => {
    calls++; const q = new URLSearchParams(query);
    if (q.get('id') === '2866') { const error = new Error('Internal Server Error. The video refused to load, probably because your request is just cursed.'); error.status = 500; throw error; }
    return { success: true, data: { streams: [{ url: 'https://video.example/episode.mp4' }], streamHeaders: { Referer: 'https://player.example/' } } };
  } });
  await assert.rejects(player.probe(bad), error => error.code === 'PROVIDER_VIDEO_UNAVAILABLE' && !/cursed|refused/.test(error.message));
  await player.probe(good); const before = calls;
  const source = await player.resolve(good);
  assert.equal(calls, before, 'The first job reuses the probed stream without an extra provider request');
  assert.equal(source.referer, 'https://player.example/');
  await player.resolve(good); assert.equal(calls, before + 1, 'A consumed probe is never reused indefinitely');
  await player.probe(good); clock = 31000;
  const expired = calls; await player.resolve(good); assert.equal(calls, expired + 1, 'Expired signed links are resolved afresh');
  const tasks = Array.from({ length: 80 }, (_, i) => ({ catalog: { ...bad, chapterId: String(i + 1) } }));
  tasks.push({ catalog: good }); const attempts = calls;
  const checked = await create.checkGroups(tasks, player.probe);
  assert.equal(calls - attempts, 2, 'Retrying 80 broken episodes and one working title performs only one probe per title');
  assert.ok(checked.get(create.groupKey(bad))); assert.equal(checked.get(create.groupKey(good)), null);

  const app = fs.readFileSync(path.resolve(__dirname, '../source/pro/app.js'), 'utf8');
  const el = () => ({ classList: { add() {}, remove() {} }, textContent: '', innerHTML: '' });
  const DOM = new Proxy({}, { get(target, key) { return target[key] ||= el(); } });
  const state = { currentPlatform: 'stardusttv', currentEpisodes: [] }, messages = [];
  const context = vm.createContext({ DOM, state, plannedTotal: 80, drama: { id: '2866', title: 'Unavailable title' },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    escapeHtml: value => value, capitalize: value => value, showToast: text => messages.push(text),
    renderEpisodesGrid() { throw new Error('An empty detail response must not create 80 episodes'); },
  });
  vm.runInContext(app.slice(app.indexOf('  function applyDetailData(json) {'), app.indexOf('\n  if (cachedDetail) {')), context);
  const result = context.applyDetailData({ success: true, data: { id: '2866', title: '', total_episodes: 0, chapters: [] } });
  assert.equal(result, false); assert.equal(state.currentEpisodes.length, 0);
  DOM.btnDetailDownloadAll.onclick(); assert.match(messages[0], /No released episodes/);
  let detailCalls = 0;
  const gateway = await require('../source/src/pro-gateway')({ transport: async () => {
    detailCalls++;
    const data = detailCalls < 3 ? { title: '', total_episodes: 0, chapters: [] } : { title: 'Recovered title', chapters: [{ id: '1' }] };
    return { status: 200, data: Readable.from([JSON.stringify({ success: true, data })]) };
  } });
  try {
    await gateway.api('detail', 'id=2866'); await gateway.api('detail', 'id=2866');
    assert.equal(detailCalls, 2, 'Do not cache an empty provider detail response for twelve hours');
    assert.equal((await gateway.api('detail', 'id=2866')).data.title, 'Recovered title');
    await gateway.api('detail', 'id=2866'); assert.equal(detailCalls, 3, 'A recovered valid detail response uses the normal cache');
  } finally { gateway.close(); }
  console.log('PASS: broken-provider errors, one probe per batch/retry title, signed-link reuse/expiry, and no invented episodes from card counts');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

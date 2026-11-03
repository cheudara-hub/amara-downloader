const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const elements = new Map();
  const el = () => ({ children: [], setAttribute() {}, append(...values) { this.children.push(...values); },
    before(node) { elements.set(node.id, node); }, after(node) { elements.set(node.id, node); } });
  const DOM = Object.fromEntries(['gridPopular', 'gridLatest', 'gridDiscover', 'gridSearch', 'sectionCountPopular', 'searchResultCountText'].map(key => [key, el()]));
  for (const key of Object.keys(DOM)) elements.set(key, DOM[key]);
  const state = { currentPlatform: 'dramabox', currentLang: 'en' }, requests = [];
  const c = vm.createContext({ state, DOM, URLSearchParams,
    document: { getElementById: id => elements.get(id), createElement: el },
    fetch: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    renderDramaGrid: (grid, data) => { grid.items = data; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../source/pro/provider-pagination.js'), 'utf8'), c);
  return { api: c.amaraProviderPages, state, DOM, requests, elements };
}
const response = (data, page, hasMore = true) => ({ success: true, data, page, hasMore });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const f = fixture(), first = { id: '1', title: 'First', chapters: 50 };
  f.api.begin('home'); f.api.received('home', response([first], 1), [first]);
  assert.equal(f.elements.get('providerMore-home-top').hidden, false, 'Load more is visible above the grid');
  assert.equal(f.elements.get('providerMore-home').hidden, false, 'Load more is visible below the grid');
  const more = f.api.loadMore('home');
  assert.match(f.requests[0].url, /^\/api\/discover\?/);
  assert.match(f.requests[0].url, /page=1/);
  f.requests[0].resolve({ json: async () => response([first], 1, false) });
  await tick();
  assert.equal(f.requests.length, 2, 'Skip the featured titles already present and check another Discover page');
  const second = { id: '2', title: 'More title', chapters: 60 };
  f.requests[1].resolve({ json: async () => response([first, second], 2, false) });
  await more;
  assert.equal(f.state.homeDramas.length, 2);
  assert.equal(f.state.homeDramas[1], second, 'Keep the provider ID, episode count and original object for downloads');
  const end = f.api.loadMore('home');
  f.requests[2].resolve({ json: async () => response([], 3, false) }); await end;
  assert.equal(f.elements.get('providerMore-home').children[1].hidden, true);
  assert.equal(f.state.homeDramas.length, 2, 'An empty page keeps all previously loaded titles');

  const r = fixture();
  r.api.begin('discover'); r.api.received('discover', response([first, second], 1), [first, second]);
  const duplicate = r.api.loadMore('discover');
  r.requests[0].resolve({ json: async () => response([second, first], 2) }); await duplicate;
  assert.equal(r.state.discoverDramas.length, 2, 'A repeated page with shuffled order does not duplicate titles');
  assert.equal(r.elements.get('providerMore-discover').children[1].hidden, true);

  const s = fixture();
  s.api.begin('search'); s.api.received('search', response([first], 1), [first], 'love & life');
  const fail = s.api.loadMore('search'); s.requests[0].reject(new Error('Network unavailable')); await fail;
  assert.match(s.elements.get('providerMore-search').children[0].textContent, /Network unavailable/);
  const retry = s.api.loadMore('search');
  assert.match(s.requests[1].url, /page=2/); assert.match(s.requests[1].url, /q=love\+%26\+life/);
  s.requests[1].resolve({ json: async () => response([second], 2) }); await retry;
  assert.equal(s.state.searchResults.length, 2);
  const stale = s.api.loadMore('search');
  s.api.invalidate(); s.state.currentPlatform = 'melolo';
  s.requests[2].resolve({ json: async () => response([{ id: 'late' }], 3) }); await stale;
  assert.equal(s.state.searchResults.length, 2, 'Late responses cannot replace a different platform');
  assert.equal(s.elements.get('providerMore-search').hidden, true);
  const l = fixture(); l.api.begin('discover'); l.api.received('discover', response([first], 1), [first]);
  const language = l.api.loadMore('discover'); l.state.currentLang = 'th';
  l.requests[0].resolve({ json: async () => response([second], 2) }); await language;
  assert.equal(l.state.discoverDramas, undefined, 'Late responses cannot replace a different language');
  console.log('PASS: visible Load more, Home-to-Discover continuation, inaccurate hasMore handling, deduplication, retry, end detection, download identity and stale-response protection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

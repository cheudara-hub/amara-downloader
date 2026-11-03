const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../source/pro/app.js'), 'utf8');
const element = () => ({ innerHTML: '', textContent: '', classList: { add() {}, remove() {} } });
const DOM = Object.fromEntries(['gridPopular', 'gridLatest', 'sectionCountPopular', 'gridDiscover',
  'popularTagsCloud', 'gridSearch', 'searchResultCountText', 'btnClearSearch'].map(name => [name, element()]));
const state = { currentPlatform: 'dramabox', currentLang: 'en' };
const waiting = [];
const context = vm.createContext({ DOM, state, console, setTimeout, clearTimeout, encodeURIComponent,
  fetch: url => new Promise((resolve, reject) => waiting.push({ url, resolve, reject })),
  renderDramaGrid: (target, data) => { target.items = data; }, renderHeroBanner() {},
  capitalize: value => value,
});
vm.runInContext(source.slice(source.indexOf('const catalogRequests ='), source.indexOf('// Render Hero Banner')) +
  source.slice(source.indexOf('// Discover View'), source.indexOf('// Event Listeners Wiring')), context);
function complete(index, title) { waiting[index].resolve({ json: async () => ({ success: true, data: [{ title }] }) }); }
(async () => {
  const oldHome = context.loadHomeData('dramabox');
  state.currentPlatform = 'melolo';
  const newHome = context.loadHomeData('melolo');
  complete(1, 'New home'); await newHome;
  complete(0, 'Old home'); await oldHome;
  assert.equal(DOM.gridPopular.items[0].title, 'New home');
  const oldDiscover = context.loadDiscoverData('melolo');
  const newDiscover = context.loadDiscoverData('melolo');
  complete(3, 'New discover'); await newDiscover;
  waiting[2].reject(new Error('Late failure')); await oldDiscover;
  assert.equal(DOM.gridDiscover.items[0].title, 'New discover');
  const oldSearch = context.performSearch('old');
  const newSearch = context.performSearch('<new>');
  assert.ok(DOM.searchResultCountText.textContent.includes('<new>'), 'Search input is displayed as plain text');
  complete(5, 'New search'); await newSearch;
  complete(4, 'Old search'); await oldSearch;
  assert.equal(DOM.gridSearch.items[0].title, 'New search');
  const clearedSearch = context.performSearch('clear me');
  context.handleSearchInput('');
  complete(6, 'Should stay cleared'); await clearedSearch;
  assert.equal(DOM.gridSearch.innerHTML, '');
  assert.equal(DOM.searchResultCountText.textContent, 'Enter keywords to start searching');
  console.log('PASS: platform switching, out-of-order home/discover/search responses, late errors and clearing search');
})().catch(error => { console.error(error); process.exitCode = 1; });

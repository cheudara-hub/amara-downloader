// Exercise the actual bundled Browse component and its page-change callbacks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const bundle = fs.readFileSync(path.join(__dirname, '../source/dist-react/assets/index-DbJrpGyO.js'), 'utf8');
const start = bundle.indexOf('function nv('), end = bundle.indexOf('function rv(', start);
assert.ok(start >= 0 && end > start, 'Browse component boundaries must remain identifiable');
const component = bundle.slice(start, end);
function render({ page = 1, totalPages = 0, hasMore = true, loading = false, source = 'hongguo' } = {}) {
  let stateIndex = 0, changed;
  const context = {
    c: {
      useState(initial) {
        const index = stateIndex++;
        const overrides = { 0: source, 4: page, 7: { total: 0, totalPages, genres: [], hasMore }, 8: loading };
        return [Object.hasOwn(overrides, index) ? overrides[index] : initial, value => { if (index === 4) changed = value; }];
      },
      useRef: value => ({ current: value }), useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
    },
    r: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(Boolean) }) },
    _a: () => ({ sources: [{ id: source, label: source }], revision: 0, loading: false, error: '' }),
    co() {}, clearTimeout() {}, Set, Map, Vn: new Map(),
    document: { querySelector: () => ({ scrollTo() {} }) },
  };
  for (const match of component.matchAll(/r\.createElement\(([A-Za-z_$][\w$]*),/g)) context[match[1]] ||= () => null;
  vm.runInNewContext(component + '\nresult=nv({});', context);
  function find(node, predicate, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (predicate(node)) out.push(node);
    for (const child of node.children || []) find(child, predicate, out);
    return out;
  }
  return { pagers: find(context.result, node => node.props.className === 'browse-pager'),
    buttons: label => find(context.result, node => node.type === 'button' && node.props['aria-label'] === label),
    page: () => changed };
}
const first = render();
assert.equal(first.pagers.length, 2, 'Hongguo has cursor controls above and below results');
assert.ok(first.buttons('Previous page').every(b => b.props.disabled));
assert.ok(first.buttons('Next page').every(b => !b.props.disabled));
first.buttons('Next page')[0].props.onClick(); assert.equal(first.page(), 2, 'Hongguo can advance without totalPages');
const last = render({ page: 2, hasMore: false });
assert.ok(last.buttons('Next page').every(b => b.props.disabled));
assert.ok(last.buttons('Previous page').every(b => !b.props.disabled));
last.buttons('Previous page')[1].props.onClick(); assert.equal(last.page(), 1);
const busy = render({ loading: true });
assert.ok([...busy.buttons('Next page'), ...busy.buttons('Previous page')].every(b => b.props.disabled));
const numbered = render({ page: 2, totalPages: 3, hasMore: false });
numbered.buttons('Next page')[0].props.onClick(); assert.equal(numbered.page(), 3, 'known page counts remain supported');
const other = render({ source: 'xifan' });
other.buttons('Next page')[0].props.onClick(); assert.equal(other.page(), 2, 'other cursor providers retain pagination');
assert.equal(render({ hasMore: false }).pagers.length, 0, 'single-page lists have no misleading next-page action');
console.log('PASS Hongguo Browse pagination: cursor next/previous, top/bottom controls, last page, loading, and numbered/other-provider feeds');

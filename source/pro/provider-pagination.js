// Continue the existing provider catalogs; titles keep their episode/download identities.
(() => {
  const models = new Map(), generations = new Map();
  const grids = { home: 'gridLatest', discover: 'gridDiscover', search: 'gridSearch' };
  const identity = (item, platform) => `${item.platform || platform}:${String(item.id)}`;
  function items(json) {
    const data = json.data;
    const list = Array.isArray(data) ? data : Object.values(data || {}).filter(Array.isArray).flat();
    return list.filter(item => item && typeof item === 'object' && item.id != null);
  }
  function bar(view, top) {
    const id = `providerMore-${view}${top ? '-top' : ''}`;
    let node = document.getElementById(id);
    if (node) return node;
    const grid = document.getElementById(top && view === 'home' ? 'gridPopular' : grids[view]);
    if (!grid) return null;
    node = document.createElement('div'); node.id = id; node.className = 'provider-more';
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-primary';
    button.onclick = () => loadMore(view);
    node.append(status, button);
    if (top) grid.before(node); else grid.after(node);
    return node;
  }
  function paint(view) {
    const model = models.get(view);
    for (const node of [bar(view, true), bar(view, false)]) {
      if (!node) continue;
      node.hidden = !model;
      if (!model) continue;
      const [status, button] = node.children;
      status.textContent = model.message || `${model.list.length} titles loaded`;
      button.hidden = !model.more;
      button.disabled = model.loading;
      button.textContent = model.loading ? 'Loading more videos…' : 'Load more videos';
    }
  }
  function render(view, model) {
    if (view === 'home') {
      state.homeDramas = model.list;
      DOM.sectionCountPopular.textContent = `${model.list.length} Dramas`;
      renderDramaGrid(DOM.gridPopular, model.list.slice(0, 12));
      renderDramaGrid(DOM.gridLatest, model.list.slice(12));
    } else if (view === 'discover') {
      state.discoverDramas = model.list;
      renderDramaGrid(DOM.gridDiscover, model.list);
    } else {
      state.searchResults = model.list;
      DOM.searchResultCountText.textContent = `Found ${model.list.length} dramas for "${model.query}"`;
      renderDramaGrid(DOM.gridSearch, model.list);
    }
  }
  async function loadMore(view) {
    const model = models.get(view);
    if (!model || model.loading || !model.more) return;
    const current = () => models.get(view) === model && generations.get(view) === model.generation &&
      model.platform === state.currentPlatform && model.lang === state.currentLang;
    model.loading = true; model.message = ''; paint(view);
    const added = [];
    try {
      // Home is a fixed featured feed. Discover is the provider's paginated catalog.
      // Skip a few overlapping pages without issuing an unbounded background crawl.
      for (let attempt = 0; attempt < 3 && !added.length && model.more; attempt++) {
        const params = new URLSearchParams({ category_p: model.platform, lang: model.lang, page: String(model.nextPage) });
        if (model.query) params.set('q', model.query);
        const json = await (await fetch(`/api/${model.route}?${params}`)).json();
        if (!current()) return;
        if (!json.success) throw new Error(json.error || json.message || 'Could not load more videos. Please retry.');
        if (!Array.isArray(json.data) && (!json.data || typeof json.data !== 'object')) throw new Error('The provider returned an invalid catalog page. Please retry.');
        const pageItems = items(json);
        const fingerprint = [...new Set(pageItems.map(item => identity(item, model.platform)))].sort().join('|');
        if (!pageItems.length || model.fingerprints.has(fingerprint)) {
          model.more = false;
          model.message = `${model.list.length} titles loaded · No more new videos returned for this platform.`;
          break;
        }
        model.fingerprints.add(fingerprint);
        const seen = new Set(model.list.map(item => identity(item, model.platform)));
        for (const item of pageItems) {
          const key = identity(item, model.platform);
          if (!seen.has(key)) { seen.add(key); model.list.push(item); added.push(item); }
        }
        model.nextPage++;
        // Several providers return hasMore:false even when the next page has new titles.
        // Let an explicit user click check the next page; stop on empty/repeated results.
      }
      render(view, model);
      if (!added.length && model.more) model.message = `${model.list.length} titles loaded · These pages contained titles already shown. Load more to continue checking.`;
      if (added.length) {
        const targets = view === 'home' ? [DOM.gridPopular, DOM.gridLatest] : [view === 'discover' ? DOM.gridDiscover : DOM.gridSearch];
        for (const grid of targets) {
          const first = [...(grid.querySelectorAll?.('[data-provider-title]') || [])].find(card => card.dataset.providerTitle === String(added[0].id));
          if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
        }
      }
    } catch (error) {
      if (current()) model.message = `${model.list.length} titles kept. ${error.message || 'Could not load more videos. Please retry.'}`;
    } finally {
      if (current()) { model.loading = false; paint(view); }
    }
  }
  globalThis.amaraProviderPages = {
    begin(view) {
      generations.set(view, (generations.get(view) || 0) + 1);
      models.delete(view); paint(view);
    },
    invalidate() { for (const view of Object.keys(grids)) this.begin(view); },
    received(view, json, list, query = '') {
      const valid = list.filter(item => item && item.id != null);
      const fingerprints = new Set();
      if (view !== 'home' && valid.length) fingerprints.add([...new Set(valid.map(item => identity(item, state.currentPlatform)))].sort().join('|'));
      models.set(view, { platform: state.currentPlatform, lang: state.currentLang, query,
        generation: generations.get(view), list: [...valid], route: view === 'home' ? 'discover' : view,
        nextPage: view === 'home' ? 1 : (Number(json.page || json.pagination?.page) || 1) + 1,
        more: view === 'home' || valid.length > 0, fingerprints, loading: false, message: '' });
      paint(view);
    },
    loadMore,
  };
})();

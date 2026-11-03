(() => {
  const api = window.mediaBrowser, $ = id => document.getElementById(id);
  let state, albumKey = '', selected = new Set(), titleDirty = false, queueKey = '', filter = 'all', hydrated = false, page = 0, sourceFilter = 'all', changingConcurrency = false;
  const pageSize = 100;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  async function call(command, payload) {
    try { const result = await api.call(command, payload); if (result?.error) $('notice').textContent = result.error; return result; }
    catch (error) { $('notice').textContent = error.message; }
  }
  function setTab(tab) {
    for (const name of ['collection','queue']) { $('tab-' + name).setAttribute('aria-selected', String(tab === name)); $('tab-' + name).tabIndex = tab === name ? 0 : -1; $(name + '-panel').hidden = tab !== name; }
  }
  function selection() {
    $('download').disabled = !selected.size;
    $('download').textContent = selected.size ? `\u2193 Download ${selected.size} episode${selected.size === 1 ? '' : 's'} + poster` : '\u2193 Select episodes to download';
    $('selection-hint').textContent = selected.size ? `${selected.size} selected \u00b7 one organized album folder` : 'Your collection stays organized automatically.';
  }
  function renderQueue(tasks) {
    $('tasks').replaceChildren();
    const active = t => ['queued','resolving','downloading','retrying'].includes(t.status);
    const visible = [...tasks].filter(task => {
      if (sourceFilter === 'all') return true;
      if (sourceFilter === 'hongguo') return task.source === 'hongguo';
      if (sourceFilter === 'catalog') return task.catalog || task.source === 'catalog';
      return task.source !== 'hongguo';
    }).filter(task => filter === 'all' || (filter === 'active' ? active(task) : (filter === 'failed' ? ['failed','unavailable'].includes(task.status) : task.status === filter)));
    const priority = { downloading:0, resolving:0, failed:1, unavailable:1, retrying:2, queued:2, stopped:3, completed:4 };
    visible.sort((a,b) => {
      const pDiff = (priority[a.status] ?? 5) - (priority[b.status] ?? 5);
      if (pDiff !== 0) return pDiff;
      const timeA = a.createdAt || a.startTime || 0;
      const timeB = b.createdAt || b.startTime || 0;
      if (timeA && timeB && timeA !== timeB) return timeB - timeA;
      if (a.source !== 'hongguo' && b.source === 'hongguo') return -1;
      if (a.source === 'hongguo' && b.source !== 'hongguo') return 1;
      return 0;
    });
    page = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
    $('queue-page').textContent = `${visible.length} episodes \u00b7 Page ${page + 1} / ${Math.max(1, Math.ceil(visible.length / pageSize))}`;
    $('queue-previous').disabled = page === 0;
    $('queue-next').disabled = (page + 1) * pageSize >= visible.length;
    const fragment = document.createDocumentFragment();
    visible.slice(page * pageSize, (page + 1) * pageSize).forEach(task => {
      const row = text('div', '', 'task'); row.dataset.status = task.status;
      row.append(text('div', task.title, 'task-title'));
      if (task.filename) row.append(text('div', task.filename, 'task-filename'));
      const platformLabel = task.catalog?.platform ? `Catalog · ${task.catalog.platform}` : (task.source === 'hongguo' ? 'Hongguo' : task.catalog ? 'Catalog' : 'Browser');
      row.append(text('div', platformLabel, 'task-meta'));
      const meta = text('div', '', 'task-meta');
      const label = { resolving:task.resolveAttempt > 1 ? 'Finding video (retry)' : 'Finding video', downloading:'Downloading', queued:'In queue', retrying:'Retrying automatically', unavailable:'Unavailable at source', completed:'Completed', failed:'Needs attention', stopped:'Stopped' }[task.status] || task.status;
      meta.append(text('span', label + (task.bytes ? ` \u00b7 ${(task.bytes / 1048576).toFixed(1)} MB` : '') + (task.speedBps > 0 && task.status === 'downloading' ? ` \u00b7 ${(task.speedBps / 1048576).toFixed(2)} MB/s` : '') + (task.time ? ` \u00b7 video ${task.time}` : ''), 'status-' + task.status));
      if (task.status === 'completed') {
        const play = text('button', 'Play \u2197', 'text-button'); play.title = 'Open video file'; play.onclick = () => call('open-file', task.id); meta.append(play);
      }
      const folder = text('button', 'Folder \u2197', 'text-button'); folder.onclick = () => call('open-folder', task.id); meta.append(folder);
      if (task.status === 'completed') {
        const remove = text('button', 'Remove', 'text-button'); remove.title = 'Remove this entry from the download list. Saved files are kept.'; remove.onclick = () => call('remove', task.id); meta.append(remove);
        if (task.catalog) {
          const removeTitle = text('button', 'Remove title', 'text-button'); removeTitle.title = 'Remove all entries for this drama. Saved files are kept.'; removeTitle.onclick = () => call('remove-title', task.id); meta.append(removeTitle);
        }
      }
      row.append(meta);
      if (task.totalBytes > 0 && task.status === 'downloading') {
        const progress = document.createElement('progress'); progress.max = task.totalBytes; progress.value = task.bytes || 0;
        progress.setAttribute('aria-label', 'Download progress'); row.append(progress);
        row.append(text('div', `${Math.min(100, Math.floor((task.bytes || 0) / task.totalBytes * 100))}% \u00b7 ${(task.totalBytes / 1048576).toFixed(1)} MB total`, 'task-meta'));
      }
      if (task.posterStatus === 'saved') row.append(text('div', 'Poster included', 'task-poster-status'));
      if (task.posterStatus === 'saving') row.append(text('div', 'Saving movie poster…', 'task-poster-status'));
      if (task.posterStatus === 'failed') {
        const retryPoster = text('button', '↻ Retry poster', 'text-button'); retryPoster.onclick = () => call('catalog-poster', task.id); row.append(retryPoster);
      }
      if (task.status === 'downloading' && task.method) row.append(text('div', task.verifying ? 'Checking video file' : ({ parallel:`${task.connections || 4} connections`, hls:'HLS stream', direct:'Direct video', connecting:'Connecting to video', finishing:'Finishing MP4' }[task.method] || ''), 'task-meta'));
      if (['resolving','downloading'].includes(task.status) && !task.totalBytes) row.append(text('div', '', 'task-activity'));
      if (['failed','unavailable'].includes(task.status) && task.error) row.append(text('div', /internal server error|video refused to load|request is.*cursed/i.test(task.error) ? 'This title is unavailable from the provider right now. Please retry later.' : task.error, 'task-error'));
      if (['failed','stopped','unavailable'].includes(task.status)) {
        const actions = text('div', '', 'task-meta');
        const open = text('button', 'Open episode \u2197', 'text-button'); open.onclick = () => call('go', task.pageUrl || task.url);
        const retry = text('button', task.status === 'unavailable' ? 'Check source again' : '\u21bb Retry episode', 'text-button'); retry.onclick = () => call('retry', task.id);
        if (task.source !== 'hongguo' && !task.catalog) actions.append(open);
        actions.append(retry);
        const remove = text('button', 'Remove', 'text-button');
        remove.title = 'Remove this entry from the download list. Saved files are kept.';
        remove.onclick = () => call('remove', task.id); actions.append(remove);
        if (task.catalog) {
          const removeTitle = text('button', 'Remove title', 'text-button');
          removeTitle.title = 'Remove failed, stopped and unavailable entries for this title. Completed downloads and saved files are kept.';
          removeTitle.onclick = () => call('remove-title', task.id); actions.append(removeTitle);
        }
        row.append(actions);
      }
      fragment.append(row);
    });
    $('tasks').append(fragment);
    if (!visible.length) { const empty = text('div', '', 'empty'); empty.append(text('b', tasks.length ? 'All clear here.' : 'Ready for your next story.'), text('span', tasks.length ? 'No downloads match this filter.' : 'Collect an album and select episodes to start downloading.')); $('tasks').append(empty); }
  }
  function render(next) {
    state = next;
    if (state.workspaceMode) {
      document.body.classList.add('unified-embedded');
      document.body.classList.toggle('queue-workspace', state.workspaceMode === 'downloads');
      if (state.workspaceMode === 'downloads') setTab('queue');
    }
    if (!hydrated) { hydrated = true; if (state.tasks.length) setTab('queue'); }
    if (!changingConcurrency) for (const id of ['concurrency', 'queue-concurrency']) $(id).value = String(state.concurrency || 3);
    if (document.activeElement !== $('address')) $('address').value = state.url;
    $('web-title').textContent = state.title || 'Your next story starts here';
    $('web-title').title = state.title || '';
    $('notice').textContent = state.message;
    if (state.workspaceMode === 'downloads' && state.message === 'Open an album, then collect its episodes.') $('notice').textContent = 'Downloads continue while you explore. Filter the queue, open a folder, or retry an episode below.';
    $('collect').disabled = state.busy; $('collect').textContent = state.busy ? 'Collecting\u2026' : '\uff0b Collect album';
    $('folder').textContent = state.folder; $('folder').title = state.folder;
    $('detected').textContent = state.detected ? `\u00b7 ${state.detected} detected` : '';
    const album = state.album, key = JSON.stringify(album && [album.url, album.episodes, album.poster]);
    if (key !== albumKey) {
      const isNewAlbum = album?.url !== (albumKey ? JSON.parse(albumKey)?.[0] : undefined);
      albumKey = key; selected = new Set((album?.episodes || []).map((_ep, i) => i));
      if (!titleDirty || isNewAlbum) { $('album-title').value = album?.title || ''; titleDirty = false; }
      $('poster').hidden = !album?.poster; $('poster-empty').hidden = !!album?.poster;
      if (album?.poster) $('poster').src = album.poster;
      $('album-count').textContent = album ? `${album.episodes.length} episodes \u00b7 ${album.poster ? 'Poster included' : 'No poster found'}` : 'Collect an album to get started';
      $('episode-count').textContent = album?.episodes.length || 0;
      $('episodes').replaceChildren();
      (album?.episodes || []).forEach((episode, index) => {
        const row = text('div', '', 'episode'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.id = 'ep-' + index;
        check.onchange = () => { if (check.checked) selected.add(index); else selected.delete(index); selection(); };
        const label = text('label', episode.title); label.htmlFor = check.id; label.title = episode.url;
        const open = text('button', 'Open \u2197'); open.onclick = () => call('go', episode.pageUrl || episode.url);
        row.append(check, label, open); $('episodes').append(row);
      });
      if (!album?.episodes.length) { const empty = text('div', '', 'empty'); empty.append(text('b', 'A whole series, in one place.'), text('span', 'Open a movie\u2019s episode list and click Collect album.')); $('episodes').append(empty); }
      selection();
    }
    $('queue-count').textContent = state.tasks.length;
    $('active-count').textContent = state.tasks.filter(t => ['resolving','downloading'].includes(t.status)).length;
    $('native-speed').textContent = state.nativeConcurrency ? `Hongguo: ${state.nativeConcurrency} parallel episodes` : '';
    const catalogActive = state.tasks.filter(t => t.source !== 'hongguo' && ['resolving','downloading'].includes(t.status)).length;
    $('queued-summary').textContent = `${catalogActive} / ${state.concurrency || 3} catalog / browser videos active \u00b7 ${state.tasks.filter(t => t.status === 'queued').length} queued \u00b7 ${(state.tasks.filter(t => t.status === 'downloading').reduce((sum, task) => sum + (task.speedBps || 0), 0) / 1048576).toFixed(2)} MB/s total`;
    $('complete-count').textContent = state.tasks.filter(t => t.status === 'completed').length;
    $('attention-count').textContent = state.tasks.filter(t => ['failed','stopped','unavailable'].includes(t.status)).length;
    const keyQueue = JSON.stringify([state.tasks, filter, sourceFilter, page]); if (keyQueue !== queueKey) { queueKey = keyQueue; renderQueue(state.tasks); }
  }
  $('address-form').onsubmit = e => { e.preventDefault(); call('go', $('address').value); };
  for (const id of ['back','forward','reload','collect','capture','retry','stop','clear-completed','clear-all']) if ($(id)) $(id).onclick = () => call(id);
  $('collect').onclick = async () => { const result = await call('collect'); if (result?.success) setTab('collection'); };
  document.querySelectorAll('[data-url]').forEach(button => button.onclick = () => call('go', button.dataset.url));
  $('choose-folder').onclick = () => call('folder'); $('save-poster').onclick = () => call('poster', { title: $('album-title').value });
  $('album-title').oninput = () => { titleDirty = true; };
  $('select-all').onclick = () => { selected = new Set((state.album?.episodes || []).map((_ep, i) => i)); document.querySelectorAll('.episode input').forEach(el => { el.checked = true; }); selection(); };
  $('select-none').onclick = () => { selected.clear(); document.querySelectorAll('.episode input').forEach(el => { el.checked = false; }); selection(); };
  $('download').onclick = async () => { const result = await call('queue', { title: $('album-title').value, indices: [...selected], concurrency: $('concurrency').value }); if (result?.success) setTab('queue'); };
  for (const id of ['concurrency', 'queue-concurrency']) $(id).onchange = async event => {
    changingConcurrency = true;
    for (const control of ['concurrency', 'queue-concurrency']) $(control).disabled = true;
    try {
      const result = await call('concurrency', Number(event.target.value));
      if (result?.success && state) state = { ...state, concurrency: result.concurrency };
    } finally {
      changingConcurrency = false;
      for (const control of ['concurrency', 'queue-concurrency']) $(control).disabled = false;
      if (state) render(state);
    }
  };
  $('poster').onerror = () => { $('poster').hidden = true; $('poster-empty').hidden = false; };
  for (const name of ['collection','queue']) $('tab-' + name).onclick = () => setTab(name);
  document.querySelector('.panel-tabs').onkeydown = e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); const tab = $('tab-collection').getAttribute('aria-selected') === 'true' ? 'queue' : 'collection'; setTab(tab); $('tab-' + tab).focus(); } };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; page = 0; document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('active', el === button)); if (state) render(state); });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); $('address').focus(); $('address').select(); } });
  $('queue-previous').onclick = () => { page--; render(state); };
  $('queue-next').onclick = () => { page++; render(state); };
  $('queue-source').onchange = () => { sourceFilter = $('queue-source').value; page = 0; render(state); };
  $('native-manager').onclick = () => call('native-manager');
  $('native-settings').onclick = () => call('native-settings');
  let layoutScheduled = false;
  function layout() { if (layoutScheduled) return; layoutScheduled = true; requestAnimationFrame(() => { layoutScheduled = false; const rect = document.querySelector('.browser-placeholder').getBoundingClientRect(); call('layout', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); }); }
  new ResizeObserver(layout).observe(document.querySelector('.browser-placeholder')); window.addEventListener('resize', layout); layout();
  setTab('collection'); api.onState(render); call('state').then(result => { if (result?.tasks) render(result); });
})();

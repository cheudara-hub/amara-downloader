// Deterministic desktop verification uses a separate profile and no real downloads.
const { Readable } = require('node:stream');
const fixture = { id: 'amara-preview', title: 'A Story Worth Keeping', cover: 'https://covers.example/preview.heic', chapters: 3, synopsis: 'A fresh start, an unexpected meeting, and a story to make your own.', author: 'DramaBox', tags: ['Romance', 'Drama'] };
exports.gatewayOptions = { transport: async url => {
  if (new URL(url).hostname === 'covers.example') {
    const fs = require('node:fs'), path = require('node:path');
    const cover = [path.join(require('electron').app.getPath('userData'), '../cover.jpg'), path.resolve(process.resourcesPath || '', '../../artifacts/melolo-original.heic'), path.resolve(__dirname, '../../artifacts/melolo-original.heic')].find(p => fs.existsSync(p));
    if (!cover) throw new Error('Smoke-test cover fixture is missing');
    return { status: 200, headers: { 'content-type': cover.endsWith('.jpg') ? 'image/jpeg' : 'image/heic' }, data: Readable.from([fs.readFileSync(cover)]) };
  }
  const route = new URL(url).pathname.split('/').pop();
  const data = route === 'categories' ? [{ name: 'dramabox', display_name: 'DramaBox' }, { name: 'melolo', display_name: 'Melolo' }]
    : route === 'detail' ? { ...fixture, chapters: [1, 2, 3].map(index => ({ id: String(index), index })) }
    : route === 'popular-search' ? [{ title: 'Romance', query: 'romance' }]
    : route === 'video' ? { streams: [] } : [fixture];
  return { status: 200, headers: {}, data: Readable.from([Buffer.from(JSON.stringify({ success: true, data }))]) };
}};
exports.check = async (win, mediaBrowser, workspace) => {
  const warnings = [];
  process.on('warning', warning => { warnings.push(warning.name); console.warn(warning.stack); });
  const { app } = require('electron');
  const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
  const output = path.resolve(app.getPath('userData'), '..');
  fs.mkdirSync(output, { recursive: true });
  try { fs.unlinkSync(path.join(output, 'checks.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  const run = async script => {
    try { return await win.webContents.executeJavaScript(script); }
    catch (error) { throw new Error(`Desktop check failed: ${script.slice(0, 180)}: ${error.message}`); }
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const captures = [];
  async function frame(contents) {
    let failure;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { const capture = await contents.capturePage(); if (!capture.isEmpty()) return capture.toPNG(); }
      catch (error) { failure = error; }
      await wait(150);
    }
    throw failure || new Error('Renderer did not produce a capture frame');
  }
  async function capture(name) {
    win.show(); win.focus(); await wait(150);
    const base = name + '.png';
    fs.writeFileSync(path.join(output, base), await frame(win.webContents));
    const layers = [];
    for (const [index, view] of win.getBrowserViews().entries()) {
      const file = `${name}-layer-${index}.png`;
      fs.writeFileSync(path.join(output, file), await frame(view.webContents));
      layers.push({ file, ...view.getBounds() });
    }
    captures.push({ base, layers });
    fs.writeFileSync(path.join(output, 'captures.json'), JSON.stringify(captures, null, 2));
  }
  let sampleServer;
  try {
    win.show();
    for (let index = 0; index < 100; index++) { if (await run('document.querySelectorAll(".drama-card").length > 0').catch(() => false)) break; await wait(100); }
    const initial = await run('({cards:document.querySelectorAll(".drama-card").length,platforms:document.querySelectorAll(".platform-pill").length,desktop:!!window.amaraDesktop,overflow:document.documentElement.scrollWidth>innerWidth})');
    assert.equal(initial.platforms, 2); assert.ok(initial.cards); assert.ok(initial.desktop); assert.equal(initial.overflow, false);
    await run('document.getElementById("btnCloseVipModal")?.click(); state.watchlist=[]; state.history=[]; document.fonts.ready'); await wait(500);
    for (let index = 0; index < 100; index++) {
      if (await run('!!document.querySelector(".card-poster")?.naturalWidth')) break;
      await wait(100);
    }
    const cover = await run('({width:document.querySelector(".card-poster").naturalWidth,src:document.querySelector(".card-poster").src,fallback:!!document.querySelector(".card-poster").dataset.fallback})');
    assert.ok(cover.width > 0); assert.equal(cover.fallback, false); assert.ok(cover.src.includes('/api/image?url='));
    await capture('Home');
    const originalTaskCount = mediaBrowser.stateForCheck().tasks.length;
    const markDirectory = path.join(app.getPath('userData'), 'downloads/Amara', fixture.title + ' [dramabox-' + fixture.id + ']');
    fs.mkdirSync(markDirectory, { recursive: true });
    const markFiles = [1, 2, 3].map(index => path.join(markDirectory, `Episode ${String(index).padStart(3, '0')}.mp4`));
    for (const file of markFiles) fs.copyFileSync(path.join(output, 'episode-1-sample.mp4'), file);
    await mediaBrowser.queueCatalog({ platform: 'dramabox', dramaId: fixture.id, title: fixture.title, episodes: [1, 2, 3].map(index => ({ id: String(index), index })) });
    for (let index = 0; index < 100; index++) {
      if (mediaBrowser.stateForCheck().tasks.filter(task => task.catalog?.dramaId === fixture.id && task.status === 'completed').length === 3) break;
      await wait(100);
    }
    const marked = mediaBrowser.stateForCheck().tasks.filter(task => task.catalog?.dramaId === fixture.id);
    await run('amaraDownloads.refresh()');
    assert.equal(await run('document.querySelector(".downloaded-badge").textContent'), '\u2713 Downloaded');
    await capture('Downloaded-green-mark');
    await run('openDramaDetail(state.homeDramas[0])');
    assert.equal(await run('document.querySelectorAll("#episodesGrid .episode-downloaded").length'), 3);
    await run('downloadEpisode(state.currentDrama,1,"1")');
    assert.equal(mediaBrowser.stateForCheck().tasks.length, originalTaskCount + marked.length, 'Clicking a saved episode does not queue a duplicate');
    await run('openBatchModal(state.currentDrama,state.currentEpisodes,3); startBatchDownload()');
    assert.equal(mediaBrowser.stateForCheck().tasks.length, originalTaskCount + marked.length, 'A completed batch does not queue duplicate episodes');
    await capture('Downloaded-episodes');
    fs.unlinkSync(markFiles[2]);
    await run('amaraDownloads.refresh()');
    assert.equal(await run('document.querySelector(".downloaded-badge").textContent'), '\u2713 2/3 downloaded');
    for (const file of markFiles.slice(0, 2)) fs.unlinkSync(file);
    await run('amaraDownloads.refresh()');
    assert.equal(await run('document.querySelectorAll(".downloaded-badge").length'), 0);
    await mediaBrowser.clearCompleted();
    await run('closeDetailModal()');
    await run('openDramaDetail(state.homeDramas[0])');
    assert.equal(await run('document.querySelectorAll("#episodesGrid .episode-btn").length'), 3);
    win.setSize(960, 760); await wait(250);
    const detailFit = await run('({fits:DOM.modalDetailOverlay.querySelector(".modal-container").scrollWidth<=DOM.modalDetailOverlay.querySelector(".modal-container").clientWidth,buttons:[...document.querySelectorAll(".detail-actions button")].map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,label:button.getAttribute("aria-label")}))})');
    assert.ok(detailFit.fits); assert.equal(detailFit.buttons.length, 4);
    assert.ok(detailFit.buttons.every(button => button.width === 40 && button.height === 40 && button.label));
    await capture('Detail-compact-icons');
    win.setSize(1400, 940); await wait(150);
    await run('openBatchModal(state.currentDrama,state.currentEpisodes,3)');
    assert.equal(await run('DOM.batchEndEp.value'), '3');
    await wait(400);
    fs.writeFileSync(path.join(output, 'Episodes-and-batch.png'), (await win.webContents.capturePage()).toPNG());
    await run('closeBatchModal(); closeDetailModal(); toggleBookmark(state.homeDramas[0]); document.getElementById("navWatchlist").click()');
    assert.equal(await run('document.querySelectorAll("#gridWatchlist .drama-card").length'), 1);
    await run('saveHistory(state.homeDramas[0],2); document.getElementById("pillHistory").click()');
    assert.equal(await run('state.history[0].lastEpisode'), 2);
    await run('document.getElementById("navSearch").click(); performSearch("story")');
    assert.equal(await run('document.querySelectorAll("#gridSearch .drama-card").length'), 1);
    await run('document.getElementById("navDiscover").click()'); await wait(200);
    assert.equal(await run('document.querySelectorAll("#gridDiscover .drama-card").length'), 1);
    await run('document.getElementById("navHome").click()');
    win.setSize(960, 760); await wait(250);
    assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
    fs.writeFileSync(path.join(output, 'Home-compact.png'), (await win.webContents.capturePage()).toPNG());
    await run('openDramaPlayer(state.homeDramas[0],1,"1")');
    assert.equal(await run('DOM.mainVideoPlayer.getAttribute("src")'), null, 'Unavailable video must not play a demo or stale stream');
    await run('closePlayer()');
    const invalid = await run('amaraDesktop.call("queue",{}).then(()=>false,()=>true)'); assert.ok(invalid);
    const sample = [path.join(output, 'episode-1-sample.mp4'), path.resolve(process.resourcesPath || '', '../../artifacts/browser-debug/episode-1-sample.mp4'), path.resolve(__dirname, '../../artifacts/browser-debug/episode-1-sample.mp4')].find(p => fs.existsSync(p));
    assert.ok(sample && fs.existsSync(sample));
    sampleServer = require('node:http').createServer((_req, res) => {
      if (_req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>AMARA Browser verification</title><h1>One AMARA workspace</h1>'); return; }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(sample).size });
      fs.createReadStream(sample).pipe(res);
    });
    await new Promise(resolve => sampleServer.listen(0, '127.0.0.1', resolve));
    mediaBrowser.setCatalogResolver(async () => ({ url: `http://127.0.0.1:${sampleServer.address().port}/clip.mp4`, referer: 'https://amara.example/' }));
    mediaBrowser.setCatalogPreflight(async () => {});
    const queued = await run('amaraDesktop.call("queue", { platform:"dramabox",dramaId:"desktop-check",title:"Desktop download verification",cover:"https://covers.example/preview.heic",episodes:[{id:"1",index:1}] })');
    assert.equal(queued.success, true);
    assert.equal(queued.posterSaved, true);
    assert.equal(path.dirname(queued.posterFile), queued.directory);
    assert.ok(fs.readFileSync(queued.posterFile).subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')), 'Movie poster is saved as a compatible JPEG beside episodes');
    for (let index = 0; index < 100; index++) {
      if (mediaBrowser.stateForCheck().tasks.some(task => task.catalog?.dramaId === 'desktop-check' && task.status === 'completed')) break;
      await wait(200);
    }
    const task = mediaBrowser.stateForCheck().tasks.find(task => task.catalog?.dramaId === 'desktop-check');
    assert.equal(task.status, 'completed', task.error);
    assert.equal(task.posterStatus, 'saved');
    assert.ok(fs.statSync(path.join(task.directory, task.filename)).size > 0);
    const repeated = await run('amaraDesktop.call("queue", { platform:"dramabox",dramaId:"desktop-check",title:"Desktop download verification",episodes:[{id:"1",index:1}] })');
    assert.equal(repeated.count, 0, 'Repeated selection does not duplicate a completed episode');
    win.setSize(1400, 940);
    const { ipcMain } = require('electron');
    const browseRequests = [];
    ipcMain.removeHandler('browse-list');
    ipcMain.handle('browse-list', (_event, options = {}) => {
      const page = Number(options.page) || 1;
      browseRequests.push({ page, category: options.category });
      return { success: true, page, totalPages: 0, hasMore: page === 1, genres: [],
        results: [{ series_id: String(7700000000000000000n + BigInt(page)), series_title: 'Hongguo page ' + page, episode_count: 10, cover: '', tags: [] }] };
    });
    const unified = [];
    for (const [route, expectedPages] of [['hongguo',['Discover','Browse']],['library',['My library','My Library','Player']],['add',['Search & download','Search & Download','Add Downloads']],['settings',['Settings']],['transfers',['Downloads']]]) {
      await run(`amaraDesktop.call('navigate',{route:${JSON.stringify(route)}})`); await wait(350);
      if (route === 'hongguo') {
        const nativeRun = script => workspace.workspaceContents().executeJavaScript(script);
        const nativeFind = (selector, operation = '') => nativeRun('document.querySelector(' + JSON.stringify(selector) + ')' + operation);
        const nativeCount = selector => nativeRun('document.querySelectorAll(' + JSON.stringify(selector) + ').length');
        for (let attempt = 0; attempt < 60 && !(await nativeFind('.browse-pager')); attempt++) await wait(50);
        assert.equal(await nativeCount('.browse-pager'), 2);
        assert.equal(await nativeFind('[aria-label="Previous page"]', '.disabled'), true);
        await nativeFind('[aria-label="Next page"]', '.click()');
        for (let attempt = 0; attempt < 60 && !(await nativeFind('.browse-pager[data-catalog-page="2"]')); attempt++) await wait(50);
        assert.ok(browseRequests.some(request => request.page === 2), 'Hongguo next button requests the real second page');
        assert.equal(await nativeCount('.browse-pager[data-catalog-page="2"]'), 2);
        assert.equal(await nativeFind('[aria-label="Next page"]', '.disabled'), true);
        await capture('Hongguo-page-2');
        await nativeFind('[aria-label="Previous page"]', '.click()');
        for (let attempt = 0; attempt < 60 && !(await nativeFind('.browse-pager[data-catalog-page="1"]')); attempt++) await wait(50);
        assert.equal(await nativeCount('.browse-pager[data-catalog-page="1"]'), 2);
        assert.equal(await nativeRun('electronAPI.setAlwaysOnTop(true)'), true);
        assert.equal(await nativeRun('electronAPI.setAlwaysOnTop(false)'), false);
        assert.equal((await nativeRun('electronAPI.setWindowLayout("portrait")')).success, true);
        await nativeRun('electronAPI.setEpisodePanelOpen(true)');
        await nativeRun('electronAPI.setEpisodePanelOpen(false)');
        assert.equal((await nativeRun('electronAPI.setWindowLayout("landscape")')).success, true);
      }
      const native = await workspace.workspaceContents().executeJavaScript('({page:document.querySelector(".sidebar-item.active")?.textContent.trim(),embedded:document.body.classList.contains("unified-embedded"),sidebar:getComputedStyle(document.querySelector(".sidebar")).display,overflow:document.documentElement.scrollWidth>innerWidth})');
      assert.ok(expectedPages.includes(native.page), `Expected ${route} to be one of ${expectedPages}, got ${native.page}`); assert.ok(native.embedded); assert.equal(native.sidebar, 'none'); assert.equal(native.overflow, false);
      assert.equal(require('electron').BrowserWindow.getAllWindows().filter(window => window.isVisible()).length, 1, 'All pages use the same window');
      await capture('Unified-' + route);
      unified.push(route);
    }
    await run('amaraDesktop.call("navigate",{route:"downloads"})'); await wait(350);
    const downloadSurface = mediaBrowser.embeddedContents();
    assert.equal(await downloadSurface.executeJavaScript('document.body.classList.contains("queue-workspace")'), true);
    await capture('Unified-downloads');
    await run(`amaraDesktop.call('navigate',{route:'browser',input:'http://127.0.0.1:${sampleServer.address().port}/'})`); await wait(500);
    assert.equal(await downloadSurface.executeJavaScript('document.body.classList.contains("queue-workspace")'), false);
    assert.match(mediaBrowser.stateForCheck().title, /AMARA Browser verification/);
    assert.equal(require('electron').BrowserWindow.getAllWindows().filter(window => window.isVisible()).length, 1);
    await capture('Unified-browser');
    const browserRun = script => downloadSurface.executeJavaScript(script);
    const shortcutUrl = `http://127.0.0.1:${sampleServer.address().port}/?shortcut=1`;
    await browserRun(`document.getElementById('add-website').click();
      document.getElementById('shortcut-name').value='Review website';
      document.getElementById('shortcut-url').value='javascript:alert(1)';
      document.getElementById('shortcut-form').requestSubmit()`);
    assert.match(await browserRun('document.getElementById("shortcut-error").textContent'), /http or https/);
    await browserRun(`document.getElementById('shortcut-url').value=${JSON.stringify(shortcutUrl)};document.getElementById('shortcut-form').requestSubmit()`);
    assert.equal(await browserRun(`!![...document.querySelectorAll('#website-shortcuts button')].find(b=>b.dataset.url===${JSON.stringify(shortcutUrl)})`), true);
    await browserRun(`document.getElementById('shortcut-name').value='Duplicate';document.getElementById('shortcut-url').value=${JSON.stringify(shortcutUrl)};document.getElementById('shortcut-form').requestSubmit()`);
    assert.match(await browserRun('document.getElementById("shortcut-error").textContent'), /already/);
    await browserRun(`document.querySelector('[aria-label="Edit Review website"]').click();document.getElementById('shortcut-name').value='My website';document.getElementById('shortcut-form').requestSubmit()`);
    await capture('Website-shortcut-editor');
    downloadSurface.reload();
    for (let index = 0; index < 100; index++) {
      if (await browserRun('!!document.querySelector("#website-shortcuts button")').catch(() => false)) break;
      await wait(100);
    }
    assert.equal(await browserRun(`!!document.querySelector('[aria-label="Edit My website"]')`), true, 'Edited shortcut survives reload');
    await browserRun(`document.getElementById('add-website').click()`);
    win.setSize(960, 760); await wait(250);
    assert.equal(await browserRun('document.documentElement.scrollWidth<=innerWidth'), true);
    assert.equal(await browserRun('document.getElementById("shortcut-editor").getBoundingClientRect().right<=innerWidth'), true);
    await capture('Website-shortcuts-compact');
    await browserRun('document.getElementById("close-shortcut-editor").click()');
    await browserRun(`document.querySelector('#website-shortcuts button[data-url="${shortcutUrl}"]').click()`);
    for (let index = 0; index < 50 && !mediaBrowser.stateForCheck().url.includes('shortcut=1'); index++) await wait(100);
    assert.equal(mediaBrowser.stateForCheck().url, shortcutUrl, 'Saved website opens in the browser');
    await browserRun(`document.getElementById('add-website').click();document.querySelector('[aria-label="Remove My website"]').click()`);
    assert.equal(await browserRun(`!!document.querySelector('[aria-label="Remove My website"]')`), false);
    await browserRun('document.getElementById("close-shortcut-editor").click()');
    unified.push('Website shortcut add, edit, persist, open, remove, invalid URL, duplicate, compact layout');
    await browserRun('document.getElementById("add-website").click()');
    await run('amaraDesktop.call("navigate",{route:"home"})'); await wait(250);
    assert.equal(win.getBrowserViews().length, 0, 'Catalog restores without native views covering it');
    win.setSize(960, 760); await wait(250);
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true);
    await run('amaraDesktop.call("navigate",{route:"downloads"})'); await wait(250);
    assert.equal(await browserRun('document.body.classList.contains("shortcut-editing")'), false, 'Shortcut editor closes when switching to Downloads');
    assert.equal(await downloadSurface.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'), true);
    await capture('Unified-downloads-compact');
    unified.push('downloads','browser','return to catalog','compact downloads');
    await run('document.getElementById("amaraUpdates").click()'); await wait(300);
    assert.equal(win.getBrowserViews().length, 0, 'Updates detach native views before opening the dialog');
    assert.equal(await run('document.querySelector(".amara-update-dialog").open'), true);
    assert.ok(await run('document.querySelector("[data-app]").textContent.includes(amaraDesktop.version)'));
    assert.ok(await run('document.querySelector("[data-upstream]").textContent.includes("5.4")'));
    assert.equal(await run('document.querySelector("[data-action=app]").hidden'), true, 'No unverified installer is offered');
    await capture('AMARA-updates');
    await run('document.querySelector("[data-action=close]").click()');
    unified.push('Updates dialog, native view detach, version tracks, no unverified release');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(warnings.includes('MaxListenersExceededWarning'), false, 'Repeated navigation must release window owner listeners');
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ success: true, initial, cover: { width: cover.width, fallback: cover.fallback }, poster: { saved: queued.posterSaved, besideEpisodes: path.dirname(queued.posterFile) === queued.directory }, unified, checks: ['Cover rendered', 'Movie poster included with download', 'Home', 'Discover', 'Search', 'Saved list', 'Watch history', 'Episode details', 'Batch range', 'Compact layout', 'Unavailable playback', 'Invalid queue payload', 'Native MP4 download', 'Duplicate prevention'], errors }, null, 2));
  } finally { sampleServer?.closeAllConnections?.(); sampleServer?.close(); app.quit(); }
};

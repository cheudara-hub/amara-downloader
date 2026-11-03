// Explicit opt-in integration check: isolated settings, loopback fixtures, no website downloads.
module.exports = async function smoke(mediaBrowser) {
  const { app, BrowserWindow } = require('electron');
  const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
  const { execFileSync, spawn } = require('child_process');
  const { collectPage } = require('./media-page');
  const root = path.join(process.resourcesPath, '..', '..', 'artifacts', 'media-browser');
  const data = path.join(root, 'data'); fs.mkdirSync(data, { recursive: true });
  for (const suffix of ['', '.bak', '.tmp']) { try { fs.unlinkSync(path.join(data, 'media-browser.json' + suffix)); } catch {} }
  const sample = path.join(data, 'sample.mp4');
  execFileSync(path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=25', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample], { windowsHide: true });
  execFileSync(path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', sample, '-c', 'copy', '-hls_time', '1', '-hls_list_size', '0', path.join(data, 'sample.m3u8')], { windowsHide: true });
  const padding = Buffer.alloc(5 * 1024 * 1024);
  padding.writeUInt32BE(padding.length, 0); padding.write('free', 4, 'ascii');
  const largeVideo = Buffer.concat([fs.readFileSync(sample), padding]);
  let acceleratedRanges = 0, fallbackRequests = 0, retryRequests = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const server = http.createServer((req, res) => {
    if (req.url === '/large.mp4') {
      res.setHeader('Content-Type', 'video/mp4'); res.setHeader('ETag', '"large-sample"');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Number(range[2]) : largeVideo.length - 1;
        if (req.headers['if-range']) acceleratedRanges++;
        res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${largeVideo.length}`);
        res.setHeader('Content-Length', end - start + 1); res.end(largeVideo.subarray(start, end + 1));
      } else { res.setHeader('Content-Length', largeVideo.length); res.end(largeVideo); }
    }
    else if (req.url === '/embedded-player') {
      const options = JSON.stringify({ flashvars: { metadata: JSON.stringify({ hlsManifestUrl: `http://${req.headers.host}/sample.m3u8`, videos: [{ name: 'hd', url: `http://${req.headers.host}/stream?video=1` }] }) } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      res.setHeader('Content-Type', 'text/html'); res.end(`<title>Embedded player</title><div data-options="${options}"></div>`);
    }
    else if (req.url === '/embedded-player-fallback') {
      const options = JSON.stringify({ metadata: { hlsManifestUrl: `http://${req.headers.host}/sample.m3u8`, videos: [{ name: 'hd', url: `http://${req.headers.host}/unavailable.mp4` }] } }).replace(/"/g, '&quot;');
      res.setHeader('Content-Type', 'text/html'); res.end(`<title>Fallback player</title><div data-options="${options}"></div>`);
    }
    else if (req.url === '/unavailable.mp4') { fallbackRequests++; res.statusCode = 404; res.end('Unavailable source'); }
    else if (req.url === '/stream?video=1') {
      if (req.headers.referer !== `http://${req.headers.host}/embedded-player`) { res.statusCode = 403; return res.end('Wrong player referer'); }
      res.setHeader('Content-Type', 'video/mp4'); res.end(fs.readFileSync(sample));
    }
    else if (/^\/sample(?:\d+\.ts|\.m3u8)$/.test(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'); res.end(fs.readFileSync(path.join(data, req.url.slice(1)))); }
    else if (req.url.startsWith('/sample.mp4')) { res.setHeader('Content-Type', 'video/mp4'); res.end(fs.readFileSync(sample)); }
    else if (req.url === '/retry.mp4') { retryRequests++; if (retryRequests < 4) { res.statusCode = 503; res.end('Temporary failure'); } else { res.setHeader('Content-Type', 'video/mp4'); res.end(fs.readFileSync(sample)); } }
    else if (req.url === '/poster.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); }
    else if (req.url.startsWith('/episode/')) { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Sample episode</title>${req.url.endsWith('/5') ? '<video src="/retry.mp4"></video>' : req.url.endsWith('/6') ? '<video src="/sample.mp4"></video>' : req.url.endsWith('/4') ? '<iframe src="/embedded-player-fallback"></iframe>' : req.url.endsWith('/3') ? '<video controls src="/large.mp4"></video>' : req.url.endsWith('/2') ? '<video controls src="/sample.m3u8"></video>' : '<iframe src="/embedded-player"></iframe>'}`); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html><head><title>Sample album</title><meta property="og:image" content="/poster.png"></head><body style="background:#18233d;color:#eef3ff;font:20px Segoe UI;padding:60px"><p>AMARA · LOCAL TEST ALBUM</p><h1>The sample collection</h1><p>A local fixture for validating the album workflow.</p><div class="episodes"><a href="/episode/1">Episode 1</a><br><a href="/episode/2">Episode 2</a><br><a href="/episode/3">Episode 3</a><br><a href="/episode/4">Episode 4</a><br><a href="/episode/5">Episode 5</a><br><a href="/episode/6">Episode 6</a></div><p>Six episodes and one poster.</p></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let report = {};
  try {
    const duplicateEnv = { ...process.env }; delete duplicateEnv.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const duplicate = spawn(process.execPath, ['--media-browser-smoke-test'], { windowsHide: true, env: duplicateEnv, stdio: 'ignore' });
      const timer = setTimeout(() => { duplicate.kill(); reject(new Error('A second app instance did not exit')); }, 5000);
      duplicate.once('error', error => { clearTimeout(timer); reject(error); });
      duplicate.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Second app instance exit: ' + code)); });
    });
    mediaBrowser.open(address);
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'AMARA | Browser') || BrowserWindow.getAllWindows().at(-1);
    for (let i = 0; i < 60; i++) { if (await win.webContents.executeJavaScript('!!window.mediaBrowser').catch(() => false)) break; await wait(100); }
    const call = (command, payload) => win.webContents.executeJavaScript(`window.mediaBrowser.call(${JSON.stringify(command)},${JSON.stringify(payload)})`);
    for (const count of [6, 8]) {
      const changed = await call('concurrency', count);
      assert.equal(changed.concurrency, count);
      assert.equal((await call('state')).concurrency, count);
      assert.equal(await win.webContents.executeJavaScript(`document.getElementById('queue-concurrency').value`), String(count));
    }
    // Parse captured real markup inertly: no third-party scripts or ads execute.
    const capturedAlbum = path.resolve(process.resourcesPath, '../../../artifacts/luly-album-source.html');
    const capturedEpisode = path.resolve(process.resourcesPath, '../../../artifacts/luly-episode-01-source.html');
    if (fs.existsSync(capturedAlbum) && fs.existsSync(capturedEpisode)) {
      const parseCaptured = (file, url) => win.webContents.executeJavaScript(`(() => { const document = new DOMParser().parseFromString(${JSON.stringify(fs.readFileSync(file, 'utf8'))}, 'text/html'); const location = { href: ${JSON.stringify(url)} }; const performance = { getEntriesByType: () => [] }; return (${collectPage.toString()})(); })()`);
      const captured = await parseCaptured(capturedAlbum, 'https://luly.top/series/sis-chbong-kompul-lbech/');
      assert.equal(captured.episodes.length, 10);
      assert.deepEqual(captured.episodes.map(episode => episode.number), [1,2,3,4,5,6,7,8,9,10]);
      assert.ok(captured.poster.includes('Sis-Chbong-Kompul-Lbech1.jpg'));
      const episode = await parseCaptured(capturedEpisode, 'https://luly.top/sis-chbong-kompul-lbech-01/');
      assert.deepEqual(episode.episodes.map(item => item.number), [1,2,3,4,5,6,7,8,9,10]);
      assert.ok(episode.players.some(url => url.startsWith('https://s4.nizu.top/?id=')));
      console.log('PASS: real album markup collects 10 sorted episodes, poster, and primary player iframe');
    }
    const sampleTitle = 'AMARA integration sample ' + Date.now();
    await call('go', address);
    await wait(1200);
    await call('collect');
    let state = await call('state');
    assert.equal(state.album.episodes.length, 6); assert.equal(state.album.poster, address + '/poster.png');
    const unsafe = await call('go', 'file:///C:/Windows/win.ini'); assert.equal(unsafe.success, false);
    await call('go', address); await wait(600); await call('collect');
    const bridgeAbsent = await win.getBrowserView().webContents.executeJavaScript('typeof window.electronAPI === "undefined" && typeof window.mediaBrowser === "undefined"');
    assert.equal(bridgeAbsent, true);
    fs.writeFileSync(path.join(root, 'media-browser-preview.png'), (await win.webContents.capturePage()).toPNG());
    const layout = await win.webContents.executeJavaScript('JSON.stringify(document.querySelector(".browser-placeholder").getBoundingClientRect().toJSON())').then(JSON.parse);
    const bounds = win.getBrowserView().getBounds();
    assert.ok(Math.abs(bounds.x - layout.x) <= 1 && Math.abs(bounds.y - layout.y) <= 1, 'Website view must fit the redesigned browser panel');
    const existingDir = path.join(data, 'downloads', 'Amara', sampleTitle);
    fs.mkdirSync(existingDir, { recursive: true });
    fs.copyFileSync(sample, path.join(existingDir, 'Episode 006.mp4'));
    const queued = await call('queue', { title: sampleTitle, indices: [0, 1, 2, 3, 4, 5], concurrency: 2 });
    assert.equal(queued.success, true);
    let deadline = Date.now() + 45000;
    do { await wait(400); state = await call('state'); } while (Date.now() < deadline && state.tasks.some(t => ['queued', 'resolving', 'downloading', 'retrying'].includes(t.status)));
    assert.equal(state.tasks.length, 6); assert.ok(state.tasks.every(t => t.status === 'completed'), JSON.stringify(state.tasks));
    const directory = state.tasks[0].directory;
    for (const file of ['Episode 001.mp4', 'Episode 002.mp4', 'Episode 003.mp4', 'Episode 004.mp4', 'Episode 005.mp4', 'Episode 006.mp4', 'poster.png', 'album.json']) assert.ok(fs.existsSync(path.join(directory, file)), file);
    await call('queue', { title: sampleTitle, indices: [0, 1, 2, 3, 4, 5], concurrency: 2 });
    state = await call('state'); assert.equal(state.tasks.length, 6);
    await win.webContents.executeJavaScript('document.getElementById("tab-queue").click()');
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("queue-panel").hidden'), false);
    await win.webContents.executeJavaScript('document.querySelector("[data-filter=failed]").click()');
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".task").length'), 0);
    await win.webContents.executeJavaScript('document.querySelector("[data-filter=completed]").click()');
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".task").length'), 6);
    await wait(150);
    fs.writeFileSync(path.join(root, 'media-browser-downloads-preview.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(1120, 740); await wait(350);
    for (let i = 0; i < 25; i++) {
      const width = await win.webContents.executeJavaScript('document.querySelector(".browser-placeholder").getBoundingClientRect().width');
      if (Math.abs(win.getBrowserView().getBounds().width - width) <= 1) break;
      await wait(100);
    }
    const compactLayout = await win.webContents.executeJavaScript('JSON.stringify(document.querySelector(".browser-placeholder").getBoundingClientRect().toJSON())').then(JSON.parse);
    assert.ok(Math.abs(win.getBrowserView().getBounds().width - compactLayout.width) <= 1, 'Browser view follows compact layout');
    fs.writeFileSync(path.join(root, 'media-browser-compact-preview.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(acceleratedRanges, 4, 'Large MP4 must use four validated byte ranges');
    assert.ok(!fs.existsSync(path.join(directory, 'Episode 003.mp4.part.input')), 'Temporary range input must be cleaned up');
    assert.equal(state.tasks.find(task => task.filename === 'Episode 001.mp4').method, 'direct', 'Prefer direct video to available HLS');
    assert.equal(state.tasks.find(task => task.filename === 'Episode 004.mp4').method, 'hls', 'Fall back to HLS if direct video is unavailable');
    assert.ok(fallbackRequests > 0);
    assert.ok(state.tasks.find(task => task.filename === 'Episode 005.mp4').retryCount >= 1, 'Temporary network failures must recover without manual retry');
    assert.deepEqual(fs.readFileSync(path.join(directory, 'Episode 006.mp4')), fs.readFileSync(sample), 'Existing valid videos must be recovered without modification');
    const removalTasks = mediaBrowser.stateForCheck().tasks.filter(task => task.source !== 'hongguo').slice(0, 2);
    const keptVideo = fs.readFileSync(path.join(removalTasks[0].directory, removalTasks[0].filename));
    for (const task of removalTasks) {
      task.catalog = { platform: 'fixture', dramaId: 'remove-check', chapterId: task.id, lang: 'en' };
      task.status = 'unavailable'; task.error = 'Fixture unavailable';
    }
    mediaBrowser.refreshDownloads(); await wait(100);
    await win.webContents.executeJavaScript('document.querySelector("[data-filter=failed]").click()');
    assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].some(b=>b.textContent==="Remove title")'));
    const removed = await call('remove-title', removalTasks[0].id);
    assert.equal(removed.count, 2);
    assert.ok(!mediaBrowser.stateForCheck().tasks.some(task => removalTasks.some(old => old.id === task.id)));
    assert.deepEqual(fs.readFileSync(path.join(removalTasks[0].directory, removalTasks[0].filename)), keptVideo, 'Removing queue entries must keep the downloaded video');
    report = { success: true, episodes: 6, sixAndEightSpeedControlsVerified: true, singleInstanceVerified: true, automaticRetryVerified: true, existingFileRecoveryVerified: true, directVideoPreferred: true, hlsFallbackVerified: true, parallelVideoDownload: true, acceleratedRanges, mp4AndHlsDownloaded: true, embeddedMetadataAndExtensionlessVideo: true, playerRefererVerified: true, posterSaved: true, duplicateQueuePrevented: true, unsafeNavigationRejected: true, websiteBridgeAbsent: true, redesignedTabsAndFilters: true, browserResizeVerified: true, directory };
    report.queueRemovalVerified = true;
    const liveAlbum = process.argv.find(arg => arg.startsWith('--album-collect-check='))?.slice('--album-collect-check='.length);
    if (liveAlbum) {
      await call('go', liveAlbum);
      let collected;
      for (let attempt = 0; attempt < 20; attempt++) {
        await wait(1000); collected = await call('state');
        if (collected.url !== liveAlbum) continue;
        await call('collect'); collected = await call('state');
        if (collected.album?.url === liveAlbum && collected.album.episodes.length) break;
      }
      assert.equal(collected.album?.url, liveAlbum, `Live page did not become ready: ${collected.message}`);
      assert.ok(collected.album?.episodes.length, 'The live album must collect episodes');
      report.liveAlbum = { url: collected.album.url, title: collected.album.title, episodes: collected.album.episodes.map(episode => ({ number: episode.number, url: episode.url })), poster: collected.album.poster };
      fs.writeFileSync(path.join(root, 'album-collection-preview.png'), (await win.webContents.capturePage()).toPNG());
      console.log('Collected live album:', collected.album.episodes.length, 'episodes');
    }
    if (process.argv.includes('--media-browser-site-check')) {
      report.sites = [];
      for (const url of ['https://www.phumi7.net/album/1972', 'https://www.8khmer.com/2025/02/kom-heng-plerng-prey-ep05.html', 'https://www.phumikhmer.net/louk-chavhvay-chea-svamey-knhom/']) {
        await call('go', url); await wait(12000); await call('collect');
        const current = await call('state');
        const diagnostic = await win.getBrowserView().webContents.executeJavaScript('JSON.stringify({text:document.body.innerText.slice(0,1200),links:Array.from(document.querySelectorAll("a")).slice(0,80).map(a=>({text:a.textContent.trim().slice(0,80),url:a.href})),frames:Array.from(document.querySelectorAll("iframe")).map(f=>f.src)})').then(JSON.parse).catch(() => ({}));
        report.sites.push({ url, album: current.album, message: current.message, diagnostic });
        fs.writeFileSync(path.join(root, 'media-site-' + new URL(url).hostname + '.html'), await win.getBrowserView().webContents.executeJavaScript('document.documentElement.outerHTML'));
        fs.writeFileSync(path.join(root, 'media-site-' + new URL(url).hostname + '.png'), (await win.getBrowserView().webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(root, 'media-browser-check.json'), JSON.stringify(report, null, 2));
      }
    }
  } catch (error) { report.success = false; report.error = error.message; throw error; }
  finally {
    fs.writeFileSync(path.join(root, 'media-browser-check.json'), JSON.stringify(report, null, 2));
    server.close(); app.quit();
  }
};

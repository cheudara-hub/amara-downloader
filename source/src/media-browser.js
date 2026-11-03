const browserViews = require('./browser-views');
const { BrowserWindow, BrowserView, ipcMain, app, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const queueStorage = require('./queue-recovery');
const parallelDownload = require('./parallel-download');
const trackDownload = require('./download-progress');
const { groupKey, checkGroups } = require('./catalog-playback');
const { collectPage, safeName, webUrl, mediaSources } = require('./media-page');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const scanScript = `(${collectPage.toString()})()`;

module.exports = function installMediaBrowser({ getSettings, resolveFfmpeg, savePoster, saveConcurrency }) {
  let win, view, album = null, active = 0, concurrency = 3;
  let folder = '', message = 'Open an album, then collect its episodes.', busy = false;
  const tasks = [], children = new Map(), resolvers = new Map(), transfers = new Map(), observed = new Map();
  const activePaths = new Set();
  const normalizeConcurrency = value => Math.max(1, Math.min(8, Math.floor(Number(value) || 3)));
  let nativeQueue;
  let catalogResolver, catalogPreflight, catalogPosterSaver = savePoster, workspaceShell, uiView, uiContents, embedded = false, visible = false, topInset = 0, workspaceMode = 'browser';
  const stateFile = () => path.join(app.getPath('userData'), 'media-browser.json');
  function persist() {
    queueStorage.save(stateFile(), { folder, album, concurrency, tasks: tasks.map(({ child, ...task }) => task) });
  }
  function state() {
    return { workspaceMode: embedded ? workspaceMode : '', url: view?.webContents.getURL() || '', title: view?.webContents.getTitle() || '', album, tasks: nativeQueue ? [...nativeQueue.list(), ...tasks] : tasks, nativeConcurrency: nativeQueue?.concurrency(), folder: folder || getSettings().root || app.getPath('downloads'), message, busy, concurrency, detected: observed.get(view?.webContents.id)?.length || 0 };
  }
  function emit() { if ((!embedded || visible) && uiContents && !uiContents.isDestroyed()) uiContents.send('media-browser-state', state()); }
  function note(text) { message = text; emit(); }
  const partition = 'persist:amara-media';
  let initialized = false, closing = false;
  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const data = queueStorage.load(stateFile());
      folder = data.folder || ''; album = data.album || null;
      concurrency = normalizeConcurrency(getSettings().max_concurrent ?? data.concurrency);
      tasks.push(...queueStorage.restore(data.tasks));
    } catch {}
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.on('will-download', (event) => { event.preventDefault(); note('Use the album download button to save videos.'); });
    ses.webRequest.onResponseStarted(details => {
      const type = Object.entries(details.responseHeaders || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.join(';') || '';
      if (!/\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(details.url) && !/^(?:video\/(?:mp4|webm)|application\/(?:vnd\.apple\.mpegurl|x-mpegurl))/i.test(type)) return;
      const list = observed.get(details.webContentsId);
      if (list && !list.includes(details.url)) { list.push(details.url); if (list.length > 60) list.shift(); emit(); }
    });
    const retries = setInterval(() => {
      let due = false;
      for (const task of tasks) if (task.status === 'retrying' && task.retryAt <= Date.now()) { task.status = 'queued'; due = true; }
      if (due) pump();
    }, 1000);
    retries.unref();
    if (!process.argv.includes('--browser-probe')) setImmediate(pump);
    app.on('before-quit', () => {
      closing = true;
      clearInterval(retries);
      for (const controller of transfers.values()) controller.abort();
      for (const child of children.values()) child.kill();
      for (const resolver of resolvers.values()) if (!resolver.isDestroyed()) resolver.destroy();
      persist();
    });
  }
  function secure(contents) {
    observed.set(contents.id, []);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => { try { webUrl(url); } catch { event.preventDefault(); } });
    contents.on('will-redirect', (event, url) => { try { webUrl(url); } catch { event.preventDefault(); } });
    contents.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) observed.set(contents.id, []); });
    contents.on('destroyed', () => observed.delete(contents.id));
  }
  function setConcurrency(value, { save = true } = {}) {
    initialize();
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Choose between 1 and 8 videos at once.');
    if (save) saveConcurrency?.(count);
    concurrency = count;
    persist();
    pump();
    return { success: true, concurrency };
  }
  function verifiedVideo(file) {
    return new Promise(resolve => {
      execFile(resolveFfmpeg('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { windowsHide: true, timeout: 15000 }, (error, stdout) => {
        try { const info = JSON.parse(stdout); resolve(!error && Number(info.format?.duration) > 0 && info.streams?.some(stream => stream.codec_type === 'video')); } catch { resolve(false); }
      });
    });
  }
  async function removeEntries(id, wholeTitle = false, allowCompleted = false) {
    initialize();
    if (String(id).startsWith('native:')) {
      if (wholeTitle) {
        if (nativeQueue?.removeSeries) {
          const result = await nativeQueue.removeSeries(String(id).slice(7));
          if (result?.success === false) throw new Error(result.error);
          note(`${result.count || 1} download entries removed. Saved files were kept.`);
          return { success: true, count: result.count || 1 };
        }
      }
      if (!nativeQueue?.remove) throw new Error('This download cannot be removed here.');
      const result = await nativeQueue.remove(String(id).slice(7), allowCompleted);
      if (result?.success === false) throw new Error(result.error);
      note('Download entry removed. Saved files were kept.');
      return { success: true, count: 1 };
    }
    const anchor = tasks.find(task => task.id === id);
    if (!anchor) throw new Error('Download entry not found.');
    const allowed = allowCompleted ? ['failed', 'stopped', 'unavailable', 'completed'] : ['failed', 'stopped', 'unavailable'];
    const idle = task => allowed.includes(task.status) && !transfers.has(task.id) && !children.has(task.id) && !resolvers.has(task.id);
    if (!idle(anchor)) throw new Error('Stop this download and wait for it to finish stopping before removing it.');
    if (wholeTitle && !anchor.catalog) throw new Error('Remove title is available for catalog downloads.');
    const removing = tasks.filter(task => idle(task) && (wholeTitle
      ? task.catalog && task.directory === anchor.directory && groupKey(task.catalog) === groupKey(anchor.catalog)
      : task.id === id));
    const ids = new Set(removing.map(task => task.id)), previous = [...tasks];
    tasks.splice(0, tasks.length, ...tasks.filter(task => !ids.has(task.id)));
    try { persist(); } catch (error) { tasks.splice(0, tasks.length, ...previous); throw error; }
    note(`${removing.length} download ${removing.length === 1 ? 'entry' : 'entries'} removed. Saved files were kept.`);
    return { success: true, count: removing.length };
  }
  async function clearCompleted() {
    initialize();
    const idle = task => task.status === 'completed' && !transfers.has(task.id) && !children.has(task.id) && !resolvers.has(task.id);
    const removing = tasks.filter(idle);
    const ids = new Set(removing.map(task => task.id)), previous = [...tasks];
    tasks.splice(0, tasks.length, ...tasks.filter(task => !ids.has(task.id)));
    try { persist(); } catch (error) { tasks.splice(0, tasks.length, ...previous); throw error; }
    let nativeCount = 0;
    if (nativeQueue?.clearCompleted) {
      try {
        const res = await nativeQueue.clearCompleted();
        if (res?.count) nativeCount = res.count;
      } catch {}
    }
    const total = removing.length + nativeCount;
    note(total ? `${total} completed download ${total === 1 ? 'record' : 'records'} cleared. Saved files were kept.` : 'No completed downloads to clear.');
    return { success: true, count: total };
  }
  async function clearAll() {
    initialize();
    const idle = task => ['failed', 'stopped', 'unavailable', 'completed'].includes(task.status) && !transfers.has(task.id) && !children.has(task.id) && !resolvers.has(task.id);
    const removing = tasks.filter(idle);
    const ids = new Set(removing.map(task => task.id)), previous = [...tasks];
    tasks.splice(0, tasks.length, ...tasks.filter(task => !ids.has(task.id)));
    try { persist(); } catch (error) { tasks.splice(0, tasks.length, ...previous); throw error; }
    let nativeCount = 0;
    if (nativeQueue?.clearAll) {
      try {
        const res = await nativeQueue.clearAll();
        if (res?.count) nativeCount = res.count;
      } catch {}
    }
    const total = removing.length + nativeCount;
    note(total ? `${total} download ${total === 1 ? 'record' : 'records'} cleared. Saved files were kept.` : 'No downloads to clear.');
    return { success: true, count: total };
  }
  async function scan(contents, mainOnly = false) {
    const frames = mainOnly ? [contents.mainFrame] : contents.mainFrame.framesInSubtree.filter(frame => {
      try { return frame === contents.mainFrame || /(?:ok\.ru\/videoembed|vimeo\.com|rumble\.com|dailymotion\.com|\/embedded-player)/i.test(frame.url); } catch { return false; }
    });
    const read = async frame => {
      // executeJavaScript waits for remote assets to finish; player markup is usable earlier.
      if (mainOnly && contents.debugger) {
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
        const response = await contents.debugger.sendCommand('Runtime.evaluate', { expression: scanScript, returnByValue: true });
        return response.exceptionDetails ? null : response.result.value;
      }
      return frame.executeJavaScript(scanScript);
    };
    const results = await Promise.all(frames.map(frame => Promise.race([read(frame).catch(() => null), delay(2500).then(() => null)])));
    const main = results[0] || { title: '', poster: '', episodes: [], media: [] };
    main.sources = results.flatMap(r => (r?.media || []).map(url => ({ url, referer: r.url })));
    main.unavailable = results.find(result => result?.unavailable)?.unavailable || '';
    main.media = [...new Set([...results.flatMap(r => r?.media || []), ...(observed.get(contents.id) || [])])].filter(url => !/(?:\/\/|\.)(?:ads?|adserver|doubleclick|googlesyndication)\.|\/(?:ads?|adverts?|preroll)\//i.test(url));
    if (!main.episodes.length) main.episodes = results.flatMap(r => r?.episodes || []);
    return main;
  }
  function navigateInput(value) {
    let input = String(value || '').trim();
    if (!input) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) throw new Error('Use an http or https website link.');
    if (!/^https?:\/\//i.test(input)) input = /\s/.test(input) || !input.includes('.') ? 'https://www.google.com/search?q=' + encodeURIComponent(input) : 'https://' + input;
    view.webContents.loadURL(webUrl(input)).catch(() => {});
  }
  function surfaceSize() {
    const [width, height] = win.getContentSize(); return [width, Math.max(150, height - topInset)];
  }
  function positionEmbedded() {
    if (!embedded || !win || win.isDestroyed()) return;
    const [width, height] = surfaceSize(); uiView.setBounds({ x: 0, y: topInset, width, height });
  }
  function hideEmbedded() {
    if (!embedded || !win || win.isDestroyed()) return;
    visible = false; view.webContents.setAudioMuted(true); browserViews.detach(win, uiView); browserViews.detach(win, view);
  }
  function open(input, options) {
    initialize();
    if (workspaceShell && !options) { workspaceShell.navigate('browser', input); return; }
    if (win && !win.isDestroyed()) {
      if (embedded) {
        visible = true; workspaceMode = options?.mode || 'browser'; topInset = options?.top ?? topInset;
        browserViews.attach(win, uiView);
        if (workspaceMode === 'browser') { browserViews.attach(win, view); view.webContents.setAudioMuted(false); } else { browserViews.detach(win, view); view.webContents.setAudioMuted(true); }
        positionEmbedded(); emit();
        if (workspaceMode === 'browser' && (!view.webContents.getURL() || view.webContents.getURL() === 'about:blank')) navigateInput(input || album?.url || 'https://www.phumi7.net/');
        else if (input) navigateInput(input);
      } else { win.show(); win.focus(); if (input) navigateInput(input); }
      return;
    }
    embedded = !!options?.host; visible = true; workspaceMode = options?.mode || 'browser'; topInset = options?.top || 0;
    if (embedded) {
      win = options.host;
      uiView = new BrowserView({ webPreferences: { preload: path.join(__dirname, '../media-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      uiContents = uiView.webContents; browserViews.attach(win, uiView); positionEmbedded();
    } else {
      win = new BrowserWindow({ width: 1460, height: 960, minWidth: 1120, minHeight: 720, backgroundColor: '#07090e', title: 'AMARA | Browser', autoHideMenuBar: true, icon: path.join(__dirname, '../dist-react/assets/amara-logo.png'), webPreferences: { preload: path.join(__dirname, '../media-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      uiContents = win.webContents;
    }
    view = new BrowserView({ webPreferences: { partition, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } });
    view.setBackgroundColor('#ffffff');
    if (!embedded || workspaceMode === 'browser') browserViews.attach(win, view);
    const bounds = () => {
      if (embedded) { positionEmbedded(); return; }
      const [width, height] = surfaceSize(); view.setBounds({ x: 18, y: 152, width: Math.max(300, width - 438), height: height - 170 });
    };
    bounds(); win.on('resize', bounds);
    secure(view.webContents);
    view.webContents.on('dom-ready', () => {
      view?.webContents.executeJavaScript(`document.addEventListener('click', e => { const a=e.target.closest?.('a[target="_blank"]'); if(e.isTrusted && a && /^https?:/.test(a.href)){ e.preventDefault(); location.href=a.href; } }, true);`).catch(() => {});
    });
    view.webContents.on('did-navigate', emit);
    view.webContents.on('did-navigate-in-page', emit);
    view.webContents.on('did-stop-loading', emit);
    view.webContents.on('did-fail-load', (_e, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) note(`Page could not load: ${description}. Check the address or try another site.`); });
    uiContents.on('will-navigate', event => event.preventDefault());
    uiContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    uiContents.on('did-finish-load', emit);
    uiContents.loadFile(path.join(__dirname, '../dist-react/media-browser.html'));
    if (workspaceMode === 'browser') navigateInput(input || album?.url || 'https://www.phumi7.net/');
    else view.webContents.loadURL('about:blank');
    win.on('closed', () => {
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
      if (uiView && !uiView.webContents.isDestroyed()) uiView.webContents.close();
      view = null; uiView = null; uiContents = null; win = null;
    });
  }

  async function resolve(task) {
    if (task.catalog) {
      if (!catalogResolver) throw new Error('The platform catalog is not ready. Retry shortly.');
      return catalogResolver(task);
    }
    if (task.direct || /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(task.url)) return { url: task.url, referer: task.referer };
    const worker = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    resolvers.set(task.id, worker);
    secure(worker.webContents);
    try {
      worker.webContents.loadURL(task.url).catch(() => {});
      const deadline = Date.now() + 40000;
      const visited = new Set([task.url]);
      while (Date.now() < deadline && task.status !== 'stopped') {
        await delay(700);
        if (worker.isDestroyed()) throw new Error('Episode scan stopped.');
        const result = await scan(worker.webContents, true).catch(() => null);
        if (result?.unavailable) {
          const error = new Error(`Video unavailable at the source: ${result.unavailable}`);
          error.code = 'MEDIA_UNAVAILABLE';
          throw error;
        }
        const candidates = result?.media || [];
        if (candidates.length) {
          const sources = mediaSources(result, task.url);
          return { ...sources[0], alternatives: sources.slice(1) };
        }
        const player = result?.players?.find(url => !visited.has(url));
        if (player && visited.size < 4) {
          visited.add(player);
          worker.webContents.loadURL(webUrl(player), { httpReferrer: worker.webContents.getURL() }).catch(() => {});
          continue;
        }
        // Native video players often start only after play(). Never click arbitrary site buttons.
        worker.webContents.mainFrame.executeJavaScript('document.querySelectorAll("video").forEach(v => {v.muted=true; v.play().catch(()=>{});})').catch(() => {});
      }
      if (process.argv.includes('--browser-probe')) {
        const directory = path.join(process.resourcesPath, '..', '..', 'artifacts', 'browser-debug');
        fs.mkdirSync(directory, { recursive: true });
        const diagnostics = [];
        for (const [i, frame] of worker.webContents.mainFrame.framesInSubtree.entries()) {
          const data = await Promise.race([frame.executeJavaScript(`({url:location.href,html:document.documentElement.outerHTML})`).catch(error => ({ error: error.message })), delay(1500).then(() => ({ error: 'Diagnostic frame read timed out' }))]);
          if (data.html) { fs.writeFileSync(path.join(directory, task.id + '-frame-' + i + '.html'), data.html); delete data.html; }
          data.scan = await Promise.race([frame.executeJavaScript(scanScript).catch(error => ({ error: error.message })), delay(1500).then(() => ({ error: 'Diagnostic scan timed out' }))]);
          diagnostics.push(data);
        }
        fs.writeFileSync(path.join(directory, task.id + '-frames.json'), JSON.stringify(diagnostics, null, 2));
      }
      throw new Error('No downloadable video detected. Open this episode in the browser, press Play, then use “Use playing video”.');
    } finally { resolvers.delete(task.id); if (!worker.isDestroyed()) worker.destroy(); }
  }
  async function download(task) {
    if (task.catalog && task.posterUrl && task.posterStatus !== 'saved') void saveCatalogPoster(task.directory, task.posterUrl).catch(() => {});
    const controller = new AbortController();
    transfers.set(task.id, controller);
    task.status = 'resolving'; task.error = ''; task.bytes = 0; task.time = ''; task.method = ''; delete task.totalBytes; emit();
    const progress = trackDownload(task, emit);
    const progressTimer = setInterval(() => { if (task.status === 'downloading') progress.tick(); }, 1000);
    try {
      fs.mkdirSync(task.directory, { recursive: true });
      const output = path.join(task.directory, task.filename);
      if (fs.existsSync(output)) {
        const valid = await verifiedVideo(output);
        if (task.status === 'stopped') return;
        if (!valid) { const error = new Error('An existing file could not be verified. It was kept without overwriting.'); error.code = 'FILE_EXISTS'; throw error; }
        task.status = 'completed';
      try { task.bytes = fs.statSync(output).size; } catch {}
      task.completedAt = Date.now(); task.bytes = fs.statSync(output).size; task.error = ''; delete task.errorCode; return;
      }
      let source;
      for (let attempt = 1; attempt <= 2; attempt++) {
        task.resolveAttempt = attempt; emit();
        try { source = await resolve(task); break; }
        catch (error) { if (attempt === 2 || task.status === 'stopped' || error.code === 'MEDIA_UNAVAILABLE') throw error; await delay(1200); }
      }
      if (task.status === 'stopped') return;
      task.status = 'downloading'; emit();
      const ses = session.fromPartition(partition);
      const temp = output + '.part';
      const sources = [source, ...(source.alternatives || [])];
      for (let index = 0; index < sources.length; index++) {
        source = sources[index]; progress.reset();
        try {
          const cookies = await ses.cookies.get({ url: source.url });
          if (task.status === 'stopped') return;
          const providerHeaders = Object.fromEntries(Object.entries(source.headers || {}).filter(([key, value]) => /^[a-z0-9-]+$/i.test(key) && !/[\r\n]/.test(String(value)) && !/^(host|connection|content-length)$/i.test(key)));
          const requestHeaders = { 'User-Agent': ses.getUserAgent(), Referer: source.referer, ...(cookies.length ? { Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') } : {}), ...providerHeaders };
          const header = Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}\r\n`).join('');
          try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          const input = temp + '.input';
          task.method = 'connecting'; emit();
          const fetched = !/\.m3u8(?:[?#]|$)/i.test(source.url) && await parallelDownload(source.url, input, {
            headers: requestHeaders,
            signal: controller.signal, connections: Math.min(16, Math.max(4, Math.floor(64 / concurrency))),
            onProgress: (bytes, total, connections) => { task.method = 'parallel'; task.bytes = bytes; task.totalBytes = total; task.connections = connections; },
          });
          if (task.status === 'stopped') return;
          if (!fetched) progress.reset();
          task.method = fetched ? 'finishing' : (/\.m3u8(?:[?#]|$)/i.test(source.url) ? 'hls' : 'direct'); emit();
          const inputArgs = fetched ? ['-i', input] : ['-rw_timeout', '25000000', '-user_agent', ses.getUserAgent(), '-headers', header, '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-i', source.url];
          await new Promise((resolveJob, reject) => {
            const child = spawn(resolveFfmpeg('ffmpeg'), ['-hide_banner', '-nostdin', '-n', ...inputArgs, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', temp], { windowsHide: true });
            children.set(task.id, child);
            let tail = '';
            child.stdout.on('data', chunk => progress.read(chunk, !fetched));
            child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-1800); });
            child.once('error', reject);
            child.once('close', code => code === 0 ? resolveJob() : reject(new Error(task.status === 'stopped' ? 'Stopped' : `Video download failed: ${tail.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 350)}`)));
          });
          break;
        } catch (error) {
          if (task.status === 'stopped' || index === sources.length - 1) throw error;
          children.delete(task.id);
          try { fs.unlinkSync(temp + '.input'); } catch {}
        }
      }
      if (task.status === 'stopped') return;
      task.verifying = true; emit();
      if (!await verifiedVideo(temp)) throw new Error('The downloaded file did not contain a valid video. Please retry.');
      if (task.status === 'stopped') return;
      // Link fails if another download created the target; never replace an existing movie.
      try { await fs.promises.link(temp, output); }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'EINVAL', 'ENOSYS'].includes(error.code)) throw error;
        // FAT/exFAT destination drives do not support hard links.
        await fs.promises.copyFile(temp, output, fs.constants.COPYFILE_EXCL);
      }
      fs.unlinkSync(temp);
      task.status = 'completed';
      try { task.bytes = fs.statSync(output).size; } catch {}
      task.completedAt = Date.now();
    } catch (error) { if (task.status !== 'stopped') {
      task.error = error.message; task.errorCode = error.code || '';
      if (error.code === 'MEDIA_UNAVAILABLE') task.status = 'unavailable';
      else if (!['FILE_EXISTS', 'ENOSPC', 'EACCES', 'EPERM'].includes(error.code) && (task.retryCount || 0) < 2) {
        task.retryCount = (task.retryCount || 0) + 1; task.retryAt = Date.now() + 3000 * 2 ** (task.retryCount - 1); task.status = 'retrying';
      } else task.status = 'failed';
    } }
    finally {
      clearInterval(progressTimer); task.speedBps = 0; delete task.verifying;
      transfers.delete(task.id);
      children.delete(task.id);
      try { fs.unlinkSync(path.join(task.directory, task.filename) + '.part.input'); } catch {}
      try { fs.unlinkSync(path.join(task.directory, task.filename) + '.part'); } catch {}
      persist(); emit();
    }
  }
  function pump() {
    if (closing) return;
    while (active < concurrency) {
      const key = task => {
        const target = path.resolve(task.directory, task.filename);
        return process.platform === 'win32' ? target.toLowerCase() : target;
      };
      const task = tasks.find(t => t.status === 'queued' && !activePaths.has(key(t))); if (!task) break;
      const destination = key(task);
      activePaths.add(destination);
      active++; download(task).finally(() => { active--; activePaths.delete(destination); pump(); });
    }
    persist(); emit();
  }
  ipcMain.handle('media-browser-open', (event, input) => {
    if (event.senderFrame !== event.sender.mainFrame || !event.sender.getURL().startsWith('file:')) throw new Error('Untrusted browser command.');
    open(input); return { success: true };
  });
  ipcMain.handle('media-browser-command', async (event, command, payload) => {
    if (!win || event.sender !== uiContents || event.senderFrame !== uiContents.mainFrame) throw new Error('Untrusted browser command.');
    try {
      switch (command) {
        case 'state': return state();
        case 'remove': {
          const id = typeof payload === 'object' ? payload.id : payload;
          const allowCompleted = typeof payload === 'object' ? (payload.allowCompleted ?? true) : true;
          return await removeEntries(id, false, allowCompleted);
        }
        case 'clear-completed': return await clearCompleted();
        case 'clear-all': return await clearAll();
        case 'remove-title': {
          const id = typeof payload === 'object' ? payload.id : payload;
          const allowCompleted = typeof payload === 'object' ? (payload.allowCompleted ?? true) : true;
          return await removeEntries(id, true, allowCompleted);
        }
        case 'concurrency': return setConcurrency(payload);
        case 'native-manager': return workspaceShell?.navigate('transfers');
        case 'native-settings': return workspaceShell?.navigate('settings');
        case 'layout': {
          const [width, height] = surfaceSize();
          const x = Math.max(0, Math.min(width - 200, Math.round(Number(payload?.x) || 0)));
          const y = Math.max(0, Math.min(height - 150, Math.round(Number(payload?.y) || 0)));
          view.setBounds({ x, y: y + topInset, width: Math.max(200, Math.min(width - x, Math.round(Number(payload?.width) || 200))), height: Math.max(150, Math.min(height - y, Math.round(Number(payload?.height) || 150))) });
          return { success: true };
        }
        case 'go': {
          if (embedded && workspaceMode !== 'browser') workspaceShell.navigate('browser');
          navigateInput(payload); break;
        }
        case 'back': if (view.webContents.canGoBack()) view.webContents.goBack(); break;
        case 'forward': if (view.webContents.canGoForward()) view.webContents.goForward(); break;
        case 'reload': view.webContents.reload(); break;
        case 'collect': {
          if (busy) break; busy = true; emit();
          try {
            const result = await scan(view.webContents);
            if (new URL(view.webContents.getURL()).pathname === '/' && !view.webContents.getURL().includes('127.0.0.1')) { result.episodes = []; result.media = []; }
            album = { ...result, title: result.title || 'Untitled album' };
            if (!album.episodes.length && album.media.length) album.episodes = [{ url: album.media[0], pageUrl: album.url, referer: album.sources?.find(source => source.url === album.media[0])?.referer || album.url, title: 'Episode 1', number: 1, direct: true }];
            persist(); note(album.episodes.length ? `Collected ${album.episodes.length} episodes. Review the title and selection before downloading.` : 'No episode links found. Open the episode list, or play a video and use “Use playing video”.');
          } finally { busy = false; } break;
        }
        case 'capture': {
          if (!album) throw new Error('Collect an album first.');
          const result = await scan(view.webContents);
          if (!result.media.length) throw new Error('Press Play on the episode and try again. No MP4 or HLS stream detected yet.');
          const episode = album.episodes.find(ep => (ep.pageUrl || ep.url) === view.webContents.getURL());
          const url = mediaSources(result, view.webContents.getURL())[0].url;
          const referer = result.sources?.find(source => source.url === url)?.referer || view.webContents.getURL();
          if (episode) { episode.pageUrl = episode.pageUrl || episode.url; episode.referer = referer; episode.url = url; episode.direct = true; }
          else if (!album.episodes.some(ep => ep.url === url)) album.episodes.push({ url, pageUrl: view.webContents.getURL(), title: result.title || `Episode ${album.episodes.length + 1}`, number: album.episodes.length + 1, direct: true, referer });
          for (const task of tasks) if (['failed', 'stopped'].includes(task.status) && (task.pageUrl || task.url) === view.webContents.getURL()) {
            task.pageUrl = task.pageUrl || task.url; task.url = url; task.referer = referer; task.direct = true; task.error = '';
          }
          persist(); note('Playing video added. Use Retry on the failed episode or download your selection.'); break;
        }
        case 'folder': { const selected = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); if (!selected.canceled) { folder = selected.filePaths[0]; persist(); } break; }
        case 'queue': {
          if (!album) throw new Error('Collect an album first.');
          const selected = new Set(payload?.indices || []);
          const episodes = album.episodes.filter((_ep, i) => selected.has(i));
          if (!episodes.length) throw new Error('Select at least one episode.');
          album.title = String(payload.title || album.title).slice(0, 150);
          if (payload.concurrency != null) setConcurrency(payload.concurrency);
          const directory = path.join(folder || getSettings().root || app.getPath('downloads'), 'Amara', safeName(album.title));
          let count = 0;
          for (const ep of episodes) {
            const filename = `Episode ${String(ep.number).padStart(3, '0')}.mp4`;
            if (tasks.some(t => t.directory === directory && t.filename === filename && !['failed', 'stopped'].includes(t.status))) continue;
            const previous = tasks.find(t => t.directory === directory && t.filename === filename && ['failed', 'stopped'].includes(t.status));
            if (previous && (transfers.has(previous.id) || children.has(previous.id) || resolvers.has(previous.id))) continue;
            if (previous) { previous.url = ep.url; previous.pageUrl = ep.pageUrl || ep.url; previous.direct = !!ep.direct; previous.referer = ep.referer || album.url; previous.status = 'queued'; previous.error = ''; count++; continue; }
            tasks.push({ id: require('crypto').randomUUID(), url: webUrl(ep.url), pageUrl: ep.pageUrl || ep.url, direct: !!ep.direct, referer: ep.referer || album.url, title: `${album.title} · Episode ${ep.number}`, directory, filename, status: 'queued', bytes: 0 }); count++;
          }
          fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(path.join(directory, 'album.json'), JSON.stringify(album, null, 2));
          const posterUrl = album.poster;
          if (posterUrl) void savePoster(directory, posterUrl).then(saved => { if (!saved) note('Episodes queued. Poster could not be saved; use Save poster to retry.'); });
          note(`${count} episodes queued. Saving in ${directory}`); pump(); break;
        }
        case 'poster': {
          if (!album?.poster) throw new Error('No poster found on this page.');
          const directory = path.join(folder || getSettings().root || app.getPath('downloads'), 'Amara', safeName(payload?.title || album.title));
          const saved = await savePoster(directory, album.poster);
          if (!saved) throw new Error('Poster could not be downloaded.'); note('Poster saved to ' + saved); break;
        }
        case 'stop': {
          if (nativeQueue) await nativeQueue.stop();
          for (const task of tasks) if (['queued', 'resolving', 'downloading', 'retrying'].includes(task.status)) { task.status = 'stopped'; transfers.get(task.id)?.abort(); children.get(task.id)?.kill(); const resolver = resolvers.get(task.id); if (resolver && !resolver.isDestroyed()) resolver.destroy(); }
          persist(); break;
        }
        case 'retry': {
          if (nativeQueue && (!payload || String(payload).startsWith('native:'))) {
            const result = await nativeQueue.retry(payload ? String(payload).slice(7) : null);
            if (result?.success === false) throw new Error(result.error);
          }
          const candidates = tasks.filter(task => (!payload || task.id === payload) && (['failed', 'stopped', 'unavailable'].includes(task.status)) && !transfers.has(task.id) && !children.has(task.id) && !resolvers.has(task.id));
          const needsSource = task => !fs.existsSync(path.join(task.directory, task.filename));
          const checked = catalogPreflight ? await checkGroups(candidates.filter(needsSource), catalogPreflight) : new Map();
          for (const task of candidates) {
            if (catalogPreflight && task.catalog && needsSource(task)) {
              const error = checked.get(groupKey(task.catalog));
              if (error) { task.status = 'unavailable'; task.error = error.message; task.errorCode = error.code || 'PROVIDER_VIDEO_UNAVAILABLE'; continue; }
            }
            task.status = 'queued';
            task.retryCount = 0;
            task.error = '';
          }
          pump();
          const blocked = [...checked.values()].find(Boolean);
          if (blocked) note(blocked.message);
          break;
        }
        case 'catalog-poster': {
          const task = tasks.find(t => t.id === payload);
          if (!task?.posterUrl) throw new Error('No poster is available for this movie.');
          const saved = await saveCatalogPoster(task.directory, task.posterUrl);
          note(saved ? 'Movie poster saved with the episodes.' : 'Poster could not be saved. Try again later.'); break;
        }
        case 'open-file': {
          if (nativeQueue && String(payload).startsWith('native:')) {
            if (nativeQueue.file) { await nativeQueue.file(String(payload).slice(7)); break; }
            await nativeQueue.folder(String(payload).slice(7)); break;
          }
          const task = tasks.find(t => t.id === payload);
          if (task) {
            const filePath = path.join(task.directory, task.filename);
            if (fs.existsSync(filePath)) {
              const error = await shell.openPath(filePath);
              if (error) throw new Error(error);
              break;
            }
          }
          const target = task?.directory || folder || getSettings().root || app.getPath('downloads');
          const error = await shell.openPath(target);
          if (error) throw new Error(error);
          break;
        }
        case 'open-folder': { if (nativeQueue && String(payload).startsWith('native:')) { await nativeQueue.folder(String(payload).slice(7)); break; } const task = tasks.find(t => t.id === payload); const target = task?.directory || folder || getSettings().root || app.getPath('downloads'); const error = await shell.openPath(target); if (error) throw new Error(error); break; }
        default: throw new Error('Unknown command.');
      }
      emit(); return { success: true };
    } catch (error) { note(error.message); return { success: false, error: error.message }; }
  });
  async function saveCatalogPoster(directory, url) {
    let file = null;
    try { file = await catalogPosterSaver(directory, url); } catch {}
    for (const task of tasks) if (task.directory === directory && task.catalog) {
      task.posterStatus = file ? 'saved' : 'failed'; task.posterFile = file || '';
    }
    persist(); emit(); return file;
  }
  async function queueCatalog(payload) {
    initialize();
    if (!payload || !/^[a-z0-9_-]+$/i.test(payload.platform) || !payload.dramaId || !Array.isArray(payload.episodes) || !payload.episodes.length || payload.episodes.length > 2000) throw new Error('Invalid episode selection.');
    const title = String(payload.title || 'Drama').slice(0, 150);
    const directory = path.join(folder || getSettings().root || app.getPath('downloads'), 'Amara', safeName(title) + ' [' + safeName(payload.platform + '-' + String(payload.dramaId)).slice(0, 60) + ']');
    const prepared = payload.episodes.map((ep, index) => {
      const number = Number(ep.index || index + 1);
      if (!Number.isSafeInteger(number) || number < 1 || !ep.id) throw new Error('Invalid episode number.');
      return { number, chapterId: String(ep.id).slice(0, 200) };
    });
    if (payload.concurrency != null) setConcurrency(payload.concurrency);
    if (catalogPreflight) {
      const first = prepared.find(ep => {
        const filename = `Episode ${String(ep.number).padStart(3, '0')}.mp4`;
        return !fs.existsSync(path.join(directory, filename)) && !tasks.some(task => task.directory === directory && task.filename === filename && !['failed', 'stopped', 'unavailable'].includes(task.status));
      });
      if (first) await catalogPreflight({ platform: payload.platform, dramaId: String(payload.dramaId), chapterId: first.chapterId, lang: String(payload.lang || 'en') });
    }
    fs.mkdirSync(directory, { recursive: true });
    let count = 0;
    for (const ep of prepared) {
      const filename = `Episode ${String(ep.number).padStart(3, '0')}.mp4`;
      if (tasks.some(task => task.directory === directory && task.filename === filename && !['failed', 'stopped', 'unavailable'].includes(task.status))) continue;
      const catalog = { platform: payload.platform, dramaId: String(payload.dramaId), chapterId: ep.chapterId, lang: String(payload.lang || 'en') };
      const previous = tasks.find(task => task.directory === directory && task.filename === filename);
      if (previous) {
        if (transfers.has(previous.id)) continue;
        Object.assign(previous, { catalog, status: 'queued', error: '', retryCount: 0, createdAt: Date.now(), source: 'catalog' });
      } else tasks.push({ id: require('crypto').randomUUID(), url: 'https://catalog.amara.invalid/', catalog, title: `${title} · Episode ${ep.number}`, directory, filename, status: 'queued', bytes: 0, createdAt: Date.now(), source: 'catalog' });
      count++;
    }
    const episodes = new Map();
    try {
      const previous = JSON.parse(fs.readFileSync(path.join(directory, 'album.json'), 'utf8'));
      if (previous.platform === payload.platform && (previous.lang || 'en') === String(payload.lang || 'en') &&
          (!previous.dramaId || String(previous.dramaId) === String(payload.dramaId))) {
        for (const ep of previous.episodes || []) episodes.set(ep.number, ep);
      }
    } catch {}
    for (const ep of prepared) episodes.set(ep.number, ep);
    fs.writeFileSync(path.join(directory, 'album.json'), JSON.stringify({ title, poster: payload.cover || '', platform: payload.platform, dramaId: String(payload.dramaId), lang: String(payload.lang || 'en'), episodes: [...episodes.values()] }, null, 2));
    const posterUrl = /^https?:\/\//i.test(payload.cover || '') ? payload.cover : '';
    for (const task of tasks) if (task.directory === directory && task.catalog) {
      if (posterUrl) { task.posterUrl = posterUrl; if (task.posterStatus !== 'saved') task.posterStatus = 'saving'; }
    }
    persist(); pump();
    const posterFile = posterUrl ? await saveCatalogPoster(directory, posterUrl) : null;
    return { success: true, count, directory, posterSaved: !!posterFile, posterStatus: posterUrl ? (posterFile ? 'saved' : 'failed') : 'missing', posterFile };
  }
  return { open, start: initialize, queueCatalog, stateForCheck: state, setConcurrency, removeEntries, clearCompleted, clearAll,
    catalogDownloads: () => { initialize(); return require('./catalog-downloads')(tasks, [folder, getSettings().root, app.getPath('downloads')]); },
    setNativeQueue: queue => { nativeQueue = queue; }, refreshDownloads: emit,
    setShell: config => { workspaceShell = config; }, hideEmbedded,
    showEmbedded: (host, top, mode, input) => open(input, { host, top, mode }),
    embeddedContents: () => uiContents, setInset: top => { topInset = top; positionEmbedded(); }, setCatalogResolver: resolver => { catalogResolver = resolver; },
    setCatalogPosterSaver: saver => { catalogPosterSaver = saver; },
    setCatalogPreflight: check => { catalogPreflight = check; },
    selectCatalogFolder: async parent => {
      initialize();
      const selected = await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] });
      if (!selected.canceled) { folder = selected.filePaths[0]; persist(); }
      return { folder: folder || getSettings().root || app.getPath('downloads') };
    }, resolveForCheck: task => { initialize(); return resolve(task); } };
};

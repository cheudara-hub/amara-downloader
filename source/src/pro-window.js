const browserViews = require('./browser-views');
const { BrowserWindow, BrowserView, ipcMain, app, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { getMachineFingerprint } = require('./native/license-validator');
module.exports = async function installPro({ mediaBrowser, getSettings, gatewayOptions, updates }) {
  const proCacheDir = gatewayOptions?.cacheDir || (app ? path.join(app.getPath('userData'), 'pro-cache') : path.join(require('node:os').tmpdir(), 'amara-pro-cache'));
  const gateway = await require('./pro-gateway')({ cacheDir: proCacheDir, maxImageConcurrency: 16, ...gatewayOptions });
  mediaBrowser.setCatalogPosterSaver(require('./poster')(null, {}, { loadImage: async url => (await gateway.loadImage(url)).data }));
  let win, workspace, workspaceReady, route = 'home', inset = 124;
  const page = pathToFileURL(path.join(__dirname, '../pro/index.html')).href;
  const nativePage = pathToFileURL(path.join(__dirname, '../dist-react/index.html')).href;
  const nativeRoutes = {
    hongguo: { id: 'browse', labels: ['Discover', 'Browse', '首页'] },
    library: { id: 'player', labels: ['My library', 'My Library', 'Player', '我的剧库'] },
    add: { id: 'download', labels: ['Search & download', 'Search & Download', 'Add Downloads', '搜索下载'] },
    settings: { id: 'settings', labels: ['Settings', '设置'] },
    transfers: { id: 'manager', labels: ['Downloads', '下载管理'] },
  };
  const playback = require('./catalog-playback')({ video: query => gateway.api('video', query) });
  mediaBrowser.setCatalogResolver(task => playback.resolve(task.catalog));
  mediaBrowser.setCatalogPreflight(catalog => playback.probe(catalog));
  function layout() {
    if (!win || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    workspace?.setBounds({ x: 0, y: inset, width, height: Math.max(100, height - inset) });
    mediaBrowser.setInset(inset);
  }
  async function ensureWorkspace() {
    if (workspace) return workspaceReady;
    workspace = new BrowserView({ webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, additionalArguments: ['--amara-embedded'] } });
    workspace.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    workspace.webContents.on('will-navigate', event => event.preventDefault());
    workspaceReady = workspace.webContents.loadFile(path.join(__dirname, '../dist-react/index.html'));
    await workspaceReady;
    layout();
  }
  async function navigate(next, input) {
    if (!win || win.isDestroyed()) open();
    if (![...Object.keys(nativeRoutes), 'home', 'discover', 'search', 'watchlist', 'browser', 'downloads'].includes(next)) throw new Error('Unknown workspace page');
    route = next;
    mediaBrowser.hideEmbedded();
    if (workspace) { browserViews.detach(win, workspace); workspace.webContents.setAudioMuted(true); }
    win.webContents.send('amara-pro-route', route);
    if (nativeRoutes[route]) {
      await ensureWorkspace();
      if (route !== next) return;
      browserViews.attach(win, workspace); workspace.webContents.setAudioMuted(false); layout();
      const spec = nativeRoutes[route];
      workspace.webContents.send('navigate', { page: spec.id });
      await workspace.webContents.executeJavaScript(`new Promise(resolve => {
        let count = 0;
        const targets = ${JSON.stringify(spec.labels)};
        const pageId = ${JSON.stringify(spec.id)};
        const select = () => {
          const button = Array.from(document.querySelectorAll('.sidebar-item')).find(el => {
            const txt = el.textContent.trim();
            return targets.some(t => txt.includes(t)) || el.getAttribute('data-id') === pageId;
          });
          if (button) { button.click(); resolve(); }
          else if (++count < 60) setTimeout(select, 50);
          else resolve();
        };
        select();
      })`).catch(() => {});
    } else if (route === 'browser' || route === 'downloads') {
      mediaBrowser.showEmbedded(win, inset, route, input);
    }
    win.show();
    return { success: true, route };
  }
  ipcMain.handle('amara-pro-open', event => {
    if (!workspace || event.sender !== workspace.webContents || event.senderFrame !== workspace.webContents.mainFrame || event.sender.getURL() !== nativePage) throw new Error('Untrusted workspace command');
    return navigate('home');
  });
  ipcMain.handle('amara-pro-command', async (event, command, payload) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.sender.getURL() !== page) throw new Error('Untrusted desktop command');
    switch (command) {
      case 'updates':
        if (!updates || !['state', 'check', 'auto', 'open-app', 'open-upstream'].includes(payload?.action)) throw new Error('Unknown update action');
        return updates(payload.action);
      case 'navigate': return navigate(payload?.route, payload?.input);
      case 'layout': inset = Math.max(90, Math.min(180, Math.round(Number(payload?.top) || 124))); layout(); return { success: true };
      case 'queue': return mediaBrowser.queueCatalog(payload);
      case 'download-status': return mediaBrowser.catalogDownloads();
      case 'downloads': return navigate('downloads');
      case 'browser': return navigate('browser', payload);
      case 'workspace': return navigate(payload === 'Settings' ? 'settings' : payload === 'Add Downloads' ? 'add' : 'library');
      case 'settings': return { root: getSettings().root, concurrency: mediaBrowser.stateForCheck().concurrency };
      case 'folder': return mediaBrowser.selectCatalogFolder(win);
      case 'get-machine-id':
        return getMachineFingerprint();
      case 'load-license': {
        const licFile = path.join(app ? app.getPath('userData') : proCacheDir, 'amara-vip-license.json');
        try {
          if (fs.existsSync(licFile)) return JSON.parse(fs.readFileSync(licFile, 'utf8'));
        } catch (_) {}
        return null;
      }
      case 'save-license': {
        const licFile = path.join(app ? app.getPath('userData') : proCacheDir, 'amara-vip-license.json');
        try {
          if (!payload) {
            if (fs.existsSync(licFile)) fs.unlinkSync(licFile);
          } else {
            fs.mkdirSync(path.dirname(licFile), { recursive: true });
            fs.writeFileSync(licFile, JSON.stringify(payload, null, 2), 'utf8');
          }
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'sign-out-license': {
        const licFile = path.join(app ? app.getPath('userData') : proCacheDir, 'amara-vip-license.json');
        try {
          if (fs.existsSync(licFile)) fs.unlinkSync(licFile);
        } catch (_) {}
        return { success: true };
      }
      case 'clipboard-write': {
        try {
          if (clipboard) clipboard.writeText(String(payload || ''));
        } catch (_) {}
        return { success: true };
      }
      default: throw new Error('Unknown desktop command');
    }
  });
  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return win; }
    win = new BrowserWindow({ width: 1400, height: 940, minWidth: 900, minHeight: 620, title: 'AMARA PRO DL', autoHideMenuBar: true,
      backgroundColor: '#07090e', icon: path.join(__dirname, '../pro/assets/logo.png'),
      webPreferences: { preload: path.join(__dirname, '../pro-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: ['--amara-pro-origin=' + gateway.origin, '--amara-app-version=' + app.getVersion()] },
    });
    mediaBrowser.setShell({ navigate });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
    win.on('resize', layout);
    win.loadFile(path.join(__dirname, '../pro/index.html'));
    win.on('closed', () => { if (workspace && !workspace.webContents.isDestroyed()) workspace.webContents.close(); workspace = null; win = null; app.quit(); });
    return win;
  }
  app.once('before-quit', gateway.close);
  return { open, gateway, navigate, workspaceContents: () => workspace?.webContents, routeForCheck: () => route,
    forwardEvent: (channel, payload) => { if (workspace && !workspace.webContents.isDestroyed()) workspace.webContents.send(channel, payload); },
  };
};

// Read cards as soon as the DOM is usable, without waiting for every remote asset.
module.exports = function createCatalogLoader({ getWindow, cardsScript, metaScript, userAgent,
  site, timeoutMs = 24000, pollMs = 200, cacheMs = 300000, attempts = 2 }) {
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function bounded(promise, ms) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The catalog website is responding slowly. Use Retry to load this page again.')), ms);
      })]);
    } finally { clearTimeout(timer); }
  }
  return function load(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.time < cacheMs) return Promise.resolve(hit.value);
    if (pending.has(url)) return pending.get(url);
    const task = async () => {
      const deadline = Date.now() + timeoutMs;
      let result;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const attemptDeadline = Math.min(deadline, Date.now() + timeoutMs / attempts);
        result = await tryLoad(attemptDeadline);
        if (result.success || Date.now() >= deadline) return result;
      }
      return result;
    };
    const tryLoad = async deadline => {
      let win;
      try {
        if (Date.now() >= deadline) throw new Error('The catalog is busy. Please try again.');
        win = getWindow();
        const contents = win.webContents;
        const read = async script => {
          // Electron executeJavaScript waits for did-stop-loading, even when cards
          // are already visible. Evaluate directly in the current document instead.
          if (contents.debugger) {
            if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
            const response = await contents.debugger.sendCommand('Runtime.evaluate', {
              expression: `location.href === ${JSON.stringify(url)} ? (${script}) : '[]'`,
              returnByValue: true,
            });
            if (response.exceptionDetails) throw new Error('Catalog document is not ready');
            return response.result.value;
          }
          return contents.executeJavaScript(script, true);
        };
        let navigationError = null;
        // loadURL resolves after images, fonts and other subresources. Start polling immediately.
        Promise.resolve(win.loadURL(url, { userAgent })).catch(error => { navigationError = error; });
        while (Date.now() < deadline) {
          if (win.isDestroyed()) throw new Error('The catalog window was closed. Please try again.');
          // Do not read cards from the previous category while navigation is starting.
          const actual = contents.getURL();
          if (actual === url) {
            let cards = [];
            try { cards = JSON.parse(await bounded(read(cardsScript), Math.min(1000, Math.max(1, deadline - Date.now())))); } catch (_) {}
            if (Array.isArray(cards) && cards.length) {
              let meta = {};
              // Streamed pages may expose cards before their pagination metadata.
              // Give the total/page links a short chance to arrive before returning.
              const metaDeadline = Math.min(deadline, Date.now() + 1800);
              do {
                try { meta = JSON.parse(await bounded(read(metaScript), Math.min(600, Math.max(1, metaDeadline - Date.now())))); } catch (_) {}
                if (!url.includes('/category/') || meta.totalPages > 0 || Date.now() >= metaDeadline) break;
                await delay(Math.min(100, Math.max(1, metaDeadline - Date.now())));
              } while (Date.now() < metaDeadline);
              const results = cards.filter(card => card.series_id && card.series_title)
                .map(card => ({ ...card, url: `${site}/detail?series_id=${card.series_id}` }));
              if (results.length) {
                const value = { success: true, results, meta };
                cache.set(url, { time: Date.now(), value });
                if (cache.size > 40) cache.delete(cache.keys().next().value);
                return value;
              }
            }
          }
          if (navigationError && !/ERR_ABORTED/.test(navigationError.message)) {
            throw new Error('Cannot reach the catalog website. Check your connection or proxy in Settings, then try again.');
          }
          await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
        }
        throw new Error('The catalog website is responding slowly. Use Retry to load this page again.');
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        // Stop lingering image/asset requests before another category uses the shared window.
        if (win && !win.isDestroyed()) win.webContents.stop();
      }
    };
    const request = queue.then(task, task);
    queue = request.catch(() => {});
    pending.set(url, request);
    request.finally(() => pending.delete(url));
    return request;
  };
};

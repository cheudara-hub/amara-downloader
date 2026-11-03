// Native gateway for the user's Clone apk web client. No Python server required.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { getStream } = require('./http-stream');
const config = require('./pro-config.json');
const routes = new Set(['categories', 'home', 'discover', 'popular-search', 'search', 'detail', 'video', 'community', 'health']);
function emptyDetail(value) {
  const data = value?.data;
  return data && !Array.isArray(data) && !String(data.title || '').trim() && !(Number(data.total_episodes) > 0) && !(data.chapters?.length > 0);
}

function webUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media URL');
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) throw new Error('Local media addresses are not allowed');
  return url.href;
}

function rewritePlaylist(text, url, proxy) {
  const wrap = value => proxy + encodeURIComponent(webUrl(new URL(value, url).href));
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (!line.startsWith('#')) return wrap(line.trim());
    return line.replace(/URI="([^"]+)"/g, (_match, value) => `URI="${wrap(value)}"`);
  }).join('\n');
}

async function readBody(stream, limit = 12 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) { stream.destroy(); throw new Error('Provider response is too large'); }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function getRouteTtl(route) {
  switch (route) {
    case 'categories': return { fresh: 24 * 3600 * 1000, stale: 7 * 86400 * 1000 };
    case 'home': return { fresh: 3600 * 1000, stale: 3 * 86400 * 1000 };
    case 'discover': return { fresh: 3600 * 1000, stale: 3 * 86400 * 1000 };
    case 'popular-search': return { fresh: 2 * 3600 * 1000, stale: 3 * 86400 * 1000 };
    case 'detail': return { fresh: 12 * 3600 * 1000, stale: 7 * 86400 * 1000 };
    case 'search': return { fresh: 1800 * 1000, stale: 86400 * 1000 };
    default: return { fresh: 300 * 1000, stale: 86400 * 1000 };
  }
}

module.exports = async function startGateway({ transport = getStream, configuration = config, imageConverter, cacheDir, maxImageConcurrency = 16 } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const cache = new Map(), streamHeaders = new Map(), pending = new Map(), revalidating = new Set();
  
  let apiCacheDir = null, imgCacheDir = null;
  if (cacheDir) {
    try {
      apiCacheDir = path.join(cacheDir, 'api');
      imgCacheDir = path.join(cacheDir, 'images');
      fs.mkdirSync(apiCacheDir, { recursive: true });
      fs.mkdirSync(imgCacheDir, { recursive: true });
    } catch (_) {}
  }

  const images = require('./pro-images').createImageLoader({
    transport, readBody, convert: imageConverter,
    cacheDir: imgCacheDir,
    maxConcurrency: maxImageConcurrency,
    fallbackUrl: input => {
      const url = new URL(input);
      if (url.origin !== new URL(configuration.apiBase).origin || url.pathname !== '/api/proxy/image' || !url.searchParams.get('url')) return null;
      try { return webUrl(url.searchParams.get('url')); } catch { return null; }
    },
  });

  async function loadDiskCache(remotePath) {
    if (!apiCacheDir) return null;
    try {
      const hash = crypto.createHash('sha256').update(remotePath).digest('hex');
      const filePath = path.join(apiCacheDir, `${hash}.json`);
      const raw = await fsp.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.value) return data;
    } catch (_) {}
    return null;
  }

  function saveDiskCache(remotePath, entry) {
    if (!apiCacheDir) return;
    try {
      const hash = crypto.createHash('sha256').update(remotePath).digest('hex');
      const filePath = path.join(apiCacheDir, `${hash}.json`);
      fsp.writeFile(filePath, JSON.stringify(entry), 'utf8').catch(() => {});
    } catch (_) {}
  }

  let origin;
  function api(route, query = '') {
    if (route === 'video') return fetchApi(route, query).catch(error => { throw require('./catalog-playback').providerError(error); });
    const key = JSON.stringify([route, query]);
    if (pending.has(key)) return pending.get(key);
    const request = fetchApi(route, query).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  async function refreshApi(route, query, remotePath) {
    if (revalidating.has(remotePath)) return;
    revalidating.add(remotePath);
    try {
      await fetchApi(route, query, true);
    } catch (_) {
    } finally {
      revalidating.delete(remotePath);
    }
  }

  async function fetchApi(route, query = '', forceRefresh = false) {
    if (!routes.has(route)) throw new Error('Unknown provider endpoint');
    const remotePath = `/api/v2/${route}${query ? '?' + query : ''}`;
    
    let cached = cache.get(remotePath);
    if (!cached && route !== 'video') {
      cached = await loadDiskCache(remotePath);
      if (cached) cache.set(remotePath, cached);
    }

    if (route === 'detail' && cached && emptyDetail(cached.value)) cached = null;
    if (route !== 'video' && cached && !forceRefresh) {
      if (cached.expires > Date.now()) {
        return cached.value;
      }
      if (cached.staleExpires && cached.staleExpires > Date.now()) {
        refreshApi(route, query, remotePath).catch(() => {});
        return cached.value;
      }
    }

    const timestamp = String(Date.now());
    let value;
    try {
      const response = await transport(configuration.apiBase + remotePath, {
        responseType: 'stream', timeout: 35000, headers: {
          'User-Agent': 'Dart/3.5 (dart:io)', 'x-device-id': configuration.deviceId,
          'x-platform': 'android', 'x-client-type': 'android', 'x-os-version': '14',
          'x-device-brand': 'Google', 'x-device-model': 'Pixel 7', 'x-app-version': '1.2.9',
          'x-channel': 'official-apk', 'X-Timestamp': timestamp,
          'X-Signature': crypto.createHmac('sha256', configuration.secret).update(`GET:${remotePath}:${timestamp}`).digest('hex'),
          Accept: 'application/json',
        }
      });
      value = JSON.parse((await readBody(response.data)).toString('utf8'));
      if (response.status >= 400) {
        const err = new Error(value.message || value.error || `Provider returned HTTP ${response.status}`);
        err.status = response.status;
        if (value.code) err.code = value.code;
        throw err;
      }
    } catch (err) {
      if (cached && cached.value) {
        return cached.value;
      }
      throw err;
    }

    if (route === 'video') {
      const headers = value.data?.streamHeaders || {};
      const safe = Object.fromEntries(Object.entries(headers).filter(([key, val]) => /^[a-z0-9-]+$/i.test(key) && !/[\r\n]/.test(String(val)) && !/^(host|connection|content-length)$/i.test(key)));
      for (const item of value.data?.streams || []) if (item.url) streamHeaders.set(webUrl(item.url), safe);
      while (streamHeaders.size > 1000) streamHeaders.delete(streamHeaders.keys().next().value);
    } else if (value.success && !(route === 'detail' && emptyDetail(value))) {
      const ttl = getRouteTtl(route);
      const entry = {
        value,
        expires: Date.now() + ttl.fresh,
        staleExpires: Date.now() + ttl.stale,
        savedAt: Date.now()
      };
      cache.set(remotePath, entry);
      saveDiskCache(remotePath, entry);
      while (cache.size > 2000) cache.delete(cache.keys().next().value);
    }
    return value;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const prefix = `/${token}/api/`;
      if (req.method !== 'GET' || !url.pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
      const route = url.pathname.slice(prefix.length);
      if (route === 'image') {
        const image = await images.load(webUrl(url.searchParams.get('url')));
        res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.data.length, 'Cache-Control': 'private, max-age=86400' });
        res.end(image.data); return;
      }
      if (route === 'stream-proxy') {
        const target = webUrl(url.searchParams.get('url'));
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        const upstream = await transport(target, { responseType: 'stream', signal: controller.signal, timeout: 30000, headers: {
          'User-Agent': 'Mozilla/5.0', ...(streamHeaders.get(target) || {}), ...(req.headers.range ? { Range: req.headers.range } : {}),
        }});
        if (upstream.status >= 400) { upstream.data.destroy(); throw new Error(`Media server returned HTTP ${upstream.status}`); }
        const type = upstream.headers['content-type'] || 'video/mp4';
        if (/\.m3u8(?:[?#]|$)/i.test(target) || /mpegurl/i.test(type)) {
          const playlist = (await readBody(upstream.data)).toString('utf8');
          const inherited = streamHeaders.get(target);
          const rewritten = rewritePlaylist(playlist, target, origin + '/api/stream-proxy?url=');
          if (inherited) for (const match of rewritten.matchAll(/url=([^"\s]+)/g)) streamHeaders.set(decodeURIComponent(match[1]), inherited);
          res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(rewritten);
        } else {
          const headers = { 'Content-Type': type };
          for (const key of ['content-length', 'content-range', 'accept-ranges']) if (upstream.headers[key]) headers[key] = upstream.headers[key];
          res.writeHead(upstream.status, headers);
          upstream.data.on('error', () => res.destroy()); upstream.data.pipe(res);
        }
        return;
      }
      const result = await api(route, url.search.slice(1));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result));
    } catch (error) {
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: error.message, message: error.message, code: error.code })); }
      else res.destroy();
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}/${token}`;

  // Gentle background warm-up of top platforms when cache directory is configured
  if (cacheDir) {
    setTimeout(() => {
      api('categories').catch(() => {});
      const popular = ['dramabox', 'snackshort', 'meloshort', 'shortmax', 'blinkdrama', 'kisskh', 'reelpine', 'mydrama'];
      popular.forEach((p, index) => {
        setTimeout(() => {
          api('home', `category_p=${p}&lang=en`).catch(() => {});
        }, 400 * (index + 1));
      });
    }, 1000);
  }

  return { origin, api, loadImage: url => images.load(webUrl(url)), close: () => { server.closeAllConnections?.(); server.close(); } };
};
module.exports.rewritePlaylist = rewritePlaylist;

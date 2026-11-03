const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function imageType(data) {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (/^GIF8[79]a/.test(data.toString('ascii', 0, 6))) return 'image/gif';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 4, 8) === 'ftyp') {
    const brands = data.toString('ascii', 8, Math.min(data.length, 80));
    if (/avif|avis/.test(brands)) return 'image/avif';
    if (/heic|heix|hevc|hevx|mif1/.test(brands)) return 'image/heic';
  }
  return null;
}
function resolveFfmpegExecutable() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin/ffmpeg.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin/ffmpeg') : null,
    process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : null,
    process.platform === 'darwin' ? '/usr/local/bin/ffmpeg' : null,
    path.join(__dirname, '../../Hongguo English/resources/bin/ffmpeg.exe'),
    path.join(__dirname, '../Hongguo English/resources/bin/ffmpeg.exe'),
    path.join(__dirname, '../build/ffmpeg/ffmpeg.exe'),
  ];
  for (const c of candidates) {
    if (c) {
      try {
        if (require('node:fs').existsSync(c)) return c;
      } catch (_) {}
    }
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function convertHeic(data, executable = resolveFfmpegExecutable()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'amara-cover-'));
  const input = path.join(directory, 'cover.heic');
  try {
    await fs.writeFile(input, data);
    const output = await new Promise((resolve, reject) => {
      execFile(executable, ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-i', input,
        '-frames:v', '1', '-vf', 'scale=min(1200\\,iw):-2', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', '-threads', '1', 'pipe:1'],
      { windowsHide: true, timeout: 20000, maxBuffer: 12 * 1024 * 1024, encoding: 'buffer' }, (error, stdout) => error ? reject(new Error('Cover image conversion failed')) : resolve(stdout));
    });
    if (imageType(output) !== 'image/jpeg') throw new Error('Invalid converted cover');
    return output;
  } finally { await fs.unlink(input).catch(() => {}); await fs.rmdir(directory).catch(() => {}); }
}
function createImageLoader({ transport, readBody, convert = convertHeic, fallbackUrl, maxBytes = 128 * 1024 * 1024, cacheDir, maxConcurrency = 4 }) {
  const cache = new Map(), pending = new Map(), waiting = [];
  let bytes = 0, active = 0;
  function remember(url, item) {
    if (cache.has(url)) { bytes -= cache.get(url).data.length; cache.delete(url); }
    if (item.data.length > maxBytes) return;
    cache.set(url, item); bytes += item.data.length;
    while (bytes > maxBytes || cache.size > 1000) {
      const oldest = cache.keys().next().value;
      bytes -= cache.get(oldest).data.length; cache.delete(oldest);
    }
  }
  if (cacheDir) {
    try { require('node:fs').mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  }
  async function load(url) {
    if (cache.has(url)) { const item = cache.get(url); cache.delete(url); cache.set(url, item); return item; }

    if (cacheDir) {
      try {
        const hash = crypto.createHash('sha256').update(url).digest('hex');
        const binFile = path.join(cacheDir, `${hash}.bin`);
        const metaFile = path.join(cacheDir, `${hash}.json`);
        const [metaRaw, binData] = await Promise.all([
          fs.readFile(metaFile, 'utf8'),
          fs.readFile(binFile)
        ]);
        const meta = JSON.parse(metaRaw);
        if (meta?.type && imageType(binData) === meta.type && meta.type !== 'image/heic') {
          const item = { data: binData, type: meta.type };
          remember(url, item);
          return item;
        }
      } catch (_) {}
    }

    if (pending.has(url)) return pending.get(url);
    const job = (async () => {
      if (active >= maxConcurrency) await new Promise(resolve => waiting.push(resolve)); else active++;
      try {
        let response;
        const alternate = fallbackUrl?.(url);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            response = await transport(attempt > 0 && alternate ? alternate : url, { responseType: 'stream', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
            if (response.status === 200) break;
            response.data.destroy();
            const error = new Error(`Cover server returned HTTP ${response.status}`);
            error.permanent = response.status < 500 && ![408, 429].includes(response.status) && !(alternate && attempt === 0);
            throw error;
          } catch (error) {
            if (error.permanent || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
        let data = await readBody(response.data, 12 * 1024 * 1024), type = imageType(data);
        if (type === 'image/heic') { data = await convert(data); type = imageType(data); }
        if (!type || type === 'image/heic') throw new Error('Unsupported cover image');
        const result = { data, type };
        remember(url, result);
        if (cacheDir) {
          const hash = crypto.createHash('sha256').update(url).digest('hex');
          Promise.all([
            fs.writeFile(path.join(cacheDir, `${hash}.bin`), data),
            fs.writeFile(path.join(cacheDir, `${hash}.json`), JSON.stringify({ type }), 'utf8')
          ]).catch(() => {});
        }
        return result;
      } finally { const next = waiting.shift(); if (next) next(); else active--; }
    })();
    pending.set(url, job);
    try { return await job; } finally { pending.delete(url); }
  }
  return { load };
}
module.exports = { imageType, convertHeic, createImageLoader };

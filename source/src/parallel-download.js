const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { setMaxListeners } = require('node:events');
const { getStream } = require('./http-stream');

// Returns false for streams or servers without reliable byte ranges. The caller
// can use FFmpeg's normal network input instead. Never exposes a partial file.
module.exports = async function parallelDownload(url, destination, { headers = {}, signal, onProgress = () => {}, onFallback = () => {}, connections = 16, request = getStream } = {}) {
  const controller = new AbortController();
  setMaxListeners(128, controller.signal);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const options = { responseType: 'stream', timeout: 25000, signal: controller.signal,
    headers: { ...headers, 'Accept-Encoding': 'identity' }, validateStatus: () => true };
  let created = false;
  try {
    const probe = await request(url, { ...options, headers: { ...options.headers, Range: 'bytes=0-0' } });
    probe.data.destroy();
    const match = /^bytes 0-0\/(\d+)$/.exec(probe.headers['content-range'] || '');
    const total = Number(match?.[1]);
    if (probe.status !== 206 || !Number.isSafeInteger(total) || total < 4 * 1024 * 1024 ||
        !/^video\/(?:mp4|webm)/i.test(probe.headers['content-type'] || '')) {
      onFallback({ code: 'RANGE_NOT_AVAILABLE', status: probe.status, contentType: probe.headers['content-type'], rangeValid: !!match });
      return false;
    }
    const validatorHeader = probe.headers.etag && !probe.headers.etag.startsWith('W/') ? 'etag' : 'last-modified';
    const validator = probe.headers[validatorHeader];
    const file = await fs.promises.open(destination, 'wx');
    created = true;
    try { await file.truncate(total); } finally { await file.close(); }
    let received = 0, lastUpdate = 0;
    const count = Math.max(1, Math.min(16, Math.floor(Number(connections) || 16), Math.floor(total / 1048576), Math.max(4, Math.floor(total / (8 * 1048576)))));
    const size = Math.ceil(total / count);
    let firstError;
    const jobs = Array.from({ length: count }, (_, index) => (async () => {
      const start = index * size, end = Math.min(total - 1, start + size - 1);
      const response = await request(url, { ...options, headers: { ...options.headers,
        Range: `bytes=${start}-${end}`, ...(validator ? { 'If-Range': validator } : {}) } });
      if (response.status !== 206 || response.headers['content-range'] !== `bytes ${start}-${end}/${total}` ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
          (validator && response.headers[validatorHeader] !== validator)) {
        response.data.destroy();
        throw new Error('Server changed or ignored the requested range');
      }
      let bytes = 0;
      response.data.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > end - start + 1) { response.data.destroy(new Error('Oversized range')); return; }
        received += chunk.length;
        if (Date.now() - lastUpdate >= 200) { lastUpdate = Date.now(); onProgress(received, total, count); }
      });
      await pipeline(response.data, fs.createWriteStream(destination, { flags: 'r+', start }), { signal: controller.signal });
      if (bytes !== end - start + 1) throw new Error('Incomplete range');
    })().catch(error => { if (!firstError) firstError = error; controller.abort(); throw error; }));
    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw firstError || failure.reason;
    onProgress(total, total, count);
    return true;
  } catch (error) {
    if (created) await fs.promises.unlink(destination).catch(() => {});
    if (signal?.aborted) throw error;
    onFallback({ code: error.code || error.name, message: error.message.replace(/https?:\/\/\S+/g, '[source]') });
    return false;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};

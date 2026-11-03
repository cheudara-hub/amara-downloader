const fs = require('fs/promises');
const path = require('path');

function imageExtension(data) {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'gif';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(data.toString('ascii', 8, 32))) return 'avif';
  return null;
}

module.exports = function createPosterSaver(axios, headers = {}, options = {}) {
  const pending = new Map();
  return function savePoster(directory, url) {
    if (!url) return Promise.resolve(null);
    const key = path.resolve(directory);
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      let temporary;
      try {
        if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported poster URL');
        await fs.mkdir(directory, { recursive: true });
        for (const base of ['poster', 'cover']) {
          for (const ext of ['jpg', 'png', 'webp', 'gif', 'avif']) {
            const file = path.join(directory, base + '.' + ext);
            try {
              if (imageExtension(await fs.readFile(file))) return file;
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
        }
        const requestHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          ...headers,
        };
        let response;
        if (options.loadImage) {
          response = { data: await options.loadImage(url) };
        } else {
          try {
            response = await axios.get(url, {
              responseType: 'arraybuffer', timeout: 20000,
              maxContentLength: 20 * 1024 * 1024, maxBodyLength: 20 * 1024 * 1024,
              headers: requestHeaders,
            });
          } catch (reqError) {
            if (requestHeaders.Referer) {
              const fallbackHeaders = { ...requestHeaders };
              delete fallbackHeaders.Referer;
              response = await axios.get(url, {
                responseType: 'arraybuffer', timeout: 20000,
                maxContentLength: 20 * 1024 * 1024, maxBodyLength: 20 * 1024 * 1024,
                headers: fallbackHeaders,
              });
            } else {
              throw reqError;
            }
          }
        }
        let data = Buffer.from(response.data);
        if (require('./pro-images').imageType(data) === 'image/heic') data = await require('./pro-images').convertHeic(data);
        const ext = imageExtension(data);
        if (!ext) throw new Error('Poster response is not a supported image');
        const target = path.join(directory, 'poster.' + ext);
        temporary = target + '.download';
        await fs.writeFile(temporary, data);
        await fs.rename(temporary, target);
        return target;
      } catch (error) {
        // A missing poster must not prevent episode downloads.
        console.warn('[Poster] Could not save poster:', error.message);
        return null;
      } finally {
        if (temporary) await fs.unlink(temporary).catch(() => {});
      }
    })();
    pending.set(key, job);
    job.finally(() => { if (pending.get(key) === job) pending.delete(key); });
    return job;
  };
};

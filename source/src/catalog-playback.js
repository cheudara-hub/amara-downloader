// Probe one real episode before adding a batch. Reuse that link for its first job.
function providerError(error) {
  if (error?.status >= 500 || /internal server error|video refused to load|request is.*cursed/i.test(error?.message || '')) {
    const result = new Error('The provider cannot return a video link for this title right now. Please retry later.');
    result.code = 'PROVIDER_VIDEO_UNAVAILABLE';
    return result;
  }
  return error;
}
module.exports = function catalogPlayback({ video, now = Date.now }) {
  const ready = new Map();
  const key = c => JSON.stringify([c.platform, String(c.dramaId), String(c.chapterId), c.lang || 'en']);
  async function request(catalog) {
    try {
      const result = await video(new URLSearchParams({ category_p: catalog.platform, id: catalog.dramaId, chapterId: catalog.chapterId, lang: catalog.lang || 'en' }).toString());
      const source = result.data?.streams?.[0];
      if (!result.success || !source?.url) throw new Error(result.error || result.message || 'This episode has no video link available from the provider.');
      return { url: source.url, referer: result.data?.streamHeaders?.Referer || result.data?.streamHeaders?.referer || new URL(source.url).origin + '/', headers: result.data?.streamHeaders || {} };
    } catch (error) { throw providerError(error); }
  }
  return {
    async probe(catalog) {
      const source = await request(catalog);
      ready.set(key(catalog), { source, expires: now() + 30000 });
      while (ready.size > 64) ready.delete(ready.keys().next().value);
    },
    async resolve(catalog) {
      const id = key(catalog), cached = ready.get(id);
      ready.delete(id);
      return cached && cached.expires > now() ? cached.source : request(catalog);
    },
  };
};
module.exports.providerError = providerError;
const groupKey = catalog => JSON.stringify([catalog.platform, catalog.dramaId, catalog.lang]);
async function checkGroups(tasks, probe) {
  const checked = new Map();
  for (const task of tasks) if (task.catalog) {
    const key = groupKey(task.catalog);
    if (!checked.has(key)) {
      try { await probe(task.catalog); checked.set(key, null); }
      catch (error) { checked.set(key, error); }
    }
  }
  return checked;
}
module.exports.groupKey = groupKey;
module.exports.checkGroups = checkGroups;

// Runs inside an unprivileged website frame. Keep this function self-contained.
function collectPage() {
  const absolute = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  const media = [];
  const add = (value, knownVideo = false) => { if (typeof value !== 'string' || !value.trim()) return; const u = absolute(value); if (u && !/(?:\/\/|\.)(?:ads?|adserver|doubleclick|googlesyndication)\.|\/(?:ads?|adverts?|preroll)\//i.test(u) && (knownVideo || /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(u)) && !media.includes(u)) media.push(u); };
  const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
  // Public OK.ru embeds expose signed, extensionless video URLs in JSON data-options.
  // Read the player's declared sources without evaluating scripts or deriving keys.
  document.querySelectorAll('[data-options]').forEach(el => {
    const options = parse(el.getAttribute('data-options'));
    const metadata = parse(options?.flashvars?.metadata || options?.metadata);
    if (!metadata || metadata.drm || metadata.drmInfo) return;
    const rank = { mobile: 0, lowest: 1, low: 2, sd: 3, hd: 4, full: 5, quad: 6, ultra: 7 };
    const videos = (Array.isArray(metadata.videos) ? metadata.videos : []).filter(v => !v.disallowed).sort((a,b) => (rank[b.name] ?? -1) - (rank[a.name] ?? -1));
    videos.forEach(video => add(video.url, true));
    add(metadata.hlsManifestUrl, true);
  });
  document.querySelectorAll('video, source').forEach(el => add(el.currentSrc || el.src, true));
  performance.getEntriesByType('resource').forEach(entry => add(entry.name));
  const playlistEntries = [];
  for (const script of document.scripts) {
    const text = script.textContent.replace(/\\\//g, '/');
    const playlist = /options\.player_list\s*=\s*(\[[\s\S]*?\])\s*;/.exec(text);
    if (playlist) {
      const items = parse(playlist[1].replace(/,\s*([\]}])/g, '$1'));
      if (Array.isArray(items)) playlistEntries.push(...items);
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>\\]*)?/gi)) add(match[0]);
  }
  const poster = absolute(document.querySelector('.entry-content .text-center img')?.src || document.querySelector('meta[property="og:image"]')?.content || document.querySelector('meta[name="twitter:image"]')?.content || document.querySelector('article img, .poster img, .thumbnail img, .entry-content img')?.src || '');
  const title = (document.querySelector('article h1, h1.entry-title, h1.post-title, .entry-title, h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title).trim().split(/\s+\|\s+/)[0];
  const episodes = [], seen = new Set();
  document.querySelectorAll('a[href], [data-video], [data-src], [data-file]').forEach(el => {
    const url = absolute(el.getAttribute('href') || el.dataset.video || el.dataset.src || el.dataset.file);
    if (!url || seen.has(url)) return;
    // Theme-based episode tables put the number, title, and release date in
    // separate columns. Read the number column instead of guessing from dates.
    const numberColumn = (el.querySelector?.('.epl-num, .episode-number, [data-episode-number], .playinfo span')?.textContent || '').trim();
    const rowNumber = Number(/^(?:(?:ep(?:isode)?s?)\.?\s*)?(\d{1,4})\b/i.exec(numberColumn)?.[1]) || 0;
    const label = (el.querySelector?.('.epl-title, .playinfo h3')?.textContent || el.textContent || el.title || '').trim().replace(/\s+/g, ' ');
    const container = el.closest('[class*="episode"], [id*="episode"], [class*="playlist"], [id*="playlist"], .videolist, #list_tap, .tab-eps, .video-epsx, .eplister, .eplist');
    const numbered = /(?:ep(?:isode)?\.?\s*|part\s*|ភាគ\s*|ตอน\s*)(\d+)/i.exec(label);
    const direct = /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(url);
    // A homepage card ending in “[EP 30]” describes a different show, not episode 30.
    if (!container && !direct && !/\/read\/\d+\/\d+/.test(url) && !/^(?:ep(?:isode)?\.?\s*|part\s*|ភាគ\s*|ตอน\s*)\d+/i.test(label)) return;
    if (!direct && !numbered && !(container && rowNumber) && !(container && /^\d{1,4}$/.test(label)) && !/\/read\/\d+\/\d+/.test(url)) return;
    if (/javascript:|#|\/album\//i.test(el.getAttribute('href') || '') && !direct) return;
    seen.add(url);
    const number = rowNumber || Number(numbered?.[1] || (/^\d+$/.test(label) ? label : /\/read\/\d+\/(\d+)/.exec(url)?.[1])) || episodes.length + 1;
    episodes.push({ url, title: label || `Episode ${number}`, number, direct });
  });
  for (const item of playlistEntries) {
    const url = absolute(item?.file);
    if (!url || seen.has(url)) continue;
    const label = String(item.title || '').trim();
    const number = Number(/^(\d{1,3})\s*[.\- ]/.exec(label)?.[1]) || episodes.length + 1;
    seen.add(url);
    episodes.push({ url, title: label || `Episode ${number}`, number, direct: /\.(mp4|m3u8|webm)(?:[?#]|$)/i.test(url), referer: location.href });
  }
  episodes.sort((a, b) => a.number - b.number);
  const players = Array.from(document.querySelectorAll('iframe[src]')).map(el => ({
    url: absolute(el.getAttribute('src')),
    inPlayer: !!el.closest?.('.player-embed, #pembed, #embed_holder, .video-player, .embed-responsive'),
  })).filter(item => item.url && (item.inPlayer || /(?:\/videoembed\/|\/embed\/|player|\/embedded-player)/i.test(item.url)) && !/doubleclick|googleads|adserver|googlesyndication|damrei/i.test(item.url)).map(item => item.url);
  const playerError = /(^|\.)ok\.ru$/i.test(new URL(location.href).hostname)
    ? (document.querySelector('.vp_video_stub_txt')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220) : '';
  const unavailable = /not (?:been )?found|blocked|deleted|removed|not available|unavailable|private|restricted/i.test(playerError) ? playerError : '';
  return { title, poster, url: location.href, episodes: episodes.slice(0, 500), media, players, unavailable };
}

function safeName(value) {
  const clean = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 100);
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? 'Untitled album' : clean;
}
function webUrl(value) {
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('Use an http or https link.');
  return u.href;
}
function mediaSources(result, fallbackReferer) {
  const urls = [...new Set(result?.media || [])];
  // Keep the player's quality ordering, but use complete files before HLS.
  urls.sort((a, b) => Number(/\.m3u8(?:[?#]|$)/i.test(a)) - Number(/\.m3u8(?:[?#]|$)/i.test(b)));
  return urls.map(url => ({ url, referer: result.sources?.find(source => source.url === url)?.referer || fallbackReferer }));
}
module.exports = { collectPage, safeName, webUrl, mediaSources };

// The renderer remains a local file, keeping saved lists stable across launches.
function desktopApiUrl(url) { return window.amaraDesktop.origin + url; }
function desktopImageUrl(url) {
  if (!url) return './assets/placeholder_drama.png';
  return /^https?:\/\//i.test(url) ? desktopApiUrl('/api/image?url=' + encodeURIComponent(url)) : url;
}
const browserFetch = window.fetch.bind(window);
window.fetch = (input, options) => browserFetch(typeof input === 'string' && input.startsWith('/api/') ? desktopApiUrl(input) : input, options);

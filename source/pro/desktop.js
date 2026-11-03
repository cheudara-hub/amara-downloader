// Desktop actions use the existing durable AMARA download queue.
async function desktopCall(command, payload) {
  try { return await window.amaraDesktop.call(command, payload); }
  catch (error) { showToast((error.message || 'Desktop action failed.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), 'fa-circle-exclamation'); throw error; }
}
function catalogPayload(drama, episodes) {
  return { platform: drama.platform || state.currentPlatform, dramaId: String(drama.id), title: drama.title, cover: drama.cover, lang: state.currentLang, episodes };
}
downloadEpisode = async function(drama, index, chapterId) {
  if (!drama) return;
  try {
    await window.amaraDownloads?.refresh();
    if (window.amaraDownloads?.has(drama, chapterId || index)) {
      showToast('Already downloaded. This episode is saved on your computer.', 'fa-circle-check'); return;
    }
    const result = await desktopCall('queue', catalogPayload(drama, [{ id: String(chapterId || index), index: Number(index) }]));
    showToast((result.count ? 'Episode added to Downloads.' : 'This episode is already in Downloads.') + (result.posterSaved ? ' Poster included.' : result.posterStatus === 'failed' ? ' Poster failed; retry it in Downloads.' : ' No poster available.'), 'fa-download');
  } catch {}
};
startBatchDownload = async function() {
  const start = Number(DOM.batchStartEp.value), end = Number(DOM.batchEndEp.value);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > currentBatchData.chapters.length || end < start) {
    showToast('Choose a valid episode range.', 'fa-circle-exclamation'); return;
  }
  DOM.btnStartBatchDownload.disabled = true;
  try {
    await window.amaraDownloads?.refresh();
    const selected = currentBatchData.chapters.slice(start - 1, end).map((ep, i) => ({ ...ep, index: ep.index || start + i }));
    const remaining = selected.filter(ep => !window.amaraDownloads?.has(currentBatchData.drama, ep.id));
    if (!remaining.length) { closeBatchModal(); showToast('Already downloaded. All selected episodes are saved.', 'fa-circle-check'); return; }
    const result = await desktopCall('queue', catalogPayload(currentBatchData.drama, remaining));
    closeBatchModal();
    showToast(`${result.count} episodes added to Downloads.` + (result.posterSaved ? ' Poster included.' : result.posterStatus === 'failed' ? ' Poster failed; retry it in Downloads.' : ' No poster available.'), 'fa-download');
    await desktopCall('downloads');
  } catch {} finally { DOM.btnStartBatchDownload.disabled = false; }
};
startBrowserBatchDownload = startBatchDownload;
openDownloadsFolder = () => desktopCall('downloads');
document.addEventListener('DOMContentLoaded', () => {
  const versionBadge = document.querySelector('.brand-badge');
  if (versionBadge && window.amaraDesktop.version) {
    versionBadge.textContent = 'v' + window.amaraDesktop.version;
    versionBadge.title = 'AMARA PRO DL v' + window.amaraDesktop.version;
    versionBadge.setAttribute('aria-label', versionBadge.title);
  }
  document.addEventListener('error', event => {
    const image = event.target;
    if (image.tagName === 'IMG' && !image.dataset.fallback) { image.dataset.fallback = 'true'; image.src = './assets/placeholder_drama.png'; }
  }, true);
  const navigation = document.querySelector('.desktop-nav');
  navigation.classList.remove('desktop-only'); navigation.classList.add('workspace-nav');
  navigation.setAttribute('aria-label', 'AMARA workspace');
  const bars = document.createElement('div'); bars.className = 'workspace-bars';
  document.querySelector('.app-header').after(bars); bars.append(navigation);
  const routes = { home: 'home', discover: 'discover', search: 'search', watchlist: 'watchlist' };
  navigation.querySelectorAll('[data-tab]').forEach(button => { button.dataset.route = routes[button.dataset.tab]; });
  const divider = document.createElement('span'); divider.className = 'workspace-nav-divider'; navigation.append(divider);
  for (const [route, label, icon] of [['hongguo','Hongguo','film'],['library','Library','folder-open'],['browser','Browser','globe'],['downloads','Downloads','download'],['add','Add downloads','plus'],['settings','Settings','gear']]) {
    const button = document.createElement('button'); button.className = 'nav-link'; button.dataset.route = route;
    button.innerHTML = `<i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${label}</span>`; navigation.append(button);
  }
  let syncing = false;
  const downloadTabs = document.createElement('div'); downloadTabs.className = 'download-source-tabs';
  downloadTabs.innerHTML = '<span>DOWNLOAD QUEUES</span><button data-source="downloads">Catalog &amp; browser</button><button data-source="transfers">Hongguo downloads</button>';
  bars.append(downloadTabs);
  // Keep every provider reachable, including on smaller desktop windows.
  const platformContainer = document.getElementById('platformBarContainer');
  const platformStrip = document.getElementById('platformBar');
  const platformLabel = document.createElement('span');
  platformLabel.className = 'platform-label'; platformLabel.textContent = 'PLATFORMS';
  platformContainer.prepend(platformLabel);
  const platformControls = document.createElement('div'); platformControls.className = 'platform-scroll-controls';
  platformControls.innerHTML = '<button type="button" aria-label="Previous platforms" title="Previous platforms"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><button type="button" aria-label="More platforms" title="More platforms"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
  platformContainer.append(platformControls);
  const [previousPlatforms, nextPlatforms] = platformControls.children;
  previousPlatforms.onclick = () => platformStrip.scrollBy({ left: -platformStrip.clientWidth * 0.7, behavior: 'smooth' });
  nextPlatforms.onclick = () => platformStrip.scrollBy({ left: platformStrip.clientWidth * 0.7, behavior: 'smooth' });
  function updatePlatformControls() {
    previousPlatforms.disabled = platformStrip.scrollLeft <= 2;
    nextPlatforms.disabled = platformStrip.scrollLeft + platformStrip.clientWidth >= platformStrip.scrollWidth - 2;
  }
  platformStrip.addEventListener('scroll', updatePlatformControls, { passive: true });
  new ResizeObserver(updatePlatformControls).observe(platformStrip);
  new MutationObserver(updatePlatformControls).observe(platformStrip, { childList: true });
  updatePlatformControls();
  downloadTabs.querySelectorAll('button').forEach(button => button.onclick = () => desktopCall('navigate', { route: button.dataset.source }).catch(() => {}));
  function applyRoute(route) {
    syncing = true;
    const catalog = ['home','discover','search','watchlist'].includes(route);
    document.body.classList.toggle('workspace-native', !catalog); document.body.dataset.workspaceRoute = route;
    if (catalog) navigation.querySelector(`[data-tab="${route}"]`)?.click();
    else { closePlayer(); closeDetailModal(); closeBatchModal(); }
    const mainRoute = route === 'transfers' ? 'downloads' : route;
    navigation.querySelectorAll('[data-route]').forEach(button => { button.classList.toggle('active', button.dataset.route === mainRoute); button.setAttribute('aria-current', button.dataset.route === mainRoute ? 'page' : 'false'); });
    downloadTabs.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.source === route));
    syncLayout();
    window.scrollTo(0, 0); syncing = false;
  }
  navigation.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => {
    if (!syncing) { applyRoute(button.dataset.route); desktopCall('navigate', { route: button.dataset.route }).catch(() => {}); }
  }));
  window.amaraDesktop.onRoute(applyRoute);
  function syncLayout() { desktopCall('layout', { top: bars.getBoundingClientRect().bottom }).catch(() => {}); }
  new ResizeObserver(syncLayout).observe(bars); syncLayout(); applyRoute('home');
  // Logo and keyboard search return to the shared catalog navigation.
  document.getElementById('brandLogoHome').addEventListener('click', () => desktopCall('navigate', { route: 'home' }).catch(() => {}));
  const language = document.createElement('select'); language.id = 'desktopLanguage'; language.title = 'Content language'; language.setAttribute('aria-label', 'Content language');
  for (const [code, label] of [['en','English'],['km','Khmer'],['zh','Chinese'],['id','Indonesian'],['th','Thai'],['vi','Vietnamese'],['es','Spanish'],['pt','Portuguese']]) {
    const option = document.createElement('option'); option.value = code; option.textContent = label; language.append(option);
  }
  language.value = localStorage.getItem('amara_content_language') || 'en';
  if (!language.value) language.value = 'en';
  state.currentLang = language.value;
  document.getElementById('langSelector').replaceChildren(language);
  language.onchange = async () => {
    state.currentLang = language.value;
    globalThis.amaraProviderPages?.invalidate();
    localStorage.setItem('amara_content_language', language.value);
    const tab = document.querySelector('.tab-content.active')?.id;
    await Promise.all([loadHomeData(state.currentPlatform), loadPopularTags()]);
    if (tab === 'tabDiscover') await loadDiscoverData(state.currentPlatform);
    if (tab === 'tabSearch' && DOM.mainSearchInput.value.trim()) await performSearch(DOM.mainSearchInput.value.trim());
  };
  const rangeHint = document.querySelector('.batch-location-hint');
  if (rangeHint) {
    rangeHint.replaceChildren();
    const label = document.createElement('span'); label.textContent = 'Episodes + movie poster saved together in your AMARA download folder. ';
    const choose = document.createElement('button'); choose.className = 'btn btn-sm'; choose.textContent = 'Choose folder';
    choose.onclick = async () => { try { const result = await desktopCall('folder'); label.textContent = result.folder + ' '; } catch {} };
    rangeHint.append(label, choose);
  }
  if (DOM.btnBrowserBatchDownload) DOM.btnBrowserBatchDownload.classList.add('hidden');
  document.title = 'AMARA PRO DL';
});

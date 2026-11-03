function readSaved(key) { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(item => !['quickplay_categories', 'quickplay_watchlist', 'quickplay_history'].includes(key) || !String(item?.platform || item?.name || '').startsWith('original-')) : []; } catch { return []; } }
/**
 * QuickPlay Web Application Client (English Edition)
 * Connects to the local QuickPlay API Gateway and renders the full streaming interface.
 */

// Application State
const state = {
  currentPlatform: 'dramabox',
  currentLang: 'en',
  categories: [],
  homeDramas: [],
  discoverDramas: [],
  searchResults: [],
  currentDrama: null,
  currentEpisodes: [],
  currentPlaying: {
    drama: null,
    episodeIndex: 1,
    chapterId: '1',
    streams: [],
    currentQuality: '1080p',
    currentStreamUrl: ''
  },
  watchlist: readSaved('quickplay_watchlist'),
  history: readSaved('quickplay_history')
};

// High-speed In-Memory UI Caches for 0ms Navigation
const clientCache = (typeof globalThis.clientCache !== 'undefined') ? globalThis.clientCache : {
  home: new Map(),
  discover: new Map(),
  detail: new Map(),
  tags: new Map()
};

// HLS.js video instance
let hlsInstance = null;
let playbackGeneration = 0;
let playbackTimer;
let playbackAttempt = 0;
let attemptedStreams = new Set();

function clearPlaybackTimer() {
  clearTimeout(playbackTimer);
  playbackTimer = null;
}

function failPlayback() {
  clearPlaybackTimer();
  const next = state.currentPlaying.streams.find(stream => !attemptedStreams.has(stream.url));
  if (next) {
    showToast('Stream stalled. Trying another quality...', 'fa-circle-exclamation');
    playStreamQuality(next.quality, true);
  } else {
    ++playbackAttempt;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    DOM.mainVideoPlayer.pause();
    DOM.mainVideoPlayer.removeAttribute('src');
    DOM.mainVideoPlayer.load();
    DOM.videoSpinner.classList.add('hidden');
    DOM.bigPlayIcon.classList.add('hidden');
    showToast('The provider streams could not be played. Reopen this episode to retry.', 'fa-circle-exclamation');
  }
}

function watchPlayback() {
  clearPlaybackTimer();
  const attempt = playbackAttempt;
  playbackTimer = setTimeout(() => {
    if (attempt === playbackAttempt && !DOM.playerOverlay.classList.contains('hidden')) failPlayback();
  }, 30000);
}

// DOM Element Selectors
const DOM = {
  platformBar: document.getElementById('platformBar'),
  heroBanner: document.getElementById('heroBanner'),
  heroBackdrop: document.getElementById('heroBackdrop'),
  heroTitle: document.getElementById('heroTitle'),
  heroEpisodes: document.getElementById('heroEpisodes'),
  heroViews: document.getElementById('heroViews'),
  heroCategory: document.getElementById('heroCategory'),
  heroSynopsis: document.getElementById('heroSynopsis'),
  btnHeroPlay: document.getElementById('btnHeroPlay'),
  btnHeroDetail: document.getElementById('btnHeroDetail'),
  btnHeroBookmark: document.getElementById('btnHeroBookmark'),
  gridPopular: document.getElementById('gridPopular'),
  gridLatest: document.getElementById('gridLatest'),
  sectionCountPopular: document.getElementById('sectionCountPopular'),
  currentPlatformName: document.querySelectorAll('.current-platform-name'),

  // Tabs
  tabs: document.querySelectorAll('.tab-content'),
  navLinks: document.querySelectorAll('.nav-link'),
  mobileNavItems: document.querySelectorAll('.mobile-nav-item'),

  // Discover
  selectDiscoverPlatform: document.getElementById('selectDiscoverPlatform'),
  gridDiscover: document.getElementById('gridDiscover'),

  // Search
  mainSearchInput: document.getElementById('mainSearchInput'),
  headerSearchInput: document.getElementById('headerSearchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),
  popularTagsCloud: document.getElementById('popularTagsCloud'),
  gridSearch: document.getElementById('gridSearch'),
  searchResultCountText: document.getElementById('searchResultCountText'),

  // Watchlist & History
  gridWatchlist: document.getElementById('gridWatchlist'),
  pillWatchlist: document.getElementById('pillWatchlist'),
  pillHistory: document.getElementById('pillHistory'),
  savedCount: document.getElementById('savedCount'),
  historyCount: document.getElementById('historyCount'),

  // Modal Detail
  modalDetailOverlay: document.getElementById('modalDetailOverlay'),
  btnCloseDetailModal: document.getElementById('btnCloseDetailModal'),
  detailBackdrop: document.getElementById('detailBackdrop'),
  detailPoster: document.getElementById('detailPoster'),
  detailPlatform: document.getElementById('detailPlatform'),
  detailStatus: document.getElementById('detailStatus'),
  detailTitle: document.getElementById('detailTitle'),
  detailAuthor: document.getElementById('detailAuthor'),
  detailViews: document.getElementById('detailViews'),
  detailEpisodesTotal: document.getElementById('detailEpisodesTotal'),
  detailTagsCloud: document.getElementById('detailTagsCloud'),
  detailSynopsis: document.getElementById('detailSynopsis'),
  btnDetailPlayFirst: document.getElementById('btnDetailPlayFirst'),
  btnDetailDownloadFirst: document.getElementById('btnDetailDownloadFirst'),
  btnDetailDownloadAll: document.getElementById('btnDetailDownloadAll'),
  btnDetailDownloadAllCount: document.getElementById('btnDetailDownloadAllCount'),
  btnHeaderDownloadAll: document.getElementById('btnHeaderDownloadAll'),
  btnDetailBookmark: document.getElementById('btnDetailBookmark'),
  episodesCountBadge: document.getElementById('episodesCountBadge'),
  episodesStatusNote: document.getElementById('episodesStatusNote'),
  episodesGrid: document.getElementById('episodesGrid'),

  // Batch Downloader Modal
  modalBatchOverlay: document.getElementById('modalBatchOverlay'),
  btnCloseBatchModal: document.getElementById('btnCloseBatchModal'),
  btnCancelBatchModal: document.getElementById('btnCancelBatchModal'),
  batchDramaTitle: document.getElementById('batchDramaTitle'),
  batchDramaPoster: document.getElementById('batchDramaPoster'),
  batchPlatformBadge: document.getElementById('batchPlatformBadge'),
  batchStatusBadge: document.getElementById('batchStatusBadge'),
  batchEpisodesAvailableText: document.getElementById('batchEpisodesAvailableText'),
  batchSeriesNote: document.getElementById('batchSeriesNote'),
  batchSelectionBox: document.getElementById('batchSelectionBox'),
  batchStartEp: document.getElementById('batchStartEp'),
  batchEndEp: document.getElementById('batchEndEp'),
  btnBatchSelectAll: document.getElementById('btnBatchSelectAll'),
  batchCountSpan: document.getElementById('batchCountSpan'),
  batchProgressBox: document.getElementById('batchProgressBox'),
  batchProgressStatusText: document.getElementById('batchProgressStatusText'),
  batchProgressPercentText: document.getElementById('batchProgressPercentText'),
  batchProgressBarFill: document.getElementById('batchProgressBarFill'),
  batchCurrentFileText: document.getElementById('batchCurrentFileText'),
  batchSaveLocationText: document.getElementById('batchSaveLocationText'),
  batchCompletedBox: document.getElementById('batchCompletedBox'),
  batchCompletedSummary: document.getElementById('batchCompletedSummary'),
  btnOpenDownloadsFolder: document.getElementById('btnOpenDownloadsFolder'),
  batchModalActions: document.getElementById('batchModalActions'),
  btnStartBatchDownload: document.getElementById('btnStartBatchDownload'),
  btnBrowserBatchDownload: document.getElementById('btnBrowserBatchDownload'),
  batchBtnCount: document.getElementById('batchBtnCount'),

  // Video Player
  playerOverlay: document.getElementById('playerOverlay'),
  mainVideoPlayer: document.getElementById('mainVideoPlayer'),
  btnClosePlayer: document.getElementById('btnClosePlayer'),
  playerDramaTitle: document.getElementById('playerDramaTitle'),
  playerEpisodeTitle: document.getElementById('playerEpisodeTitle'),
  btnToggleEpisodeList: document.getElementById('btnToggleEpisodeList'),
  videoWrapper: document.getElementById('videoWrapper'),
  videoSpinner: document.getElementById('videoSpinner'),
  bigPlayIcon: document.getElementById('bigPlayIcon'),
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressBuffered: document.getElementById('progressBuffered'),
  progressFilled: document.getElementById('progressFilled'),
  progressThumb: document.getElementById('progressThumb'),
  btnPlayPause: document.getElementById('btnPlayPause'),
  btnPrevEpisode: document.getElementById('btnPrevEpisode'),
  btnNextEpisode: document.getElementById('btnNextEpisode'),
  btnDownloadPlayer: document.getElementById('btnDownloadPlayer'),
  currentTimeText: document.getElementById('currentTimeText'),
  durationTimeText: document.getElementById('durationTimeText'),
  dropdownQuality: document.getElementById('dropdownQuality'),
  btnQuality: document.getElementById('btnQuality'),
  menuQuality: document.getElementById('menuQuality'),
  currentQualityText: document.getElementById('currentQualityText'),
  dropdownSpeed: document.getElementById('dropdownSpeed'),
  btnSpeed: document.getElementById('btnSpeed'),
  menuSpeed: document.getElementById('menuSpeed'),
  currentSpeedText: document.getElementById('currentSpeedText'),
  btnFullscreen: document.getElementById('btnFullscreen'),
  episodeDrawer: document.getElementById('episodeDrawer'),
  btnCloseEpisodeDrawer: document.getElementById('btnCloseEpisodeDrawer'),
  drawerEpisodesList: document.getElementById('drawerEpisodesList'),

  // Toast
  toastContainer: document.getElementById('toastContainer'),
  btnRefreshData: document.getElementById('btnRefreshData'),
  brandLogoHome: document.getElementById('brandLogoHome')
};

const EXCLUDED_PLATFORMS = new Set(['yellowreels', 'huangguo', 'hongguo', 'microdrama']);

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupEventListeners();
  updateWatchlistCounts();
  const savedCats = readSaved('quickplay_categories').filter(cat => !EXCLUDED_PLATFORMS.has(String(cat?.name || '').toLowerCase()));
  if (savedCats.length > 0) {
    state.categories = savedCats;
    renderPlatformBar();
    populateDiscoverDropdown();
  }
  await loadCategories();
  await loadHomeData(state.currentPlatform);
  await loadPopularTags();
});

// Toast Notifications
function showToast(message, icon = 'fa-circle-check') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// Navigation & Tab Switching
function setupNavigation() {
  const switchTab = (tabId) => {
    DOM.tabs.forEach(tab => tab.classList.remove('active'));
    DOM.navLinks.forEach(link => link.classList.remove('active'));
    DOM.mobileNavItems.forEach(item => item.classList.remove('active'));

    const targetTab = document.getElementById(`tab${capitalize(tabId)}`);
    if (targetTab) targetTab.classList.add('active');

    document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabId === 'watchlist') renderWatchlist();
    if (tabId === 'discover') loadDiscoverData(state.currentPlatform);
  };

  DOM.navLinks.forEach(link => {
    link.addEventListener('click', () => switchTab(link.getAttribute('data-tab')));
  });

  DOM.mobileNavItems.forEach(item => {
    item.addEventListener('click', () => switchTab(item.getAttribute('data-tab')));
  });

  DOM.brandLogoHome.addEventListener('click', () => switchTab('home'));
}

// Load Categories / Platforms
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const json = await res.json();
    if (json.success && Array.isArray(json.data) && json.data.length > 0) {
      const activeCategories = json.data.filter(cat => cat.is_active !== false && !EXCLUDED_PLATFORMS.has(String(cat?.name || '').toLowerCase()));
      state.categories = activeCategories;
      try { localStorage.setItem('quickplay_categories', JSON.stringify(activeCategories)); } catch (_) {}
      if (state.currentPlatform && !activeCategories.some(cat => cat.name === state.currentPlatform)) {
        const fallback = activeCategories[0];
        if (fallback) {
          selectPlatform(fallback.name, fallback.display_name);
          return;
        }
      }
      renderPlatformBar();
      populateDiscoverDropdown();
    }
  } catch (err) {
    console.error('Error loading categories:', err);
  }
}

// Render Platform Bar
function renderPlatformBar() {
  DOM.platformBar.innerHTML = '';
  state.categories.forEach(cat => {
    if (EXCLUDED_PLATFORMS.has(String(cat?.name || '').toLowerCase())) return;
    const pill = document.createElement('div');
    pill.className = `platform-pill ${cat.name === state.currentPlatform ? 'active' : ''}`;
    pill.dataset.platform = cat.name; pill.tabIndex = 0; pill.setAttribute('role', 'button'); pill.onkeydown = e => { if (e.key === 'Enter') pill.click(); };

    const logoUrl = cat.logo_url || `./assets/placeholder_drama.png`;
    pill.innerHTML = `
      <img src="${logoUrl}" alt="${escapeHtml(cat.display_name)}" />
      <span>${escapeHtml(cat.display_name)}</span>
    `;

    pill.addEventListener('click', () => selectPlatform(cat.name, cat.display_name));
    DOM.platformBar.appendChild(pill);
  });
}

function populateDiscoverDropdown() {
  DOM.selectDiscoverPlatform.innerHTML = '';
  state.categories.forEach(cat => {
    if (EXCLUDED_PLATFORMS.has(String(cat?.name || '').toLowerCase())) return;
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = `${escapeHtml(cat.display_name)} (${cat.name})`;
    if (cat.name === state.currentPlatform) opt.selected = true;
    DOM.selectDiscoverPlatform.appendChild(opt);
  });
}

// Select Active Platform
async function selectPlatform(platformName, displayName) {
  state.currentPlatform = platformName;
  globalThis.amaraProviderPages?.invalidate();
  document.querySelectorAll('.platform-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.platform === platformName);
  });
  DOM.currentPlatformName.forEach(el => el.textContent = displayName || capitalize(platformName));
  if (DOM.selectDiscoverPlatform) DOM.selectDiscoverPlatform.value = platformName;

  DOM.sectionCountPopular.textContent = '';
  if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';

  showToast(`Switched to ${displayName || capitalize(platformName)}`, 'fa-layer-group');
  await Promise.all([loadHomeData(platformName), loadPopularTags()]);
}

const catalogRequests = { home: 0, discover: 0, tags: 0, search: 0 };

// Load Home Data
async function loadHomeData(platform) {
  globalThis.amaraProviderPages?.begin('home');
  const request = ++catalogRequests.home, lang = state.currentLang;
  const current = () => request === catalogRequests.home && platform === state.currentPlatform && lang === state.currentLang;
  
  const cacheKey = `${platform}:${lang}`;
  const cached = (typeof clientCache !== 'undefined') ? clientCache.home?.get(cacheKey) : null;
  if (cached && Array.isArray(cached) && cached.length > 0) {
    state.homeDramas = cached;
    DOM.sectionCountPopular.textContent = `${cached.length} Dramas`;
    renderHeroBanner(cached[0]);
    renderDramaGrid(DOM.gridPopular, cached.slice(0, 12));
    renderDramaGrid(DOM.gridLatest, cached.slice(12));
  } else {
    DOM.sectionCountPopular.textContent = '';
    if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';
    DOM.gridPopular.innerHTML = `<div class="spinner-ring" style="grid-column: 1/-1; margin: 40px auto;"></div>`;
    DOM.gridLatest.innerHTML = '';
  }

  try {
    const res = await fetch(`/api/home?category_p=${platform}&lang=${state.currentLang}`);
    const json = await res.json();
    if (!current()) return;

    if (!json.success) {
      if (!cached) {
        DOM.sectionCountPopular.textContent = '0 Dramas';
        if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';
        const isMaintenance = json.code === 'PLATFORM_MAINTENANCE' || /maintenance/i.test(json.message || json.error || '');
        const message = isMaintenance
          ? `${capitalize(platform)} is currently under maintenance by the provider. Please select another platform.`
          : (json.error || json.message || 'No dramas available for this platform right now.');
        const icon = isMaintenance ? 'fa-wrench' : 'fa-circle-exclamation';
        DOM.gridPopular.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 48px 20px; color:#a0aec0;">
          <div style="font-size: 36px; margin-bottom: 12px; color: ${isMaintenance ? '#f6ad55' : '#e53e3e'};"><i class="fa-solid ${icon}"></i></div>
          <p style="font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px;">${isMaintenance ? 'Platform Under Maintenance' : 'Failed to Load Dramas'}</p>
          <p style="font-size: 13px; color: #a0aec0; max-width: 480px; margin: 0 auto;">${message}</p>
        </div>`;
      }
      return;
    }

    let dramas = [];
    if (json.data) {
      if (Array.isArray(json.data)) dramas = json.data;
      else if (typeof json.data === 'object') {
        if (Array.isArray(json.data.popular)) dramas = json.data.popular;
        else dramas = Object.values(json.data);
      }
    }

    globalThis.amaraProviderPages?.received('home', json, dramas);
    if (dramas.length > 0) {
      if (typeof clientCache !== 'undefined') clientCache.home?.set(cacheKey, dramas);
      state.homeDramas = dramas;
      DOM.sectionCountPopular.textContent = `${dramas.length} Dramas`;
      renderHeroBanner(dramas[0]);
      renderDramaGrid(DOM.gridPopular, dramas.slice(0, 12));
      renderDramaGrid(DOM.gridLatest, dramas.slice(12));
    } else if (!cached) {
      DOM.sectionCountPopular.textContent = '0 Dramas';
      if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';
      DOM.gridPopular.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#718096; padding: 40px 0;">No dramas available for this platform right now.</p>`;
    }
  } catch (err) {
    if (!current()) return;
    if (!cached) {
      console.error('Error loading home data:', err);
      DOM.sectionCountPopular.textContent = '0 Dramas';
      if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';
      const isMaintenance = /maintenance/i.test(err.message || '');
      DOM.gridPopular.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 48px 20px; color:#e53e3e;">
        <div style="font-size: 36px; margin-bottom: 12px; color: ${isMaintenance ? '#f6ad55' : '#e53e3e'};"><i class="fa-solid ${isMaintenance ? 'fa-wrench' : 'fa-triangle-exclamation'}"></i></div>
        <p style="font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px;">${isMaintenance ? 'Platform Under Maintenance' : 'Failed to Load Dramas'}</p>
        <p style="font-size: 13px; color: #a0aec0;">${err.message || 'Network error connecting to provider.'}</p>
      </div>`;
    }
  }
}

// Render Hero Banner
function renderHeroBanner(drama) {
  if (!drama) {
    if (DOM.heroBanner?.style) DOM.heroBanner.style.display = 'none';
    return;
  }
  if (DOM.heroBanner?.style) DOM.heroBanner.style.display = '';
  DOM.heroBackdrop.style.backgroundImage = `url(${JSON.stringify(desktopImageUrl(drama.cover))})`;
  DOM.heroTitle.textContent = drama.title;
  const epCounts = readSaved('quickplay_ep_counts') || {};
  const heroEpNum = (drama.chapters && drama.chapters > 0) ? drama.chapters : epCounts[drama.id];
  if (heroEpNum) drama.chapters = heroEpNum;
    DOM.heroEpisodes.innerHTML = `<i class="fa-solid fa-film"></i> ${heroEpNum ? heroEpNum + ' Ep' : (drama.status === 'Ongoing' ? 'Ongoing' : 'Complete Ep')}`;
  DOM.heroViews.innerHTML = `<i class="fa-solid fa-eye"></i> ${drama.views || '?'} Views`;
  DOM.heroCategory.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${drama.author || capitalize(state.currentPlatform)}`;
  DOM.heroSynopsis.textContent = drama.synopsis || 'Enjoy the best trending short dramas with high-definition streaming and captivating storylines.';

  // Hero Play Button
  DOM.btnHeroPlay.onclick = async () => {
    await openDramaDetail(drama);
    const episode = state.currentEpisodes[0];
    if (episode) { closeDetailModal(); openDramaPlayer(drama, episode.index || 1, episode.id); }
  };
  DOM.btnHeroDetail.onclick = () => openDramaDetail(drama);

  // Bookmark toggle
  const isSaved = state.watchlist.some(w => w.id === drama.id && w.platform === state.currentPlatform);
  updateBookmarkIcon(DOM.btnHeroBookmark, isSaved);
  DOM.btnHeroBookmark.onclick = () => toggleBookmark(drama, DOM.btnHeroBookmark);
}

const enrichingQueue = new Set();
function enrichDramaEpisodeCounts(dramas) {
  if (!Array.isArray(dramas) || !dramas.length) return;
  const epCounts = readSaved('quickplay_ep_counts') || {};
  const needed = dramas.filter(d => (!d.chapters || d.chapters === 0) && !epCounts[d.id] && !enrichingQueue.has(d.id));
  if (!needed.length) return;

  needed.forEach(d => enrichingQueue.add(d.id));
  const queue = [...needed];
  const maxConcurrent = 4;
  let running = 0;

  function next() {
    while (running < maxConcurrent && queue.length) {
      const drama = queue.shift();
      running++;
      const platform = drama.platform || state.currentPlatform;
      fetch(`/api/detail?category_p=${platform}&id=${drama.id}&lang=${state.currentLang}`)
        .then(res => res.json())
        .then(json => {
          const total = parseInt(json.data?.total_episodes) || (Array.isArray(json.data?.chapters) ? json.data.chapters.length : 0);
          if (total > 0) {
            drama.chapters = total;
            epCounts[drama.id] = total;
            try { localStorage.setItem('quickplay_ep_counts', JSON.stringify(epCounts)); } catch (_) {}
            document.querySelectorAll(`.card-badge-ep-${drama.id}`).forEach(badge => {
              badge.textContent = `${total} Ep`;
            });
            if (DOM.heroTitle?.textContent === drama.title && DOM.heroEpisodes) {
              DOM.heroEpisodes.innerHTML = `<i class="fa-solid fa-film"></i> ${total} Ep`;
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          enrichingQueue.delete(drama.id);
          running--;
          next();
        });
    }
  }
  next();
}

// Render Drama Card Grid
function renderDramaGrid(container, dramas) {
  container.innerHTML = '';
  const epCounts = readSaved('quickplay_ep_counts') || {};

  dramas.forEach(drama => {
    const card = document.createElement('div');
    card.className = 'drama-card'; card.tabIndex = 0; card.setAttribute('role', 'button'); card.onkeydown = e => { if (e.key === 'Enter') card.click(); };
    card.dataset.providerTitle = String(drama.id);
    const coverUrl = desktopImageUrl(drama.cover);
    const platformDisplay = drama.author || capitalize(state.currentPlatform);
    
    let epNum = (drama.chapters && drama.chapters > 0) ? drama.chapters : epCounts[drama.id];
    if (epNum) drama.chapters = epNum;
    const episodesText = epNum ? `${epNum} Ep` : (drama.status === 'Ongoing' ? 'Ongoing' : 'Episodes');

    card.innerHTML = `
      <div class="card-poster-wrap">
        <img src="${coverUrl}" alt="${escapeHtml(drama.title)}" class="card-poster" loading="lazy" />
        <div class="card-overlay">
          <div class="card-top-badges">
            <span class="card-badge badge-platform-tag">${platformDisplay}</span>
            <span class="card-badge badge-episodes card-badge-ep-${drama.id}">${episodesText}</span>
          </div>
          <div class="card-bottom-info">
            <span><i class="fa-solid fa-eye"></i> ${drama.views || '?'}</span>
            <span><i class="fa-solid fa-star" style="color:var(--accent-gold);"></i> ${drama.rating || '?'}</span>
          </div>
        </div>
      </div>
      <div class="card-content">
        <h3 class="card-title">${escapeHtml(drama.title)}</h3>
        <div class="card-tags">
          ${(drama.tags || ['Drama', 'Romance']).slice(0, 2).map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
    `;

    window.amaraDownloads?.card(card, drama);
    card.addEventListener('click', () => openDramaDetail(drama));
    container.appendChild(card);
  });

  enrichDramaEpisodeCounts(dramas);
}

function updateDetailBookmark(saved) {
  const button = DOM.btnDetailBookmark;
  button.innerHTML = `<i class="${saved ? 'fa-solid' : 'fa-regular'} fa-bookmark" aria-hidden="true"></i>`;
  button.setAttribute('aria-pressed', String(saved));
  button.title = saved ? 'Remove from My List' : 'Save to My List';
  button.setAttribute('aria-label', button.title);
}

// Open Drama Detail Modal
async function openDramaDetail(drama) {
  if (drama.platform) state.currentPlatform = drama.platform;
  state.currentDrama = drama;
  state.currentEpisodes = [];
  const plannedTotal = parseInt(drama.chapters || drama.total_episodes) || 0;

  DOM.detailBackdrop.style.backgroundImage = `url(${JSON.stringify(desktopImageUrl(drama.cover))})`;
  DOM.detailPoster.src = desktopImageUrl(drama.cover);
  DOM.detailTitle.textContent = drama.title;
  DOM.detailPlatform.textContent = drama.author || capitalize(state.currentPlatform);
  DOM.detailStatus.textContent = drama.status || 'Available';
  window.amaraDownloads?.detail();
  DOM.detailAuthor.innerHTML = `<i class="fa-solid fa-user-pen"></i> ${drama.author || capitalize(state.currentPlatform)}`;
  DOM.detailViews.innerHTML = `<i class="fa-solid fa-eye"></i> ${drama.views || '?'} Views`;
  DOM.detailEpisodesTotal.innerHTML = `<i class="fa-solid fa-list-ol"></i> ${plannedTotal ? plannedTotal + ' Episodes' : '--'}`;
  DOM.detailSynopsis.textContent = drama.synopsis || 'Synopsis is currently not available for this title.';

  // Tags
  DOM.detailTagsCloud.innerHTML = (drama.tags || ['Popular', 'Recommended']).map(t =>
    `<span class="tag-chip">${escapeHtml(t)}</span>`
  ).join('');

  // Bookmark icon
  const isSaved = state.watchlist.some(w => w.id === drama.id && w.platform === state.currentPlatform);
  updateDetailBookmark(isSaved);
  DOM.btnDetailBookmark.onclick = () => {
    toggleBookmark(drama);
    const nowSaved = state.watchlist.some(w => w.id === drama.id && w.platform === state.currentPlatform);
    updateDetailBookmark(nowSaved);
  };

  DOM.modalDetailOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const detailCacheKey = `${state.currentPlatform}:${drama.id}:${state.currentLang}`;
  const cachedDetail = (typeof clientCache !== 'undefined') ? clientCache.detail?.get(detailCacheKey) : null;

  function applyDetailData(json) {
    if (!json || !json.data) return false;
    const data = json.data;
    if (data.synopsis) DOM.detailSynopsis.textContent = data.synopsis;
    if (data.status) DOM.detailStatus.textContent = data.status;
    if (data.author) DOM.detailAuthor.innerHTML = `<i class="fa-solid fa-user-pen"></i> ${escapeHtml(data.author)}`;
    if (data.views != null && data.views !== '0') DOM.detailViews.innerHTML = `<i class="fa-solid fa-eye"></i> ${data.views} Views`;
    if (Array.isArray(data.tags) && data.tags.length > 0) {
      DOM.detailTagsCloud.innerHTML = data.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
    }

    const chapters = Array.isArray(data.chapters) && data.chapters.length > 0 ? data.chapters : null;
    if (chapters) {
      chapters.forEach((ch, idx) => {
        if (typeof ch.index !== 'number' || isNaN(ch.index) || ch.index <= 0 || ch.index > chapters.length + 50) {
          ch.index = idx + 1;
        }
        if (state.currentPlatform === 'moboreels' || (typeof ch.id === 'string' && ch.id.length > 10 && /^\d+$/.test(ch.id))) {
          if (state.currentPlatform === 'moboreels') {
            ch.id = String(idx + 1);
          }
        }
      });
      const releasedCount = chapters.length;
      state.currentEpisodes = chapters;
      renderEpisodesGrid(chapters);

      // Cache episode count for cards and badges
      drama.chapters = releasedCount;
      const epCounts = readSaved('quickplay_ep_counts') || {};
      epCounts[drama.id] = releasedCount;
      try { localStorage.setItem('quickplay_ep_counts', JSON.stringify(epCounts)); } catch (_) {}
      document.querySelectorAll(`.card-badge-ep-${drama.id}`).forEach(badge => {
        badge.textContent = `${releasedCount} Ep`;
      });
      if (DOM.heroTitle?.textContent === drama.title && DOM.heroEpisodes) {
        DOM.heroEpisodes.innerHTML = `<i class="fa-solid fa-film"></i> ${releasedCount} Ep`;
      }

      if (plannedTotal > releasedCount) {
        DOM.detailEpisodesTotal.innerHTML = `<i class="fa-solid fa-list-ol"></i> ${releasedCount} / ${plannedTotal} Released <span class="badge-status-ongoing">Ongoing</span>`;
        DOM.episodesCountBadge.textContent = `${releasedCount} Released (${plannedTotal} Planned)`;
        if (DOM.episodesStatusNote) {
          DOM.episodesStatusNote.classList.remove('hidden');
          DOM.episodesStatusNote.innerHTML = `
            <i class="fa-solid fa-circle-info" style="font-size:1.15rem; margin-top:2px; color:#f5a623; flex-shrink:0;"></i>
            <div>
              <strong>Ongoing Series (${releasedCount} of ${plannedTotal} Episodes Released):</strong>
              The studio has released episodes 1 to ${releasedCount} so far. Episodes ${releasedCount + 1} to ${plannedTotal} will automatically appear here as soon as they are uploaded by the provider.
            </div>
          `;
        }
      } else {
        DOM.detailEpisodesTotal.innerHTML = `<i class="fa-solid fa-list-ol"></i> ${releasedCount} Episodes`;
        DOM.episodesCountBadge.textContent = `${releasedCount} Episodes`;
        if (DOM.episodesStatusNote) DOM.episodesStatusNote.classList.add('hidden');
      }

      if (DOM.btnDetailDownloadAllCount) DOM.btnDetailDownloadAllCount.textContent = releasedCount;
      if (DOM.btnDetailDownloadAll) {
        DOM.btnDetailDownloadAll.onclick = () => openBatchModal(drama, chapters, plannedTotal);
      }
      if (DOM.btnHeaderDownloadAll) {
        DOM.btnHeaderDownloadAll.onclick = () => openBatchModal(drama, chapters, plannedTotal);
      }

      DOM.btnDetailPlayFirst.onclick = () => {
        closeDetailModal();
        const firstCh = chapters[0];
        openDramaPlayer(drama, 1, firstCh.id);
      };
      DOM.btnDetailDownloadFirst.onclick = () => {
        const firstCh = chapters[0];
        downloadEpisode(drama, 1, firstCh.id);
      };
      return true;
    }

    const totalCount = parseInt(data.total_episodes) || 0;
    if (totalCount > 0) {
      const synthetic = Array.from({ length: totalCount }, (_, i) => ({
        id: String(i + 1),
        index: i + 1,
        title: `Episode ${i + 1}`
      }));
      state.currentEpisodes = synthetic;
      renderEpisodesGrid(synthetic);
      DOM.detailEpisodesTotal.innerHTML = `<i class="fa-solid fa-list-ol"></i> ${totalCount} Episodes`;
      DOM.episodesCountBadge.textContent = `${totalCount} Episodes`;
      if (DOM.episodesStatusNote) DOM.episodesStatusNote.classList.add('hidden');
      if (DOM.btnDetailDownloadAllCount) DOM.btnDetailDownloadAllCount.textContent = totalCount;
      if (DOM.btnDetailDownloadAll) DOM.btnDetailDownloadAll.onclick = () => openBatchModal(drama, synthetic, totalCount);
      if (DOM.btnHeaderDownloadAll) DOM.btnHeaderDownloadAll.onclick = () => openBatchModal(drama, synthetic, totalCount);
      DOM.btnDetailPlayFirst.onclick = () => { closeDetailModal(); openDramaPlayer(drama, 1, '1'); };
      DOM.btnDetailDownloadFirst.onclick = () => downloadEpisode(drama, 1, '1');
      return true;
    }

    state.currentEpisodes = [];
    DOM.episodesCountBadge.textContent = 'Awaiting Links';
    if (DOM.episodesStatusNote) DOM.episodesStatusNote.classList.add('hidden');

    let altSearchQuery = drama.title;
    try {
      const coverMatch = (drama.cover || '').match(/\/convert\/([^/]+)\//);
      if (coverMatch && coverMatch[1]) {
        const decoded = decodeURIComponent(coverMatch[1]).replace(/_sq_/g, "'").replace(/_/g, ' ').trim();
        if (decoded && decoded !== drama.title) altSearchQuery = decoded;
      }
    } catch (_) {}

    DOM.episodesGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 22px 18px; background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.15); border-radius: 12px; text-align: center; margin: 8px 0;">
        <i class="fa-solid fa-clock-rotate-left" style="font-size: 1.8rem; color: #f5a623; margin-bottom: 10px; display: inline-block;"></i>
        <div style="font-weight: 600; font-size: 1rem; color: #f8fafc; margin-bottom: 6px;">Provider Episodes Awaiting Indexing</div>
        <p style="color: #94a3b8; font-size: 0.82rem; margin: 0 auto 16px; max-width: 440px; line-height: 1.5;">
          ${escapeHtml(drama.title)} is cataloged on ${escapeHtml(capitalize(state.currentPlatform))}, but the provider has not yet populated direct stream chapters. You can probe Episode 1 directly or search all other platforms for alternate uploads.
        </p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button id="btnSearchOtherPlatforms" class="btn-primary" style="padding: 8px 18px; font-size: 0.85rem; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-magnifying-glass"></i> Search Other Platforms
          </button>
          <button id="btnProbeEpisode1" class="btn-secondary" style="padding: 8px 18px; font-size: 0.85rem; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff;">
            <i class="fa-solid fa-play"></i> Probe Episode 1
          </button>
        </div>
      </div>
    `;

    const btnSearch = document.getElementById('btnSearchOtherPlatforms');
    if (btnSearch) {
      btnSearch.onclick = () => {
        closeDetailModal();
        switchTab('search');
        if (DOM.mainSearchInput) {
          DOM.mainSearchInput.value = altSearchQuery;
          performSearch(altSearchQuery);
        }
      };
    }

    const btnProbe = document.getElementById('btnProbeEpisode1');
    if (btnProbe) {
      btnProbe.onclick = () => {
        closeDetailModal();
        openDramaPlayer(drama, 1, '1');
      };
    }

    DOM.btnDetailPlayFirst.onclick = () => {
      closeDetailModal();
      openDramaPlayer(drama, 1, '1');
    };
    DOM.btnDetailDownloadFirst.onclick = () => downloadEpisode(drama, 1, '1');
    DOM.btnDetailDownloadAll.onclick = () => showToast('No released episodes available from provider yet.', 'fa-circle-exclamation');
    DOM.btnHeaderDownloadAll.onclick = DOM.btnDetailDownloadAll.onclick;
    return false;
  }

  if (cachedDetail) {
    applyDetailData(cachedDetail);
  } else {
    DOM.episodesGrid.innerHTML = `<div class="spinner-ring" style="grid-column: 1/-1; margin: 20px auto;"></div>`;
  }

  try {
    const res = await fetch(`/api/detail?category_p=${state.currentPlatform}&id=${drama.id}&lang=${state.currentLang}`);
    const json = await res.json();
    if (json.success && json.data) {
      if (typeof clientCache !== 'undefined') clientCache.detail?.set(detailCacheKey, json);
      applyDetailData(json);
    } else if (!cachedDetail) {
      DOM.episodesGrid.innerHTML = `<p style="grid-column:1/-1; color:#e53e3e; text-align:center;">Failed to load episode list from provider.</p>`;
    }
  } catch (err) {
    console.error('Error fetching details:', err);
    if (!cachedDetail) {
      DOM.episodesGrid.innerHTML = `<p style="grid-column:1/-1; color:#e53e3e; text-align:center;">Failed to load episode list.</p>`;
    }
  }
}

function closeDetailModal() {
  DOM.modalDetailOverlay.classList.add('hidden');
  document.body.style.overflow = 'auto';
}

function renderEpisodesGrid(chapters) {
  DOM.episodesGrid.innerHTML = '';
  chapters.forEach((ch, idx) => {
    const epNum = (typeof ch.index === 'number' && ch.index > 0 && ch.index <= chapters.length + 50) ? ch.index : (idx + 1);
    const btn = document.createElement('div');
    btn.className = 'episode-btn';
    btn.title = ch.title || `Episode ${epNum}`;
    btn.innerHTML = `
      <span>${epNum}</span>
      <i class="fa-solid fa-arrow-down ep-download-icon" title="Download Ep ${epNum}"></i>
    `;
    window.amaraDownloads?.episode(btn, state.currentDrama, ch.id);
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ep-download-icon')) {
        e.stopPropagation();
        downloadEpisode(state.currentDrama, epNum, ch.id);
        return;
      }
      closeDetailModal();
      openDramaPlayer(state.currentDrama, epNum, ch.id);
    });
    DOM.episodesGrid.appendChild(btn);
  });
}

// Video Player Engine
async function openDramaPlayer(drama, episodeIndex, chapterId) {
  if (typeof window.licenseManager !== 'undefined' && !window.licenseManager.requireActive()) return;
  const generation = ++playbackGeneration;
  ++playbackAttempt;
  clearPlaybackTimer();
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  state.currentPlaying.currentStreamUrl = '';
  if (drama.platform) state.currentPlatform = drama.platform;
  state.currentPlaying.streams = [];
  DOM.mainVideoPlayer.pause();
  DOM.mainVideoPlayer.removeAttribute('src');
  DOM.mainVideoPlayer.load();
  state.currentPlaying.drama = drama;
  state.currentPlaying.episodeIndex = episodeIndex;
  state.currentPlaying.chapterId = chapterId;

  DOM.playerDramaTitle.textContent = drama.title;
  DOM.playerEpisodeTitle.textContent = `Episode ${episodeIndex}`;
  DOM.playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  DOM.videoSpinner.classList.remove('hidden');
  DOM.bigPlayIcon.classList.add('hidden');

  renderDrawerEpisodes();
  saveHistory(drama, episodeIndex);

  // Fetch real streaming URL from backend
  try {
    const url = `/api/video?category_p=${state.currentPlatform}&id=${drama.id}&chapterId=${chapterId}&lang=${state.currentLang}`;
    const res = await fetch(url);
    const json = await res.json();
    if (generation !== playbackGeneration) return;

    if (json.success && json.data && Array.isArray(json.data.streams) && json.data.streams.length > 0) {
      state.currentPlaying.streams = json.data.streams;
      playStreamQuality(state.currentPlaying.currentQuality);
    } else {
      showToast('Preparing stream from server...', 'fa-triangle-exclamation');
      playDemoReel(drama, episodeIndex);
    }
  } catch (err) {
    if (generation !== playbackGeneration) return;
    console.error('Error loading video:', err);
    playDemoReel(drama, episodeIndex);
  }
}

function playStreamQuality(quality, fallback = false) {
  const streams = state.currentPlaying.streams;
  if (!streams || streams.length === 0) return;

  if (!fallback) attemptedStreams = new Set();
  let target = streams.find(s => s.quality === quality && (!fallback || !attemptedStreams.has(s.url))) ||
    streams.find(s => !attemptedStreams.has(s.url));
  if (!target) return;
  attemptedStreams.add(target.url);
  const attempt = ++playbackAttempt;
  const play = () => video.play().catch(err => {
    if (attempt !== playbackAttempt || err.name === 'AbortError') return;
    if (err.name === 'NotAllowedError') {
      clearPlaybackTimer();
      DOM.videoSpinner.classList.add('hidden');
      DOM.bigPlayIcon.classList.remove('hidden');
    } else failPlayback();
  });
  state.currentPlaying.currentQuality = target.quality || quality;
  state.currentPlaying.currentStreamUrl = target.url;
  DOM.currentQualityText.textContent = target.quality || quality;

  const video = DOM.mainVideoPlayer;
  const rawUrl = target.url;

  DOM.videoSpinner.classList.remove('hidden');
  DOM.bigPlayIcon.classList.add('hidden');
  watchPlayback();

  const isHls = rawUrl.toLowerCase().includes('.m3u8');

  if (isHls && window.Hls && Hls.isSupported()) {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });
    hlsInstance.loadSource(desktopApiUrl(`/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`));
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (attempt === playbackAttempt) play();
    });
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLS error:', data);
      if (data.fatal && attempt === playbackAttempt) failPlayback();
    });
  } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    video.src = desktopApiUrl(`/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`);
    play();
  } else {
    // MP4 - route through local server stream-proxy for HTTP 206 range & seeking support
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    const playableUrl = desktopApiUrl(`/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`);
    video.src = playableUrl;
    video.load();
    play();
  }
}

function playDemoReel() {
  clearPlaybackTimer();
  DOM.videoSpinner.classList.add('hidden');
  DOM.mainVideoPlayer.pause();
  DOM.mainVideoPlayer.removeAttribute('src');
  DOM.mainVideoPlayer.load();
  showToast('This episode is unavailable from the provider. Try another episode or platform.', 'fa-circle-exclamation');
}

function closePlayer() {
  ++playbackGeneration;
  ++playbackAttempt;
  clearPlaybackTimer();
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  DOM.mainVideoPlayer.pause();
  DOM.mainVideoPlayer.removeAttribute('src');
  DOM.mainVideoPlayer.load();
  DOM.playerOverlay.classList.add('hidden');
  DOM.episodeDrawer.classList.add('hidden');
  document.body.style.overflow = 'auto';
}

function renderDrawerEpisodes() {
  DOM.drawerEpisodesList.innerHTML = '';
  const episodes = state.currentEpisodes.length > 0
    ? state.currentEpisodes
    : [];

  episodes.forEach((ch, idx) => {
    const epNum = (typeof ch.index === 'number' && ch.index > 0 && ch.index <= episodes.length + 50) ? ch.index : (idx + 1);
    const isCurrent = epNum === state.currentPlaying.episodeIndex;
    const btn = document.createElement('div');
    btn.className = `episode-btn ${isCurrent ? 'active' : ''}`;
    btn.title = ch.title || `Episode ${epNum}`;
    btn.innerHTML = `
      <span>${epNum}</span>
      <i class="fa-solid fa-arrow-down ep-download-icon" title="Download Ep ${epNum}"></i>
    `;
    window.amaraDownloads?.episode(btn, state.currentPlaying.drama, ch.id);
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ep-download-icon')) {
        e.stopPropagation();
        downloadEpisode(state.currentPlaying.drama, epNum, ch.id);
        return;
      }
      DOM.episodeDrawer.classList.add('hidden');
      openDramaPlayer(state.currentPlaying.drama, epNum, ch.id);
    });
    DOM.drawerEpisodesList.appendChild(btn);
  });
}

// Download Episode Function
async function downloadEpisode(drama, episodeIndex, chapterId) {
  if (!drama) {
    showToast('Please select a drama to download.', 'fa-circle-exclamation');
    return;
  }

  showToast(`Preparing download for Episode ${episodeIndex}...`, 'fa-circle-notch fa-spin');

  try {
    let streamUrl = '';
    // If currently playing this episode and streams are available
    if (
      state.currentPlaying.drama &&
      state.currentPlaying.drama.id === drama.id &&
      state.currentPlaying.episodeIndex === episodeIndex &&
      state.currentPlaying.streams &&
      state.currentPlaying.streams.length > 0
    ) {
      streamUrl = state.currentPlaying.streams[0].url;
    } else {
      const cId = chapterId || `${episodeIndex}`;
      const url = `/api/video?category_p=${state.currentPlatform}&id=${drama.id}&chapterId=${cId}&lang=${state.currentLang}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data && Array.isArray(json.data.streams) && json.data.streams.length > 0) {
        streamUrl = json.data.streams[0].url;
      }
    }

    if (!streamUrl) {
      showToast('No download stream found for this episode.', 'fa-circle-xmark');
      return;
    }

    const safeTitle = (drama.title || 'Drama').replace(/[\\/:*?"<>|]/g, '').trim();
    const isHls = streamUrl.toLowerCase().includes('.m3u8');
    const ext = isHls ? '.ts' : '.mp4';
    const filename = `${safeTitle} - Episode ${episodeIndex}${ext}`;
    const downloadEndpoint = `/api/download?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(filename)}`;

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadEndpoint;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 3000);

    showToast(`Downloading: ${safeTitle} (Ep ${episodeIndex})`, 'fa-download');
  } catch (err) {
    console.error('Download error:', err);
    showToast('Failed to start download.', 'fa-triangle-exclamation');
  }
}

// Batch Downloader Management
let batchPollInterval = null;
let currentBatchData = {
  drama: null,
  chapters: [],
  plannedTotal: 0
};

function openBatchModal(drama, chapters, plannedTotal) {
  if (!chapters || chapters.length === 0) {
    showToast('No episodes available to download.', 'fa-circle-exclamation');
    return;
  }

  currentBatchData.drama = drama;
  currentBatchData.chapters = chapters;
  currentBatchData.plannedTotal = plannedTotal || chapters.length;
  const count = chapters.length;

  DOM.batchDramaTitle.textContent = drama.title;
  DOM.batchDramaPoster.src = desktopImageUrl(drama.cover);
  DOM.batchPlatformBadge.textContent = drama.author || capitalize(state.currentPlatform);
  DOM.batchStatusBadge.textContent = drama.status || (currentBatchData.plannedTotal > count ? 'Ongoing' : 'Available');

  DOM.batchEpisodesAvailableText.textContent = `${count} Episodes Available to Download`;
  if (currentBatchData.plannedTotal > count) {
    DOM.batchSeriesNote.textContent = `Series planned: ${currentBatchData.plannedTotal} episodes. Studio has released 1–${count} so far.`;
  } else {
    DOM.batchSeriesNote.textContent = `All ${count} episodes ready for offline download.`;
  }

  // Set default range
  DOM.batchStartEp.value = 1;
  DOM.batchStartEp.min = 1;
  DOM.batchStartEp.max = count;
  DOM.batchEndEp.value = count;
  DOM.batchEndEp.min = 1;
  DOM.batchEndEp.max = count;

  updateBatchSelectionCount();

  // Reset boxes
  DOM.batchSelectionBox.classList.remove('hidden');
  DOM.batchProgressBox.classList.add('hidden');
  DOM.batchCompletedBox.classList.add('hidden');
  DOM.batchModalActions.classList.remove('hidden');

  DOM.modalBatchOverlay.classList.remove('hidden');
}

function closeBatchModal() {
  if (batchPollInterval) {
    clearInterval(batchPollInterval);
    batchPollInterval = null;
  }
  DOM.modalBatchOverlay.classList.add('hidden');
}

function updateBatchSelectionCount() {
  const start = parseInt(DOM.batchStartEp.value) || 1;
  const end = parseInt(DOM.batchEndEp.value) || 1;
  const total = Math.max(0, end - start + 1);

  if (DOM.batchCountSpan) DOM.batchCountSpan.textContent = currentBatchData.chapters.length;
  if (DOM.batchBtnCount) DOM.batchBtnCount.textContent = total;
}

async function startBatchDownload() {
  if (typeof window.licenseManager !== 'undefined' && !window.licenseManager.requireActive()) return;
  const start = Math.max(1, parseInt(DOM.batchStartEp.value) || 1);
  const end = Math.min(currentBatchData.chapters.length, parseInt(DOM.batchEndEp.value) || currentBatchData.chapters.length);

  if (start > end) {
    showToast('Invalid episode range selected.', 'fa-circle-xmark');
    return;
  }

  const selected = currentBatchData.chapters.slice(start - 1, end);
  if (selected.length === 0) return;

  DOM.batchSelectionBox.classList.add('hidden');
  DOM.batchProgressBox.classList.remove('hidden');
  DOM.batchCompletedBox.classList.add('hidden');
  DOM.batchModalActions.classList.add('hidden');

  DOM.batchProgressStatusText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Initializing download queue for ${selected.length} episodes...`;
  DOM.batchProgressBarFill.style.width = '3%';
  DOM.batchProgressPercentText.textContent = '3%';

  try {
    const res = await fetch('/api/batch-download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_p: state.currentPlatform,
        drama_id: currentBatchData.drama.id,
        drama_title: currentBatchData.drama.title,
        episodes: selected
      })
    });
    const json = await res.json();
    if (!json.success) {
      showToast(json.error || 'Failed to start batch download.', 'fa-circle-xmark');
      DOM.batchSelectionBox.classList.remove('hidden');
      DOM.batchProgressBox.classList.add('hidden');
      DOM.batchModalActions.classList.remove('hidden');
      return;
    }

    showToast(`Batch download started: ${selected.length} episodes`, 'fa-cloud-arrow-down');

    // Poll status
    if (batchPollInterval) clearInterval(batchPollInterval);
    batchPollInterval = setInterval(pollBatchStatus, 900);
  } catch (err) {
    console.error('Error starting batch download:', err);
    showToast('Connection error starting batch download.', 'fa-circle-xmark');
    DOM.batchSelectionBox.classList.remove('hidden');
    DOM.batchProgressBox.classList.add('hidden');
    DOM.batchModalActions.classList.remove('hidden');
  }
}

async function pollBatchStatus() {
  try {
    const res = await fetch('/api/batch-download/status');
    const st = await res.json();

    if (st.is_running) {
      const pct = Math.max(3, st.overall_percent || 0);
      DOM.batchProgressBarFill.style.width = `${pct}%`;
      DOM.batchProgressPercentText.textContent = `${pct}%`;
      DOM.batchProgressStatusText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${st.status_message || 'Downloading...'}`;
      DOM.batchCurrentFileText.textContent = `Completed: ${st.completed_count} / ${st.total_episodes} (${st.current_file || ''})`;
      if (st.save_dir) {
        DOM.batchSaveLocationText.textContent = st.save_dir;
      }
    } else {
      clearInterval(batchPollInterval);
      batchPollInterval = null;

      DOM.batchProgressBarFill.style.width = '100%';
      DOM.batchProgressPercentText.textContent = '100%';
      DOM.batchProgressBox.classList.add('hidden');
      DOM.batchCompletedBox.classList.remove('hidden');

      DOM.batchCompletedSummary.textContent = `${st.completed_count || st.total_episodes} episodes saved to: ${st.save_dir || 'Downloads/AMARA_PRO_DL'}`;
      showToast('All episodes downloaded successfully!', 'fa-circle-check');
    }
  } catch (err) {
    console.error('Error polling batch status:', err);
  }
}

async function startBrowserBatchDownload() {
  if (typeof window.licenseManager !== 'undefined' && !window.licenseManager.requireActive()) return;
  const start = Math.max(1, parseInt(DOM.batchStartEp.value) || 1);
  const end = Math.min(currentBatchData.chapters.length, parseInt(DOM.batchEndEp.value) || currentBatchData.chapters.length);

  const selected = currentBatchData.chapters.slice(start - 1, end);
  if (selected.length === 0) return;

  closeBatchModal();
  showToast(`Downloading ${selected.length} episodes via browser queue...`, 'fa-download');

  for (let i = 0; i < selected.length; i++) {
    const ep = selected[i];
    const epNum = ep.index || (start + i);
    downloadEpisode(currentBatchData.drama, epNum, ep.id);
    await new Promise(r => setTimeout(r, 1600));
  }
}

async function openDownloadsFolder() {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    showToast('Opened downloads folder in File Explorer', 'fa-folder-open');
  } catch (err) {
    showToast('Failed to open downloads folder', 'fa-triangle-exclamation');
  }
}

function nextEpisode() {
  const nextIdx = state.currentPlaying.episodeIndex + 1;
  const nextCh = state.currentEpisodes.find((c, i) => {
    const epNum = (typeof c.index === 'number' && c.index > 0 && c.index <= state.currentEpisodes.length + 50) ? c.index : (i + 1);
    return epNum === nextIdx;
  });
  if (nextCh) {
    showToast(`Playing Episode ${nextIdx}`, 'fa-forward');
    openDramaPlayer(state.currentPlaying.drama, nextIdx, nextCh.id);
  } else {
    showToast('This is the last episode!', 'fa-flag-checkered');
  }
}

function prevEpisode() {
  const prevIdx = state.currentPlaying.episodeIndex - 1;
  if (prevIdx < 1) return;
  const prevCh = state.currentEpisodes.find((c, i) => {
    const epNum = (typeof c.index === 'number' && c.index > 0 && c.index <= state.currentEpisodes.length + 50) ? c.index : (i + 1);
    return epNum === prevIdx;
  });
  if (prevCh) {
    showToast(`Playing Episode ${prevIdx}`, 'fa-backward');
    openDramaPlayer(state.currentPlaying.drama, prevIdx, prevCh.id);
  }
}

// Watchlist & History Management
function toggleBookmark(drama, buttonEl) {
  const idx = state.watchlist.findIndex(w => w.id === drama.id && w.platform === state.currentPlatform);
  if (idx >= 0) {
    state.watchlist.splice(idx, 1);
    showToast('Removed from My List', 'fa-trash');
    if (buttonEl) updateBookmarkIcon(buttonEl, false);
  } else {
    state.watchlist.unshift({
      id: drama.id,
      title: drama.title,
      cover: drama.cover,
      author: drama.author || state.currentPlatform,
      chapters: drama.chapters,
      views: drama.views,
      platform: state.currentPlatform,
      savedAt: Date.now()
    });
    showToast('Saved to My List', 'fa-bookmark');
    if (buttonEl) updateBookmarkIcon(buttonEl, true);
  }
  localStorage.setItem('quickplay_watchlist', JSON.stringify(state.watchlist));
  updateWatchlistCounts();
  if (document.getElementById('tabWatchlist').classList.contains('active')) renderWatchlist();
}

function updateBookmarkIcon(el, isSaved) {
  if (!el) return;
  const icon = el.querySelector('i');
  if (icon) {
    icon.className = isSaved ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark';
    if (isSaved) icon.style.color = 'var(--accent-pink)';
    else icon.style.color = '';
  }
}

function saveHistory(drama, episodeIndex) {
  const existing = state.history.findIndex(h => h.id === drama.id && h.platform === state.currentPlatform);
  if (existing >= 0) state.history.splice(existing, 1);

  state.history.unshift({
    id: drama.id,
    title: drama.title,
    cover: drama.cover,
    author: drama.author || state.currentPlatform,
    chapters: drama.chapters,
    lastEpisode: episodeIndex,
    platform: state.currentPlatform,
    updatedAt: Date.now()
  });

  if (state.history.length > 50) state.history.pop();
  localStorage.setItem('quickplay_history', JSON.stringify(state.history));
  updateWatchlistCounts();
}

function updateWatchlistCounts() {
  DOM.savedCount.textContent = state.watchlist.length;
  DOM.historyCount.textContent = state.history.length;
}

function renderWatchlist(showHistory = false) {
  const items = showHistory ? state.history : state.watchlist;
  DOM.gridWatchlist.innerHTML = '';

  if (items.length === 0) {
    DOM.gridWatchlist.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
        <i class="fa-solid fa-film" style="font-size: 3rem; color: var(--text-muted); margin-bottom: 16px;"></i>
        <h3 style="font-family: var(--font-heading); margin-bottom: 8px;">No Dramas Yet</h3>
        <p style="color: var(--text-secondary); max-width: 400px; margin: 0 auto;">
          ${showHistory ? 'Dramas you watch will automatically appear here.' : 'Explore featured dramas and click save to watch later.'}
        </p>
      </div>
    `;
    return;
  }

  renderDramaGrid(DOM.gridWatchlist, items);
}

// Discover View
async function loadDiscoverData(platform) {
  globalThis.amaraProviderPages?.begin('discover');
  const request = ++catalogRequests.discover, lang = state.currentLang;
  const current = () => request === catalogRequests.discover && platform === state.currentPlatform && lang === state.currentLang;
  const cacheKey = `${platform}:${lang}`;
  const cached = (typeof clientCache !== 'undefined') ? clientCache.discover?.get(cacheKey) : null;
  if (cached && Array.isArray(cached) && cached.length > 0) {
    state.discoverDramas = cached;
    renderDramaGrid(DOM.gridDiscover, cached);
  } else {
    DOM.gridDiscover.innerHTML = `<div class="spinner-ring" style="grid-column: 1/-1; margin: 40px auto;"></div>`;
  }
  try {
    const res = await fetch(`/api/discover?category_p=${platform}&lang=${state.currentLang}`);
    const json = await res.json();
    if (!current()) return;
    if (!json.success) {
      if (!cached) {
        const isMaintenance = json.code === 'PLATFORM_MAINTENANCE' || /maintenance/i.test(json.message || json.error || '');
        DOM.gridDiscover.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 48px 20px; color:#a0aec0;">
          <div style="font-size: 36px; margin-bottom: 12px; color: ${isMaintenance ? '#f6ad55' : '#e53e3e'};"><i class="fa-solid ${isMaintenance ? 'fa-wrench' : 'fa-circle-exclamation'}"></i></div>
          <p style="font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px;">${isMaintenance ? 'Platform Under Maintenance' : 'Failed to Load Data'}</p>
          <p style="font-size: 13px; color: #a0aec0;">${json.error || json.message || 'Provider temporarily unavailable.'}</p>
        </div>`;
      }
      return;
    }
    let list = [];
    if (json.data) {
      if (Array.isArray(json.data)) list = json.data;
      else if (typeof json.data === 'object') list = Object.values(json.data);
    }
    globalThis.amaraProviderPages?.received('discover', json, list);
    if (list.length > 0) {
      if (typeof clientCache !== 'undefined') clientCache.discover?.set(cacheKey, list);
      state.discoverDramas = list;
      renderDramaGrid(DOM.gridDiscover, list);
    } else if (!cached) {
      DOM.gridDiscover.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#718096; padding: 40px 0;">No dramas found.</p>`;
    }
  } catch (err) {
    if (!current()) return;
    if (!cached) {
      console.error('Error discover:', err);
      const isMaintenance = /maintenance/i.test(err.message || '');
      DOM.gridDiscover.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 48px 20px; color:#e53e3e;">
        <div style="font-size: 36px; margin-bottom: 12px; color: ${isMaintenance ? '#f6ad55' : '#e53e3e'};"><i class="fa-solid ${isMaintenance ? 'fa-wrench' : 'fa-triangle-exclamation'}"></i></div>
        <p style="font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px;">${isMaintenance ? 'Platform Under Maintenance' : 'Failed to Load Data'}</p>
        <p style="font-size: 13px; color: #a0aec0;">${err.message || 'Network error connecting to provider.'}</p>
      </div>`;
    }
  }
}

// Popular Tags
async function loadPopularTags() {
  const request = ++catalogRequests.tags, platform = state.currentPlatform, lang = state.currentLang;
  try {
    const res = await fetch(`/api/popular-search?category_p=${state.currentPlatform}&lang=${state.currentLang}`);
    const json = await res.json();
    if (request !== catalogRequests.tags || platform !== state.currentPlatform || lang !== state.currentLang) return;
    if (json.success && Array.isArray(json.data)) {
      DOM.popularTagsCloud.innerHTML = '';
      json.data.slice(0, 8).forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = `#${item.title}`;
        chip.onclick = () => {
          DOM.mainSearchInput.value = item.query;
          performSearch(item.query);
        };
        DOM.popularTagsCloud.appendChild(chip);
      });
    }
  } catch (err) {
    console.error('Error popular search:', err);
  }
}

// Search Feature
let searchDebounceTimeout = null;
function handleSearchInput(value) {
  globalThis.amaraProviderPages?.begin('search');
  clearTimeout(searchDebounceTimeout);
  ++catalogRequests.search;
  if (!value.trim()) {
    DOM.btnClearSearch.classList.add('hidden');
    DOM.gridSearch.innerHTML = '';
    DOM.searchResultCountText.textContent = 'Enter keywords to start searching';
    return;
  }
  DOM.btnClearSearch.classList.remove('hidden');
  searchDebounceTimeout = setTimeout(() => performSearch(value.trim()), 400);
}

async function performSearch(query) {
  globalThis.amaraProviderPages?.begin('search');
  clearTimeout(searchDebounceTimeout);
  const request = ++catalogRequests.search, platform = state.currentPlatform, lang = state.currentLang;
  const current = () => request === catalogRequests.search && platform === state.currentPlatform && lang === state.currentLang;
  DOM.searchResultCountText.textContent = `Searching "${query}" on ${capitalize(platform)}...`;
  try {
    const res = await fetch(`/api/search?category_p=${state.currentPlatform}&q=${encodeURIComponent(query)}&lang=${state.currentLang}`);
    const json = await res.json();
    if (!current()) return;
    if (json.success && Array.isArray(json.data)) {
      state.searchResults = json.data;
      DOM.searchResultCountText.textContent = `Found ${json.data.length} dramas for "${query}"`;
      renderDramaGrid(DOM.gridSearch, json.data);
      globalThis.amaraProviderPages?.received('search', json, json.data, query);
    } else {
      const isMaintenance = json.code === 'PLATFORM_MAINTENANCE' || /maintenance/i.test(json.message || json.error || '');
      DOM.searchResultCountText.textContent = isMaintenance
        ? `${capitalize(platform)} is currently under maintenance`
        : `No results found for "${query}"`;
      DOM.gridSearch.innerHTML = isMaintenance
        ? `<div style="grid-column:1/-1; text-align:center; padding: 48px 20px; color:#a0aec0;">
            <div style="font-size: 36px; margin-bottom: 12px; color: #f6ad55;"><i class="fa-solid fa-wrench"></i></div>
            <p style="font-size: 16px; font-weight: 600; color: #e2e8f0; margin-bottom: 6px;">Platform Under Maintenance</p>
            <p style="font-size: 13px; color: #a0aec0;">${capitalize(platform)} is currently undergoing maintenance by the provider. Please try searching other platforms.</p>
          </div>`
        : '';
    }
  } catch (err) {
    if (!current()) return;
    console.error('Search error:', err);
    DOM.searchResultCountText.textContent = 'An error occurred while searching.';
  }
}

// Event Listeners Wiring
function setupEventListeners() {
  // Modal close
  DOM.btnCloseDetailModal.addEventListener('click', closeDetailModal);
  DOM.modalDetailOverlay.addEventListener('click', (e) => {
    if (e.target === DOM.modalDetailOverlay) closeDetailModal();
  });

  // Video player close & toggle
  DOM.btnClosePlayer.addEventListener('click', closePlayer);
  DOM.btnToggleEpisodeList.addEventListener('click', () => {
    DOM.episodeDrawer.classList.toggle('hidden');
  });
  DOM.btnCloseEpisodeDrawer.addEventListener('click', () => {
    DOM.episodeDrawer.classList.add('hidden');
  });

  // Video Player Controls
  const video = DOM.mainVideoPlayer;

  DOM.btnPlayPause.addEventListener('click', () => {
    if (video.paused) video.play();
    else video.pause();
  });

  DOM.videoWrapper.addEventListener('click', (e) => {
    if (e.target.closest('#playerControlsBar') || e.target.closest('.player-header-bar')) return;
    if (video.paused) video.play();
    else video.pause();
  });

  video.addEventListener('play', () => {
    watchPlayback();
    DOM.btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    DOM.bigPlayIcon.classList.add('hidden');
  });

  video.addEventListener('pause', () => {
    clearPlaybackTimer();
    DOM.btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
    DOM.bigPlayIcon.classList.remove('hidden');
  });

  video.addEventListener('waiting', () => {
    DOM.videoSpinner.classList.remove('hidden');
    watchPlayback();
  });

  video.addEventListener('playing', () => {
    clearPlaybackTimer();
    DOM.videoSpinner.classList.add('hidden');
  });

  video.addEventListener('stalled', () => {
    if (!video.paused) watchPlayback();
  });

  video.addEventListener('canplay', () => {
    DOM.videoSpinner.classList.add('hidden');
  });

  video.addEventListener('error', (e) => {
    console.error('Video error event:', video.error);
    DOM.videoSpinner.classList.add('hidden');
    if (video.error && video.getAttribute('src') && !DOM.playerOverlay.classList.contains('hidden')) failPlayback();
  });

  video.addEventListener('ended', () => {
    nextEpisode();
  });

  video.addEventListener('timeupdate', () => {
    const cur = video.currentTime || 0;
    const dur = video.duration || 1;
    const pct = (cur / dur) * 100;
    DOM.progressFilled.style.width = `${pct}%`;
    DOM.progressThumb.style.left = `${pct}%`;
    DOM.currentTimeText.textContent = formatTime(cur);
    DOM.durationTimeText.textContent = formatTime(dur);
  });

  // Seek bar
  DOM.progressBarContainer.addEventListener('click', (e) => {
    const rect = DOM.progressBarContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * (video.duration || 0);
  });

  DOM.btnNextEpisode.addEventListener('click', nextEpisode);
  DOM.btnPrevEpisode.addEventListener('click', prevEpisode);

  // Download Episode from Player controls
  DOM.btnDownloadPlayer.addEventListener('click', () => {
    if (state.currentPlaying.drama) {
      downloadEpisode(
        state.currentPlaying.drama,
        state.currentPlaying.episodeIndex,
        state.currentPlaying.chapterId
      );
    } else {
      showToast('No active episode playing.', 'fa-circle-exclamation');
    }
  });

  // Download Episode 1 from Detail Modal
  if (DOM.btnDetailDownloadFirst) {
    DOM.btnDetailDownloadFirst.addEventListener('click', () => {
      if (state.currentDrama) {
        const firstCh = (state.currentEpisodes && state.currentEpisodes.length > 0)
          ? state.currentEpisodes[0]
          : { id: '1', index: 1 };
        downloadEpisode(state.currentDrama, 1, firstCh.id);
      }
    });
  }

  // Fullscreen
  DOM.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      DOM.playerContainer.requestFullscreen().catch(() => {});
      DOM.btnFullscreen.innerHTML = '<i class="fa-solid fa-compress"></i>';
    } else {
      document.exitFullscreen().catch(() => {});
      DOM.btnFullscreen.innerHTML = '<i class="fa-solid fa-expand"></i>';
    }
  });

  // Speed Menu
  DOM.btnSpeed.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.menuSpeed.classList.toggle('hidden');
    DOM.menuQuality.classList.add('hidden');
  });

  DOM.menuSpeed.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      const speed = parseFloat(item.dataset.speed);
      video.playbackRate = speed;
      DOM.currentSpeedText.textContent = `${speed}x`;
      DOM.menuSpeed.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      DOM.menuSpeed.classList.add('hidden');
    });
  });

  // Quality Menu
  DOM.btnQuality.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.menuQuality.classList.toggle('hidden');
    DOM.menuSpeed.classList.add('hidden');
  });

  DOM.menuQuality.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      const q = item.dataset.quality;
      playStreamQuality(q);
      DOM.menuQuality.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      DOM.menuQuality.classList.add('hidden');
    });
  });

  document.addEventListener('click', () => {
    DOM.menuSpeed.classList.add('hidden');
    DOM.menuQuality.classList.add('hidden');
  });

  // Discover platform selector
  DOM.selectDiscoverPlatform.addEventListener('change', (e) => {
    selectPlatform(e.target.value);
  });

  // Search input listeners
  DOM.mainSearchInput.addEventListener('input', (e) => handleSearchInput(e.target.value));
  DOM.headerSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) {
        document.querySelector('[data-tab="search"]').click();
        DOM.mainSearchInput.value = q;
        performSearch(q);
      }
    }
  });

  DOM.btnClearSearch.addEventListener('click', () => {
    DOM.mainSearchInput.value = '';
    handleSearchInput('');
  });

  // Watchlist pill toggle
  DOM.pillWatchlist.addEventListener('click', () => {
    DOM.pillWatchlist.classList.add('active');
    DOM.pillHistory.classList.remove('active');
    renderWatchlist(false);
  });

  DOM.pillHistory.addEventListener('click', () => {
    DOM.pillHistory.classList.add('active');
    DOM.pillWatchlist.classList.remove('active');
    renderWatchlist(true);
  });

  // Refresh Cache
  DOM.btnRefreshData.addEventListener('click', async () => {
    showToast('Refreshing server data...', 'fa-rotate-right');
    await loadHomeData(state.currentPlatform);
    showToast('Data refreshed successfully!', 'fa-check');
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // If typing in input, ignore shortcuts
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (!DOM.playerOverlay.classList.contains('hidden')) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
      } else if (e.key === 'ArrowRight') {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.key === 'f' || e.key === 'F') {
        DOM.btnFullscreen.click();
      } else if (e.key === 'n' || e.key === 'N') {
        nextEpisode();
      } else if (e.key === 'Escape') {
        closePlayer();
      }
    } else if (!DOM.modalBatchOverlay.classList.contains('hidden')) {
      if (e.key === 'Escape') closeBatchModal();
    } else if (!DOM.modalDetailOverlay.classList.contains('hidden')) {
      if (e.key === 'Escape') closeDetailModal();
    }
  });

  // Batch Downloader Modal events
  if (DOM.btnCloseBatchModal) DOM.btnCloseBatchModal.addEventListener('click', closeBatchModal);
  if (DOM.btnCancelBatchModal) DOM.btnCancelBatchModal.addEventListener('click', closeBatchModal);
  if (DOM.modalBatchOverlay) {
    DOM.modalBatchOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.modalBatchOverlay) closeBatchModal();
    });
  }

  if (DOM.batchStartEp) DOM.batchStartEp.addEventListener('input', updateBatchSelectionCount);
  if (DOM.batchEndEp) DOM.batchEndEp.addEventListener('input', updateBatchSelectionCount);

  if (DOM.btnBatchSelectAll) {
    DOM.btnBatchSelectAll.addEventListener('click', () => {
      if (currentBatchData.chapters && currentBatchData.chapters.length > 0) {
        DOM.batchStartEp.value = 1;
        DOM.batchEndEp.value = currentBatchData.chapters.length;
        updateBatchSelectionCount();
      }
    });
  }

  if (DOM.btnStartBatchDownload) DOM.btnStartBatchDownload.addEventListener('click', startBatchDownload);
  if (DOM.btnBrowserBatchDownload) DOM.btnBrowserBatchDownload.addEventListener('click', startBrowserBatchDownload);
  if (DOM.btnOpenDownloadsFolder) DOM.btnOpenDownloadsFolder.addEventListener('click', openDownloadsFolder);
}

// Helper Utilities
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

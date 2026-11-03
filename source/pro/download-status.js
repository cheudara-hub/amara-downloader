// Completion comes from the durable desktop queue and verified local files.
(() => {
  let groups = [], refreshing;
  function saved(drama) {
    if (!drama) return new Set();
    return new Set(groups.find(g => g.platform === (drama.platform || state.currentPlatform) && g.dramaId === String(drama.id) && g.lang === (state.currentLang || 'en'))?.chapterIds || []);
  }
  function label(drama, total) {
    const count = saved(drama).size;
    if (!count) return '';
    return total > 0 && count >= total ? 'Downloaded' : `${count}${total ? '/' + total : ''} downloaded`;
  }
  function paintCard(card) {
    const drama = JSON.parse(card.dataset.downloadDrama);
    const text = label(drama, parseInt(drama.chapters || drama.total_episodes) || 0);
    card.querySelector('.downloaded-badge')?.remove();
    card.classList.toggle('is-downloaded', text === 'Downloaded');
    if (!text) return;
    const badge = document.createElement('div');
    badge.className = 'downloaded-badge' + (text === 'Downloaded' ? '' : ' download-partial');
    badge.textContent = '\u2713 ' + text;
    badge.title = 'Episodes saved on this computer';
    card.querySelector('.card-content').prepend(badge);
  }
  function paintEpisode(button) {
    const done = saved(JSON.parse(button.dataset.downloadDrama)).has(button.dataset.downloadChapter);
    button.classList.toggle('episode-downloaded', done);
    const icon = button.querySelector('.ep-download-icon');
    if (icon) {
      icon.classList.toggle('fa-arrow-down', !done);
      icon.classList.toggle('fa-circle-check', done);
      icon.title = done ? 'Already downloaded' : 'Download episode';
      icon.setAttribute('aria-label', icon.title);
    }
  }
  function detail() {
    if (!state.currentDrama) return;
    const total = state.currentEpisodes.length || parseInt(state.currentDrama.chapters || state.currentDrama.total_episodes) || 0;
    const text = label(state.currentDrama, total);
    DOM.detailStatus.classList.toggle('download-status-saved', !!text);
    DOM.detailStatus.textContent = text ? '\u2713 ' + text : state.currentDrama.status || 'Available';
  }
  function paint() {
    document.querySelectorAll('.drama-card[data-download-drama]').forEach(paintCard);
    document.querySelectorAll('.episode-btn[data-download-chapter]').forEach(paintEpisode);
    detail();
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = window.amaraDesktop.call('download-status').then(result => { groups = result; paint(); }).catch(error => console.warn('Download marks could not refresh:', error.message)).finally(() => { refreshing = null; });
    return refreshing;
  }
  window.amaraDownloads = {
    refresh, detail,
    has: (drama, chapterId) => saved(drama).has(String(chapterId)),
    card: (card, drama) => {
      card.dataset.downloadDrama = JSON.stringify({ ...drama, platform: drama.platform || state.currentPlatform });
      paintCard(card);
    },
    episode: (button, drama, chapterId) => {
      button.dataset.downloadDrama = JSON.stringify({ ...drama, platform: drama.platform || state.currentPlatform });
      button.dataset.downloadChapter = String(chapterId);
      paintEpisode(button); detail();
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 4000);
    window.addEventListener('focus', refresh);
  });
})();

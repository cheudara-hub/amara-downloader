/* Presentation and navigation layer. The existing renderer retains media workflows. */
(() => {
  const api = window.electronAPI, $ = s => document.querySelector(s);
  if (api?.embedded) document.body.classList.add('unified-embedded');
  const icons = {
    browser: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M9 14l-2 2 2 2m6-4 2 2-2 2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    play: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8 6 4-6 4V8Z"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icons[name]}</svg>`;
  let currentPage = '', refreshPending = false;
  const toast = message => { $('.amara-toast')?.remove(); const el = document.createElement('div'); el.className = 'amara-toast'; el.setAttribute('role', 'status'); el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 5000); };
  const action = async fn => { try { await fn(); } catch (err) { toast(err.message || 'Please try again.'); } };
  const navigate = page => Array.from(document.querySelectorAll('.sidebar-item')).find(el => el.textContent.trim() === page)?.click();
  async function updateStats() {
    if (!api || refreshPending) return; refreshPending = true;
    try {
      const tasks = await api.getDownloadTasks(), list = Array.isArray(tasks) ? tasks : tasks?.tasks || [];
      const counts = [list.filter(t => t.status === 'downloading').length, list.filter(t => t.status === 'pending').length, list.filter(t => t.status === 'completed').length];
      document.querySelectorAll('[data-amara-count]').forEach(el => { const value = String(counts[Number(el.dataset.amaraCount)]); if (el.textContent !== value) el.textContent = value; });
    } catch {} finally { refreshPending = false; }
  }
  function enhance() {
    const wrapper = $('.main-wrapper'), content = $('.main-content'); if (!wrapper || !content) return;
    const page = $('.sidebar-item.active')?.textContent.trim() || 'Browse';
    if (!$('.amara-browser-launch')) {
      const button = document.createElement('button'); button.className = 'amara-browser-launch'; button.innerHTML = icon('browser') + '<span>Browser</span><small>WEB</small>'; button.title = 'Search the web or paste a movie link'; button.onclick = () => action(() => api.openMediaBrowser());
      const menu = $('.sidebar-menu'); if (menu) menu.insertBefore(button, Array.from(menu.children).find(el => el.textContent.trim() === 'Add Downloads') || null);
    }
    if (!$('.amara-topbar')) {
      const bar = document.createElement('header'); bar.className = 'amara-topbar';
      bar.innerHTML = '<div class="amara-crumb"><span>Your workspace</span><b id="amara-page"></b></div><div class="amara-top-actions"><span class="amara-shortcut">Ctrl + K &middot; Add a show</span><button class="btn btn-outline" id="amara-open-browser">Open Browser &#8599;</button><button class="btn btn-primary" id="amara-add">&#65291; New download</button><div class="amara-avatar" aria-label="Personal workspace">A</div></div>';
      wrapper.prepend(bar); $('#amara-add').onclick = () => navigate('Add Downloads'); $('#amara-open-browser').onclick = () => action(() => api.openMediaBrowser());
      if (api?.openProWorkspace) {
        const pro = $('#amara-open-browser'); pro.textContent = 'AMARA PRO';
        pro.onclick = () => action(() => api.openProWorkspace());
      }
    }
    if ($('#amara-page').textContent !== page) $('#amara-page').textContent = page;
    const brand = $('.brand-text'), sub = $('.brand-sub');
    if (brand && brand.textContent !== 'AMARA') brand.textContent = 'AMARA';
    if (sub && sub.textContent !== 'Media workspace') sub.textContent = 'Media workspace';
    const footer = $('.footer-note'); if (footer && footer.textContent !== 'Stories saved. Ready when you are.') footer.textContent = 'Stories saved. Ready when you are.';
    document.querySelectorAll('.sidebar-item').forEach(el => {
      if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', 'button'); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }; }
      const active = el.classList.contains('active') ? 'page' : 'false'; if (el.getAttribute('aria-current') !== active) el.setAttribute('aria-current', active);
    });
    if (page === 'Browse' && !content.querySelector('.amara-welcome')) {
      const welcome = document.createElement('section'); welcome.className = 'amara-welcome';
      welcome.innerHTML = `<div class="amara-banner"><div class="amara-banner-copy"><div class="amara-eyebrow">A LITTLE SPACE FOR GREAT STORIES</div><h1>Find it. Save it.<br>Make it a movie night.</h1><p>Find a series, save every episode, and keep it all together.</p><form class="amara-search">${icon('search')}<input aria-label="Search the web or paste a website link" placeholder="Search a title or paste a movie link&hellip;"><button class="btn btn-primary">Open in Browser &#8599;</button></form><div class="amara-banner-links"><span>START EXPLORING</span><button data-site="https://www.phumi7.net/">Phumi7</button><button data-site="https://www.8khmer.com/">8Khmer</button><button data-site="https://www.phumikhmer.net/">Phumikhmer</button></div></div><div class="amara-cinema-art" aria-hidden="true"><div class="amara-cinema-card">${icon('play')}<span>PLAY IT YOUR WAY</span></div></div></div><div class="amara-metrics"><div class="amara-metric"><div><span>APP DOWNLOADS &middot; ACTIVE</span><strong data-amara-count="0">&mdash;</strong></div><small>&#8595;</small></div><div class="amara-metric"><div><span>WAITING IN QUEUE</span><strong data-amara-count="1">&mdash;</strong></div><small>&#8801;</small></div><div class="amara-metric"><div><span>READY TO WATCH</span><strong data-amara-count="2">&mdash;</strong></div><small>&#10003;</small></div></div>`;
      content.prepend(welcome);
      welcome.querySelector('form').onsubmit = e => { e.preventDefault(); const input = welcome.querySelector('input').value.trim(); action(() => api.openMediaBrowser(input)); };
      welcome.querySelectorAll('[data-site]').forEach(el => { el.onclick = () => action(() => api.openMediaBrowser(el.dataset.site)); }); updateStats();
    }
    if (api?.embedded && page === 'Browse') {
      const welcome = content.querySelector('.amara-welcome');
      if (welcome && !welcome.dataset.hongguo) {
        welcome.dataset.hongguo = 'true';
        welcome.innerHTML = '<div class="hongguo-native-intro"><div><h1>Hongguo</h1><p>Your original Hongguo catalog. Browse categories below or open the website.</p></div><button class="btn btn-primary">Open Hongguo website &#8599;</button></div>';
        welcome.querySelector('button').onclick = () => action(() => api.openMediaBrowser('https://hongguoduanju.com'));
      }
    }
    if (page !== 'Browse') content.querySelector('.amara-welcome')?.remove();
    if (page === 'Add Downloads' && $('.hongguo-container') && !$('.amara-web-help')) {
      const help = document.createElement('div'); help.className = 'amara-web-help';
      help.innerHTML = '<div><strong>Have a link from another website?</strong><span>Open Browser to collect its episodes and poster together.</span></div><button class="btn btn-outline">Open Browser &#8599;</button>';
      const container = $('.hongguo-container'); const hero = container.querySelector('.hongguo-hero');
      if (hero) hero.after(help); else container.prepend(help);
      help.querySelector('button').onclick = () => action(() => api.openMediaBrowser());
    }
    if (page !== currentPage) { currentPage = page; content.scrollTop = 0; }
    const hero = $('.hero-text h2'); if (hero && hero.textContent !== 'Add to your collection') hero.textContent = 'Add to your collection';
  }
  let scheduled = false;
  new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; enhance(); }); } }).observe(document.getElementById('root'), { childList: true, subtree: true });
  enhance();
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('Add Downloads'); setTimeout(() => $('.hongguo-container input')?.focus(), 100); } });
  if (api) ['onDownloadTaskAdded', 'onDownloadCompleted', 'onDownloadFailed', 'onDownloadStopped', 'onDownloadQueueChanged'].forEach(name => api[name]?.(updateStats));
  api?.onLibraryScanComplete?.(result => { toast(result.success ? `Library updated: ${result.count} videos added, ${result.relocated} paths updated.` : result.error || 'Could not scan this folder.'); updateStats(); });
  setInterval(() => { if (!document.hidden && $('.amara-welcome')) updateStats(); }, 3000);
})();

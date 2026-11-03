// All remote data is rendered as text. Only the main process chooses release URLs.
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.workspace-nav');
  if (!nav || !window.amaraDesktop) return;
  const button = document.createElement('button');
  button.className = 'nav-link'; button.textContent = 'Updates'; button.id = 'amaraUpdates';
  nav.append(button);
  const dialog = document.createElement('dialog'); dialog.className = 'amara-update-dialog';
  dialog.setAttribute('aria-labelledby', 'amaraUpdateTitle');
  dialog.innerHTML = `<div class="update-heading"><h2 id="amaraUpdateTitle">AMARA updates</h2><button type="button" data-action="close" aria-label="Close updates">×</button></div>
    <p data-status aria-live="polite">Checking for updates…</p>
    <section><h3>Your AMARA app</h3><p data-app></p><button type="button" data-action="app" hidden>Get tested AMARA update</button></section>
    <section><h3>Hongguo source</h3><p data-upstream></p><p class="update-note">Upstream changes are reviewed and tested before they become an AMARA update.</p><button type="button" data-action="upstream">View upstream release</button></section>
    <div class="update-footer"><button type="button" data-action="check">Check now</button><span>Checks run on opening AMARA and every six hours. Turn them off in Settings.</span></div>`;
  document.body.append(dialog);
  const call = action => window.amaraDesktop.call('updates', { action });
  let latest, busy = false;
  function render(data) {
    latest = data;
    const notification = data.enabled && (data.app.available || data.upstream.available);
    button.textContent = notification ? 'Updates •' : 'Updates';
    button.setAttribute('aria-label', notification ? 'Updates available' : 'Updates');
    dialog.querySelector('[data-status]').textContent = !data.enabled ? 'Automatic checks are turned off in Settings.'
      : data.errors.length ? data.errors.join(' ')
      : data.checkedAt ? `Last checked: ${new Date(data.checkedAt).toLocaleString()}` : 'No successful check yet.';
    dialog.querySelector('[data-app]').textContent = !data.repository
      ? `AMARA ${data.app.current}. Your AMARA release repository is not configured yet.`
      : data.app.available ? `AMARA ${data.app.latest} is available. Current version: ${data.app.current}.`
      : `AMARA ${data.app.current}. ${data.app.latest ? 'No newer verified release is available.' : 'No verified release found yet.'}`;
    dialog.querySelector('[data-action="app"]').hidden = !data.app.available;
    dialog.querySelector('[data-upstream]').textContent = `Integrated version: ${data.upstream.integrated}. `
      + (data.upstream.latest ? `Latest release: ${data.upstream.latest}. ` : 'Latest release has not been checked. ')
      + (data.upstream.available ? 'A newer source release needs review.' : '');
    dialog.querySelector('[data-action="upstream"]').disabled = !data.enabled;
  }
  async function check(force = false) {
    if (busy) return;
    busy = true; dialog.querySelector('[data-action="check"]').disabled = true;
    try { render(await call(force ? 'check' : 'auto')); }
    catch (_) { dialog.querySelector('[data-status]').textContent = 'Could not check updates. Try again later.'; }
    finally { busy = false; dialog.querySelector('[data-action="check"]').disabled = false; }
  }
  button.onclick = async () => {
    // Native BrowserViews sit above DOM dialogs; detach them using the existing route action.
    try {
      await window.amaraDesktop.call('navigate', { route: 'home' });
      dialog.showModal(); render(await call('state')); await check();
    } catch (_) { showToast('Unable to open updates.', 'fa-circle-exclamation'); }
  };
  dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  dialog.querySelector('[data-action="check"]').onclick = () => check(true);
  for (const kind of ['app', 'upstream']) dialog.querySelector(`[data-action="${kind}"]`).onclick = async () => {
    try { await call('open-' + kind); }
    catch (_) { dialog.querySelector('[data-status]').textContent = 'Could not open release page. Check again and retry.'; }
  };
  const initial = setTimeout(() => check(), 2500);
  const timer = setInterval(() => check(), 6 * 60 * 60 * 1000);
  window.addEventListener('beforeunload', () => { clearTimeout(initial); clearInterval(timer); }, { once: true });
});

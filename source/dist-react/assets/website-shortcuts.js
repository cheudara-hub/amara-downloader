// Shortcuts belong to the local AMARA browser interface, never the remote page.
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'amara_website_shortcuts_v1';
  const defaults = [
    { name: 'Phumi7', url: 'https://www.phumi7.net/' },
    { name: '8Khmer', url: 'https://www.8khmer.com/' },
    { name: 'Phumikhmer', url: 'https://www.phumikhmer.net/' }
  ];
  let shortcuts = defaults, editing = -1;
  function normalizeUrl(value) {
    let raw = value.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(raw)) {
      throw new Error('Enter an http or https website address, such as https://example.com.');
    }
    return url.href;
  }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error('Invalid saved shortcuts');
      shortcuts = parsed.filter(item => {
        try { return typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 40 && typeof item.url === 'string' && item.url.length <= 2048 && normalizeUrl(item.url) === item.url; }
        catch { return false; }
      });
    }
  } catch { $('shortcut-status').textContent = 'Saved shortcuts could not be read. The default websites are shown.'; }
  function button(label, action, title) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
    if (title) { el.title = title; el.setAttribute('aria-label', title); }
    el.onclick = action; return el;
  }
  function resetForm() {
    editing = -1; $('shortcut-form').reset(); $('shortcut-error').textContent = '';
    $('save-shortcut').textContent = 'Save shortcut'; $('new-shortcut').hidden = true;
  }
  function save(next) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { $('shortcut-error').textContent = 'Could not save shortcuts. Please try again.'; return false; }
    shortcuts = next; render(); return true;
  }
  function render() {
    $('website-shortcuts').replaceChildren(); $('shortcut-list').replaceChildren();
    shortcuts.forEach((item, index) => {
      const open = button(item.name + ' \u2197', async () => {
        try { await window.mediaBrowser.call('go', item.url); }
        catch (error) { $('notice').textContent = error.message; }
      });
      open.dataset.url = item.url; open.title = item.url; $('website-shortcuts').append(open);
      const row = document.createElement('div'); row.className = 'shortcut-row';
      const info = document.createElement('div'); info.className = 'shortcut-row-info';
      const name = document.createElement('strong'); name.textContent = item.name;
      const address = document.createElement('small'); address.textContent = item.url; address.title = item.url;
      info.append(name, address);
      row.append(info, button('Edit', () => {
        editing = index; $('shortcut-name').value = item.name; $('shortcut-url').value = item.url;
        $('save-shortcut').textContent = 'Save changes'; $('new-shortcut').hidden = false;
        $('shortcut-error').textContent = ''; $('shortcut-status').textContent = '';
        $('shortcut-name').focus();
      }, 'Edit ' + item.name), button('Remove', () => {
        if (save(shortcuts.filter((_, i) => i !== index))) {
          resetForm(); $('shortcut-status').textContent = item.name + ' removed.';
          $('shortcut-name').focus();
        }
      }, 'Remove ' + item.name));
      $('shortcut-list').append(row);
    });
    if (!shortcuts.length) {
      const empty = document.createElement('p'); empty.className = 'shortcut-help';
      empty.textContent = 'No websites yet. Add your first shortcut above.'; $('shortcut-list').append(empty);
    }
  }
  function closeEditor() {
    $('shortcut-editor').hidden = true; document.body.classList.remove('shortcut-editing');
    $('add-website').setAttribute('aria-expanded', 'false'); $('add-website').focus();
  }
  $('add-website').onclick = () => {
    resetForm(); $('shortcut-status').textContent = '';
    $('shortcut-editor').hidden = false; document.body.classList.add('shortcut-editing');
    $('add-website').setAttribute('aria-expanded', 'true'); $('shortcut-name').focus();
  };
  $('close-shortcut-editor').onclick = closeEditor;
  window.mediaBrowser.onState(state => {
    if (state.workspaceMode === 'downloads') {
      $('shortcut-editor').hidden = true;
      document.body.classList.remove('shortcut-editing');
      $('add-website').setAttribute('aria-expanded', 'false');
    }
  });
  $('shortcut-editor').addEventListener('keydown', event => { if (event.key === 'Escape') closeEditor(); });
  $('new-shortcut').onclick = () => { resetForm(); $('shortcut-name').focus(); };
  $('shortcut-form').onsubmit = event => {
    event.preventDefault(); $('shortcut-error').textContent = ''; $('shortcut-status').textContent = '';
    const name = $('shortcut-name').value.trim();
    if (!name) { $('shortcut-error').textContent = 'Enter a website name.'; $('shortcut-name').focus(); return; }
    let url;
    try { url = normalizeUrl($('shortcut-url').value); }
    catch { $('shortcut-error').textContent = 'Enter an http or https website address, such as https://example.com.'; $('shortcut-url').focus(); return; }
    if (shortcuts.some((item, index) => index !== editing && item.url === url)) {
      $('shortcut-error').textContent = 'This website is already in your shortcuts.'; return;
    }
    const next = [...shortcuts];
    if (editing < 0) next.push({ name, url }); else next[editing] = { name, url };
    if (save(next)) { resetForm(); $('shortcut-status').textContent = name + ' saved.'; $('shortcut-name').focus(); }
  };
  render();
})();

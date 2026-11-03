// Isolated render verification. No live settings, queue, or movie files are modified.
module.exports = async function check({ mainWindow }) {
  const { app } = require('electron');
  const fs = require('fs'), path = require('path'), assert = require('assert/strict');
  const output = path.join(process.resourcesPath, '..', '..', 'artifacts', 'design-preview');
  fs.mkdirSync(output, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = [];
  try {
    for (let i = 0; i < 80; i++) { if (await mainWindow.webContents.executeJavaScript('!!document.querySelector(".amara-topbar")').catch(() => false)) break; await wait(100); }
    await wait(3500);
    for (const [page, altPage] of [['Browse', 'Discover'], ['Add Downloads', 'Search & download'], ['Player', 'My library'], ['Downloads', 'Downloads'], ['Settings', 'Settings']]) {
      await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.sidebar-item')).find(el => [${JSON.stringify(page)}, ${JSON.stringify(altPage)}].includes(el.textContent.trim()))?.click()`);
      for (let i = 0; i < 30; i++) {
        if (await mainWindow.webContents.executeJavaScript(`[${JSON.stringify(page)}, ${JSON.stringify(altPage)}].includes(document.getElementById('amara-page').textContent)`)) break;
        await wait(100);
      }
      await wait(650);
      if (page === 'Player' || altPage === 'My library') {
        // The dedicated preview library contains only a copied three-second verification clip.
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.series-picker-btn')?.click()`);
        await wait(250);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.series-row')?.click()`);
        await wait(650);
      }
      const snapshot = await mainWindow.webContents.executeJavaScript(`({page:document.getElementById('amara-page').textContent,horizontalOverflow:document.documentElement.scrollWidth > innerWidth,background:getComputedStyle(document.body).backgroundColor,browserButtons:document.querySelectorAll('.amara-browser-launch').length,text:document.body.innerText,html:document.getElementById('root').outerHTML})`);
      assert.ok([page, altPage].includes(snapshot.page)); assert.equal(snapshot.horizontalOverflow, false); assert.equal(snapshot.browserButtons, 1);
      assert.equal(snapshot.text.includes('Browser ?'), false, 'Navigation symbols must render correctly');
      fs.writeFileSync(path.join(output, page.replaceAll(' ', '-') + '.png'), (await mainWindow.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(output, page.replaceAll(' ', '-') + '.html'), snapshot.html);
      delete snapshot.html; delete snapshot.text; report.push(snapshot);
    }
    mainWindow.setSize(960, 760);
    await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.sidebar-item')).find(el => ['Browse', 'Discover'].includes(el.textContent.trim()))?.click()`);
    await wait(700);
    const fits = await mainWindow.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'); assert.equal(fits, true);
    fs.writeFileSync(path.join(output, 'Browse-compact.png'), (await mainWindow.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ success: true, compactLayoutFits: fits, pages: report }, null, 2));
  } finally { app.quit(); }
};

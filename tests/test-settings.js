const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(__dirname, '.settings-check-'));
const file = path.join(directory, 'data.json');
const storeModule = require.resolve('../source/src/store');
try {
  let store = require(storeModule);
  store.init(file);
  store.saveTasks([{ id: 'existing-download' }]);
  const folder = path.join(directory, 'chosen-downloads');
  store.saveSettings({ root: folder, max_concurrent: 4 });
  delete require.cache[storeModule];
  store = require(storeModule);
  store.init(file);
  assert.equal(store.getSettings().root, folder, 'Folder must survive a fresh store instance');
  assert.equal(store.getTasks()[0].id, 'existing-download', 'Saving folder must preserve downloads');
  store.saveTasks([{ id: 'later-download' }]);
  assert.equal(JSON.parse(fs.readFileSync(file)).settings.root, folder, 'Download updates must preserve folder');
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => store.saveSettings({ root: 'should-not-save' }), 'Write failures must be reported');
  assert.equal(store.getSettings().root, folder, 'Failed save must restore the previous in-memory folder');
  assert.equal(JSON.parse(fs.readFileSync(file)).settings.root, folder, 'Failed save must preserve the previous file');
  console.log('PASS: folder persists after reload, tasks preserved, write failures reported, rollback preserves settings');
} finally {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const summarize = require('../source/src/catalog-downloads');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amara-completion-'));
try {
  fs.writeFileSync(path.join(directory, 'saved.mp4'), 'video');
  fs.writeFileSync(path.join(directory, 'empty.mp4'), '');
  const task = { directory, filename: 'saved.mp4', status: 'completed', catalog: { platform: 'dramabox', dramaId: 'show', chapterId: '1', lang: 'en' } };
  const tasks = [task, { ...task }, { ...task, status: 'downloading' }, { ...task, filename: 'missing.mp4', catalog: { ...task.catalog, chapterId: '2' } }, { ...task, filename: 'empty.mp4', catalog: { ...task.catalog, chapterId: '3' } }, { ...task, catalog: { ...task.catalog, lang: 'km' } }, { ...task, catalog: { ...task.catalog, platform: 'other' } }];
  const result = summarize(tasks);
  assert.equal(result.length, 3, 'Provider and language identities remain separate');
  assert.deepEqual(result[0].chapterIds, ['1'], 'Only unique completed episodes with nonempty files count');
  fs.unlinkSync(path.join(directory, 'saved.mp4'));
  assert.deepEqual(summarize(tasks), [], 'Deleted or disconnected files lose the completion mark');
  const albumDir = path.join(directory, 'Amara', 'Foolish Daughter, Deadly Sword God [stardusttv-9688]');
  fs.mkdirSync(albumDir, { recursive: true });
  const album = { platform: 'stardusttv', episodes: [{ number: 1, chapterId: '1' }, { number: 2, chapterId: '2' }, { number: 3, chapterId: '3' }] };
  fs.writeFileSync(path.join(albumDir, 'album.json'), JSON.stringify(album));
  fs.writeFileSync(path.join(albumDir, 'Episode 001.mp4'), 'video');
  fs.writeFileSync(path.join(albumDir, 'Episode 002.mp4'), '');
  assert.deepEqual(summarize([], [directory]), [{ platform: 'stardusttv', dramaId: '9688', lang: 'en', chapterIds: ['1'] }], 'Legacy albums retain marks after the queue is cleared; missing and empty files do not count');
  fs.writeFileSync(path.join(albumDir, 'album.json'), JSON.stringify({ ...album, dramaId: 'explicit-id', lang: 'km' }));
  assert.equal(summarize([], [directory])[0].dramaId, 'explicit-id');
  assert.equal(summarize([], [directory])[0].lang, 'km', 'New albums preserve language identity');
  fs.unlinkSync(path.join(albumDir, 'Episode 001.mp4'));
  assert.deepEqual(summarize([], [directory]), [], 'Deleting a saved album video removes its mark');
  console.log('PASS: existing completed files, deduplication, missing/empty/in-progress exclusion, provider/language separation, removed files');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

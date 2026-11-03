const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../source/src/library-scan');
const root = fs.mkdtempSync(path.join(__dirname, '.library-check-'));
const created = [], directories = [root];
function video(folder, name) {
  const file = path.join(folder, name); fs.writeFileSync(file, Buffer.alloc(103000)); created.push(file); return file;
}
function directory(name) { const dir = path.join(root, name); fs.mkdirSync(dir); directories.push(dir); return dir; }
try {
  const moved = directory('Renamed show');
  const target = video(moved, 'Original show 001.mp4');
  const registry = [{ series_id: '123', series_title: 'Original show', episodes: [{ vid_index: 1, vid: 'v1' }] }];
  const tasks = [{ id: 'original', status: 'completed', filename: 'Original show 001.mp4', savePath: path.join(root, 'old', 'Original show 001.mp4'), hongguoInfo: { series_id: '123', vid_index: 1 } }];
  const local = directory('My local videos'); video(local, 'Episode 002.webm'); video(local, 'Episode 001.mp4');
  const result = scan(root, tasks, registry);
  assert.equal(result.relocated, 1);
  assert.equal(tasks.find(t => t.id === 'original').savePath, target);
  assert.equal(result.count, 2);
  assert.equal(registry.find(s => s.local).episodes.length, 2);
  assert.equal(scan(root, tasks, registry).count, 0, 'Repeated scans must not duplicate videos');
  fs.unlinkSync(target); created.splice(created.indexOf(target), 1);
  assert.equal(scan(root, tasks, registry).missing, 1);
  assert.equal(tasks.find(t => t.id === 'original').status, 'stopped');
  video(moved, 'Original show 001.mp4');
  scan(root, tasks, registry);
  assert.equal(tasks.find(t => t.id === 'original').status, 'completed', 'Restored files should become playable again');
  const snapshot = JSON.stringify(tasks);
  assert.equal(scan(path.join(root, 'unavailable'), tasks, registry).success, false);
  assert.equal(JSON.stringify(tasks), snapshot, 'An unavailable drive must not alter the library');
  const active = { status: 'downloading', savePath: path.join(root, 'active.mp4'), hongguoInfo: { series_id: '123', vid_index: 3 } };
  tasks.push(active); scan(root, tasks, registry); assert.equal(active.status, 'downloading');
  console.log('PASS: moved paths, renamed folders, local videos, repeated scans, missing/restored files, unavailable drives, active downloads');
} finally {
  for (const file of created) fs.unlinkSync(file);
  for (const dir of directories.reverse()) fs.rmdirSync(dir);
}

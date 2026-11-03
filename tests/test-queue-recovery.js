const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const queue = require('../source/src/queue-recovery');
const directory = fs.mkdtempSync(path.join(__dirname, '.queue-check-'));
const file = path.join(directory, 'queue.json');
try {
  const statuses = ['queued','resolving','downloading','retrying','completed','stopped','unavailable'];
  const tasks = statuses.map((status, id) => ({ id, status, speedBps: 12 }));
  const restored = queue.restore(tasks);
  assert.deepEqual(restored.map(task => task.status), ['queued','queued','queued','queued','completed','stopped','unavailable']);
  assert.equal(restored[0].speedBps, 0);
  assert.equal(tasks[2].status, 'downloading', 'Recovery must not mutate saved input');
  queue.save(file, { tasks });
  queue.save(file, { tasks: [{ id: 'new' }] });
  assert.equal(queue.load(file).tasks[0].id, 'new');
  fs.writeFileSync(file, '{interrupted write');
  assert.equal(queue.load(file).tasks.length, tasks.length, 'Read the last good backup after a damaged save');
  queue.save(file, { tasks: [{ id: 'repaired' }] });
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).tasks.length, tasks.length, 'Keep the good backup when recovering');
  console.log('PASS: automatic restart recovery, explicit stops preserved, stale speeds reset, atomic persistence and damaged-queue backup recovery');
} finally {
  for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);
}

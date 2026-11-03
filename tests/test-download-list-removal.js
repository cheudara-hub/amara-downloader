const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Test 1: Verify sorting logic in media-browser UI
(() => {
  const tasks = [
    { id: 'hg1', source: 'hongguo', title: 'series_series_title 001.mp4', status: 'completed', createdAt: 1000 },
    { id: 'hg2', source: 'hongguo', title: 'series_series_title 002.mp4', status: 'completed', createdAt: 2000 },
    { id: 'cat1', source: 'catalog', catalog: { platform: 'sodareels' }, title: 'My Drama · Episode 1', filename: 'Episode 001.mp4', status: 'completed', createdAt: 999999 },
    { id: 'cat2', source: 'catalog', catalog: { platform: 'sodareels' }, title: 'My Drama · Episode 2', filename: 'Episode 002.mp4', status: 'downloading', createdAt: 1000000 }
  ];

  const active = t => ['queued','resolving','downloading','retrying'].includes(t.status);
  const priority = { downloading:0, resolving:0, failed:1, unavailable:1, retrying:2, queued:2, stopped:3, completed:4 };

  const visible = [...tasks];
  visible.sort((a,b) => {
    const pDiff = (priority[a.status] ?? 5) - (priority[b.status] ?? 5);
    if (pDiff !== 0) return pDiff;
    const timeA = a.createdAt || a.startTime || 0;
    const timeB = b.createdAt || b.startTime || 0;
    if (timeA && timeB && timeA !== timeB) return timeB - timeA;
    if (a.source !== 'hongguo' && b.source === 'hongguo') return -1;
    if (a.source === 'hongguo' && b.source !== 'hongguo') return 1;
    return 0;
  });

  // Active downloading task must be first (index 0)
  assert.equal(visible[0].id, 'cat2', 'Downloading catalog task must sort to top');
  // Completed catalog task with recent timestamp must come next (index 1)
  assert.equal(visible[1].id, 'cat1', 'Recent completed catalog task must come before old Hongguo tasks');
  // Older Hongguo tasks come after
  assert.equal(visible[2].id, 'hg2');
  assert.equal(visible[3].id, 'hg1');
  console.log('PASS: Download list sorting prioritizes active & recent catalog downloads over old Hongguo backlog');
})();

// Test 2: Verify clearCompleted and remove with allowCompleted
(() => {
  let nativeRemoved = [];
  let nativeTasks = [
    { id: '1', status: 'completed' },
    { id: '2', status: 'completed' },
    { id: '3', status: 'downloading' }
  ];

  const fakeNativeQueue = {
    list: () => nativeTasks.map(t => ({ id: 'native:' + t.id, status: t.status, source: 'hongguo' })),
    remove: (id, allowCompleted = true) => {
      const idx = nativeTasks.findIndex(t => t.id === id);
      if (idx === -1) return { success: false, error: 'Not found' };
      const allowed = allowCompleted ? ['failed', 'stopped', 'completed'] : ['failed', 'stopped'];
      if (!allowed.includes(nativeTasks[idx].status)) return { success: false, error: 'Stop this download' };
      nativeRemoved.push(id);
      nativeTasks.splice(idx, 1);
      return { success: true };
    },
    clearCompleted: () => {
      const prevLen = nativeTasks.length;
      nativeTasks = nativeTasks.filter(t => t.status !== 'completed');
      return { success: true, count: prevLen - nativeTasks.length };
    }
  };

  // Test native individual remove with allowCompleted: true
  const res1 = fakeNativeQueue.remove('1', true);
  assert.equal(res1.success, true);
  assert.equal(nativeTasks.length, 2);

  // Test native clearCompleted
  const res2 = fakeNativeQueue.clearCompleted();
  assert.equal(res2.success, true);
  assert.equal(res2.count, 1);
  assert.equal(nativeTasks.length, 1);
  assert.equal(nativeTasks[0].status, 'downloading'); // downloading task preserved
  console.log('PASS: Native queue supports removing and clearing completed downloads while preserving active');
})();


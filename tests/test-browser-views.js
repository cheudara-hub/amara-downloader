const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attach, detach } = require('../source/src/browser-views');
const window = new EventEmitter(), views = [];
let ownerClosed = 0, applicationClosed = 0;
window.getBrowserViews = () => [...views];
window.addBrowserView = view => { views.push(view); window.on('closed', () => ownerClosed++); };
window.removeBrowserView = view => { const index = views.indexOf(view); if (index >= 0) views.splice(index, 1); };
window.on('closed', () => applicationClosed++);
const view = {};
for (let i = 0; i < 100; i++) {
  attach(window, view); attach(window, view);
  assert.equal(window.listenerCount('closed'), 2);
  assert.equal(views.length, 1);
  detach(window, view);
  assert.equal(window.listenerCount('closed'), 1, 'Navigation releases only the detached view listeners');
}
attach(window, view); window.emit('closed');
assert.equal(applicationClosed, 1); assert.equal(ownerClosed, 1);
console.log('PASS: repeated view navigation has bounded listeners, no duplicate attachments, and preserves window cleanup');

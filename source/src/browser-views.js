// This Electron runtime adds an owner-window close listener on every attachment.
// Release those listeners when detaching so repeated navigation stays bounded.
const attached = new WeakMap();
function attach(window, view) {
  if (window.getBrowserViews().includes(view)) return;
  const previous = attached.get(view);
  if (previous) detach(previous.window, view);
  const before = new Set(window.listeners('closed'));
  window.addBrowserView(view);
  attached.set(view, { window, listeners: window.listeners('closed').filter(listener => !before.has(listener)) });
}
function detach(window, view) {
  window.removeBrowserView(view);
  const registration = attached.get(view);
  if (registration?.window === window) {
    for (const listener of registration.listeners) window.removeListener('closed', listener);
    attached.delete(view);
  }
}
module.exports = { attach, detach };

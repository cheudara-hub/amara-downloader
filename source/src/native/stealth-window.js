// Reuse the playing window so media, stream sessions and playback position stay intact.
function createStealthController({ screen, getWindow }) {
  let previous = null;
  let timer = null;
  let concealed = false;
  const send = win => win.webContents.send('stealth-state', { enabled: !!previous, concealed });
  const reveal = win => { concealed = false; win.setOpacity(1); };
  const setEnabled = enabled => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (enabled === !!previous) return;
    if (!enabled) {
      clearInterval(timer); timer = null;
      const saved = previous;
      previous = null;
      reveal(win);
      win.setMinimumSize(...saved.minimum);
      win.setBounds(saved.bounds);
      win.setAlwaysOnTop(saved.onTop);
      win.setVisibleOnAllWorkspaces?.(saved.visibleOnAllWorkspaces, { visibleOnFullScreen: true });
      win.setFullScreenable(true);
      if (saved.maximized) win.maximize();
      send(win);
      return;
    }
    previous = { bounds: win.getNormalBounds(), minimum: win.getMinimumSize(), onTop: win.isAlwaysOnTop(), maximized: win.isMaximized(),
      visibleOnAllWorkspaces: typeof win.isVisibleOnAllWorkspaces === 'function' ? win.isVisibleOnAllWorkspaces() : false };
    if (win.isMaximized()) win.unmaximize();
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const width = Math.min(400, area.width), height = Math.min(600, area.height);
    win.setMinimumSize(Math.min(300, width), Math.min(360, height));
    win.setBounds({ width, height, x: Math.max(area.x, Math.min(cursor.x - Math.round(width / 2), area.x + area.width - width)), y: Math.max(area.y, Math.min(cursor.y - 60, area.y + area.height - height)) });
    win.setAlwaysOnTop(true);
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    win.setFullScreenable(false);
    reveal(win);
    send(win);
    timer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(timer); timer = null; return; }
      const p = screen.getCursorScreenPoint(), b = win.getBounds();
      const outside = win.isMinimized() || p.x < b.x || p.x >= b.x + b.width || p.y < b.y || p.y >= b.y + b.height;
      if (outside === concealed) return;
      concealed = outside;
      // Opacity keeps the hit region available; polling restores it even when no DOM hover fires.
      win.setOpacity(concealed ? 0 : 1);
      send(win);
    }, 100);
    timer.unref?.();
  };
  return { setEnabled, get enabled() { return !!previous; }, dispose() { clearInterval(timer); timer = null; previous = null; concealed = false; } };
}
module.exports = { createStealthController };

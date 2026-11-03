// Keep the complete window inside the current display, including after unplugging a monitor.
function fitWindowBounds(mode, current, workArea, previous) {
  if (!['portrait', 'landscape'].includes(mode)) throw new Error('Invalid window layout');
  const height = Math.min(mode === 'portrait' ? 940 : (previous?.height || 750), workArea.height);
  const width = Math.min(mode === 'portrait' ? Math.min(620, Math.round(height * 0.74)) : (previous?.width || 1100), workArea.width);
  const origin = mode === 'landscape' && previous ? previous : {
    x: Math.round(current.x + (current.width - width) / 2),
    y: Math.round(current.y + (current.height - height) / 2),
  };
  return {
    x: Math.max(workArea.x, Math.min(origin.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(origin.y, workArea.y + workArea.height - height)),
    width, height,
  };
}
// Window resizing changes available space, never the user's chosen text size.
function getWindowScale(value = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
}
function saveWindowZoom(store, direction) {
  if (!['in', 'out', 'reset'].includes(direction)) throw new Error('Invalid zoom direction');
  const settings = store.getSettings() || {};
  const current = getWindowScale(settings.ui_zoom);
  const next = direction === 'reset' ? 1 : Math.round((current + (direction === 'in' ? 0.1 : -0.1)) * 10) / 10;
  store.saveSettings({ ...settings, ui_zoom: getWindowScale(next) });
}
module.exports = { fitWindowBounds, getWindowScale, saveWindowZoom };

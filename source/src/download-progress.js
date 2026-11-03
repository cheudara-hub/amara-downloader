// Sample actual bytes over a rolling window, including periods with no output.
module.exports = function trackDownload(task, notify, now = Date.now) {
  let samples = [{ time: now(), bytes: 0 }], pending = '';
  task.speedBps = 0;
  function tick() {
    const time = now(), bytes = task.bytes || 0;
    samples.push({ time, bytes });
    while (samples.length > 2 && samples[1].time <= time - 5000) samples.shift();
    const first = samples[0], elapsed = time - first.time;
    task.speedBps = elapsed >= 500 ? Math.max(0, (bytes - first.bytes) * 1000 / elapsed) : 0;
    notify();
  }
  return {
    tick,
    reset() { samples = [{ time: now(), bytes: 0 }]; pending = ''; task.speedBps = 0; task.bytes = 0; task.time = ''; delete task.totalBytes; },
    read(chunk, countBytes = true) {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) {
        const index = line.indexOf('=');
        const key = line.slice(0, index), value = line.slice(index + 1);
        if (key === 'total_size' && countBytes && /^\d+$/.test(value)) task.bytes = Number(value);
        if (key === 'out_time' && /^\d+:\d+:\d+/.test(value)) task.time = value.split('.')[0];
      }
    },
  };
};

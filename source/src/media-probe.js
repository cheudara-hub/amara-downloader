// Explicit development flag: resolve real episodes and save only short verification clips.
module.exports = async function probe(mediaBrowser) {
  const { app, session, BrowserWindow } = require('electron');
  const keeper = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const fs = require('fs'), path = require('path');
  const { spawn } = require('child_process');
  const root = path.join(process.resourcesPath, '..', '..', 'artifacts', 'browser-debug');
  fs.mkdirSync(root, { recursive: true });
  const report = [];
  try {
    const requested = process.argv.find(arg => arg.startsWith('--probe-episodes='));
    const manifestPath = process.argv.find(arg => arg.startsWith('--probe-manifest='))?.split('=').slice(1).join('=');
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).episodes : [];
    const count = Math.min(100, Math.max(0, Number(process.argv.find(arg => arg.startsWith('--probe-count='))?.split('=')[1]) || 0));
    const episodes = count ? Array.from({ length: count }, (_, i) => i + 1) : requested ? requested.split('=')[1].split(',').map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 500).slice(0, 100) : [1, 2];
    const resolveOnly = process.argv.includes('--resolve-only');
    const checkEpisode = async episode => {
      const replacement = manifest.find(item => item.number === episode);
      const task = { id: 'probe-' + episode, url: replacement?.playerUrl || 'https://www.phumi7.net/read/1178/' + episode, referer: 'https://www.phumi7.net/album/1178', status: 'resolving' };
      const started = Date.now();
      try {
        const source = await mediaBrowser.resolveForCheck(task);
        console.log('Resolved episode', episode, 'using', new URL(source.url).hostname);
        if (!resolveOnly) {
        const output = path.join(root, 'episode-' + episode + '-sample.mp4');
        const ses = session.fromPartition('persist:amara-media');
        await new Promise((resolve, reject) => {
          const child = spawn(path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-rw_timeout', '25000000', '-user_agent', ses.getUserAgent(), '-headers', 'Referer: ' + source.referer + '\r\n', '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-i', source.url, '-t', '3', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', output], { windowsHide: true });
          let tail = '';
          const timer = setTimeout(() => { child.kill(); reject(new Error('Short clip verification timed out.')); }, 60000);
          child.stderr.on('data', data => { tail = (tail + data).slice(-1200); });
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(tail || 'FFmpeg failed: ' + code)); });
        });
        report.push({ episode, success: true, sourceHost: new URL(source.url).hostname, refererHost: new URL(source.referer).hostname, streamType: /\.m3u8(?:[?#]|$)/i.test(source.url) ? 'hls' : 'direct', alternativeCount: source.alternatives?.length || 0, bytes: fs.statSync(output).size, elapsedMs: Date.now() - started });
        } else { report.push({ episode, success: true, resolvedOnly: true, sourceHost: new URL(source.url).hostname, streamType: /\.m3u8(?:[?#]|$)/i.test(source.url) ? 'hls' : 'direct', elapsedMs: Date.now() - started }); }
      } catch (error) { report.push({ episode, success: false, code: error.code || 'RESOLUTION_FAILED', error: error.message, elapsedMs: Date.now() - started }); }
      fs.writeFileSync(path.join(root, 'download-check.json'), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(root, 'download-check-' + process.pid + '.json'), JSON.stringify(report, null, 2));
      console.log('Checked episode', episode, report.at(-1).success ? 'PASS' : 'FAIL');
    };
    const waiting = episodes.slice();
    const worker = async () => { while (waiting.length) await checkEpisode(waiting.shift()); };
    await Promise.all(Array.from({ length: resolveOnly ? 2 : 1 }, worker));
  } finally { keeper.destroy(); app.quit(); }
};

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const axios = require('axios');

const client = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
});

// Windows curl uses Schannel's trusted certificate store and chain building.
// Certificate verification remains enabled; no insecure TLS flags are used.
function curlRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), headerComplete = false, child, stderr = '';
    const fail = error => { if (!headerComplete) reject(error); body.destroy(error); };
    const body = new Transform({
      transform(chunk, _encoding, callback) {
        if (headerComplete) return callback(null, chunk);
        buffer = Buffer.concat([buffer, chunk]);
        while (!headerComplete) {
          const boundary = buffer.indexOf('\r\n\r\n');
          if (boundary < 0) {
            if (buffer.length > 65536) return callback(new Error('Oversized HTTP response headers'));
            return callback();
          }
          const lines = buffer.subarray(0, boundary).toString('latin1').split('\r\n');
          buffer = buffer.subarray(boundary + 4);
          const status = /^HTTP\/\S+\s+(\d+)/.exec(lines[0]);
          if (!status) return callback(new Error('Invalid HTTP response headers'));
          const code = Number(status[1]);
          if (code < 200 || (code >= 300 && code < 400) || /connection established/i.test(lines[0])) continue;
          const headers = {};
          for (const line of lines.slice(1)) {
            const index = line.indexOf(':');
            if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
          }
          headerComplete = true;
          resolve({ status: code, headers, data: body });
        }
        const remaining = buffer; buffer = Buffer.alloc(0);
        callback(null, remaining);
      },
    });
    body.on('error', error => { if (!headerComplete) reject(error); });
    const abort = () => {
      const error = new Error('Download stopped'); error.name = 'AbortError';
      child?.kill(); fail(error);
    };
    if (options.signal?.aborted) { abort(); return; }
    // Provider filenames can contain literal [EN] or {name}. curl's URL
    // globbing would interpret those as ranges/lists and reject valid covers.
    const args = ['--globoff', '--silent', '--show-error', '--include', '--location', '--max-redirs', '5',
      '--connect-timeout', '15', '--speed-limit', '1024', '--speed-time', '45',
      '--no-buffer', '--proto', '=http,https', '--proto-redir', '=http,https'];
    for (const [name, value] of Object.entries(options.headers || {})) {
      if (value == null) continue;
      if (!/^[A-Za-z0-9-]+$/.test(name) || /[\r\n]/.test(String(value))) { fail(new Error('Invalid HTTP header')); return; }
      args.push('--header', `${name}: ${value}`);
    }
    args.push('--url', url);
    const executable = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe') : 'curl';
    child = spawn(executable, args, { windowsHide: true });
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.pipe(body);
    child.stdout.on('error', fail);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-500); });
    child.once('error', fail);
    child.once('close', code => {
      options.signal?.removeEventListener('abort', abort);
      if (!body.destroyed && (code !== 0 || !headerComplete)) fail(new Error(`System HTTP transfer failed (${code}): ${stderr.trim()}`));
    });
    body.once('close', () => child.kill());
  });
}

async function getStream(url, options) {
  // Use the same Windows HTTP/TLS implementation for every range, including
  // hosts whose signed URLs are rejected by the older embedded Node client.
  if (process.platform === 'win32') return curlRequest(url, options);
  return client.get(url, options);
}
module.exports = { getStream, curlRequest };

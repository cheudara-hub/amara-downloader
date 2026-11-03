/**
 * store.js - 精简持久化模块
 * 用单个 JSON 文件保存「设置」与「下载任务」，替代原项目里的 sql.js 数据库 + electron-store，
 * 减少依赖，方便独立打包。
 */
const fs = require('fs');
const path = require('path');

let dataFile = null;
let cache = null; // { settings, tasks }
let durable = '{}';
let errorHandler = null;
let readError = null;
let writeError = false;
const READ_ERROR_MESSAGE = 'Failed to read local data. Original file retained. Please check file permissions and restart.';

function reportReadError() {
  try { errorHandler?.({ error: READ_ERROR_MESSAGE }); } catch {}
}

function loadCache() {
  if (!dataFile) throw new Error('store 未初始化');
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
      throw new TypeError('Invalid store document');
    }
    for (const key of ['tasks', 'series', 'mergeTasks']) {
      if (key in cache && !Array.isArray(cache[key])) throw new TypeError(`Invalid store ${key}`);
    }
    for (const key of ['settings', 'playback']) {
      if (key in cache && (!cache[key] || typeof cache[key] !== 'object' || Array.isArray(cache[key]))) {
        throw new TypeError(`Invalid store ${key}`);
      }
    }
  } catch (e) {
    cache = {};
    if (e.code !== 'ENOENT') {
      readError = new Error(READ_ERROR_MESSAGE, { cause: e });
      readError.code = 'STORE_READ_FAILED';
      reportReadError();
    }
  }
  if (!Array.isArray(cache.tasks)) cache.tasks = [];
  if (!cache.settings || typeof cache.settings !== 'object') cache.settings = {};
  durable = JSON.stringify(cache);
  return cache;
}

function flush() {
  if (!dataFile) return;
  if (readError) {
    cache = JSON.parse(durable);
    reportReadError();
    throw readError;
  }
  const temporary = dataFile + '.tmp';
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const serialized = JSON.stringify(cache || {}, null, 2);
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, serialized, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, dataFile);
    durable = serialized;
    if (writeError) {
      writeError = false;
      try { errorHandler?.(null); } catch {}
    }
  } catch (e) {
    try { fs.unlinkSync(temporary); } catch {}
    cache = JSON.parse(durable);
    writeError = true;
    try { errorHandler?.({ error: 'Save failed. Please check disk space or permissions; changes not saved.' }); } catch {}
    throw e;
  }
}

function init(filePath) {
  dataFile = filePath;
  cache = null;
  readError = null;
  writeError = false;
  loadCache();
}

function getSettings() {
  return loadCache().settings;
}

function saveSettings(settings) {
  loadCache().settings = settings || {};
  flush();
}

function getTasks() {
  return loadCache().tasks;
}

function saveTasks(tasks) {
  loadCache().tasks = tasks || [];
  flush();
}

// ===== 短剧档案（让播放页在没有下载任务时也能列出完整分集）=====
function getSeries() {
  const c = loadCache();
  if (!Array.isArray(c.series)) c.series = [];
  return c.series;
}

function saveSeries(list) {
  loadCache().series = list || [];
  flush();
}

// ===== 播放进度（断点续播）=====
function getPlayback() {
  const c = loadCache();
  if (!c.playback || typeof c.playback !== 'object') c.playback = {};
  return c.playback;
}

function savePlayback(map) {
  loadCache().playback = map || {};
  flush();
}

// ===== 合并任务记录 =====
function getMergeTasks() {
  const c = loadCache();
  if (!Array.isArray(c.mergeTasks)) c.mergeTasks = [];
  return c.mergeTasks;
}

function saveMergeTasks(list) {
  loadCache().mergeTasks = list || [];
  flush();
}

module.exports = {
  setErrorHandler: (handler) => { errorHandler = handler; },
  init,
  getSettings,
  saveSettings,
  getTasks,
  saveTasks,
  getSeries,
  saveSeries,
  getPlayback,
  savePlayback,
  getMergeTasks,
  saveMergeTasks,
};

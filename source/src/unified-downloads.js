// Project native tasks for the shared screen; ownership and persistence stay native.
module.exports = function nativeDownloads(tasks) {
  return tasks.map(task => ({
    id: 'native:' + task.id, source: 'hongguo',
    title: task.filename || task.hongguoInfo?.series_title || 'Hongguo episode',
    status: task.status === 'pending' ? 'queued' : task.status === 'failed' && task.retryAt ? 'retrying' : task.status,
    bytes: task.receivedBytes || 0, totalBytes: task.totalBytes || 0,
    progress: task.progress || 0, speedBps: task.speedBps || 0,
    method: task.method, connections: task.connections,
    error: task.error || '', retryAt: task.retryAt,
    filename: task.filename || '',
    startTime: task.startTime || 0, createdAt: task.startTime || 0,
  }));
};

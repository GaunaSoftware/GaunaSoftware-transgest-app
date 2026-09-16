const path = require('node:path');

function appFile(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'transgest:' || url.host !== 'app' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    // Runtime product navigation must serve the same application entry point.
    const entry = ['/', '/index.html', '/planner', '/planner/'].includes(pathname);
    const file = path.resolve(root, entry ? 'index.html' : '.' + pathname);
    return file.startsWith(path.resolve(root) + path.sep) ? file : null;
  } catch {
    return null;
  }
}
module.exports = { appFile };

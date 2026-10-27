// Electron hardening. The renderer can ask the main process to delete files,
// so only the app's own page may talk to it, and that page must never be
// replaced by something else (a dropped file, a link, a popup).

const { pathToFileURL } = require('url');

// Content-Security-Policy for the production build (injected by vite.config.js).
// Dev skips it: Vite's hot reload needs inline scripts and a websocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",   // React writes inline style attributes
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

// True only for the app's own page: the Vite dev server in development, the
// built dist/index.html otherwise. Query and hash are ignored.
function makeAppUrlCheck({ isDev, devUrl, indexPath }) {
  const devOrigin = new URL(devUrl).origin;
  const fileUrl = pathToFileURL(indexPath).href;
  return (url) => {
    if (!url) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (isDev) return u.origin === devOrigin;
    return u.protocol === 'file:' && `${u.protocol}//${u.host}${u.pathname}` === fileUrl;
  };
}

// Apply to every web contents the app creates.
function hardenWebContents(contents, isAppUrl) {
  // A file dropped outside a drop zone, or any link, would otherwise replace
  // the app page (and keep the preload bridge).
  contents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// The app needs no camera, notifications, geolocation, etc.
function denyAllPermissions(session) {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

module.exports = { CSP, makeAppUrlCheck, hardenWebContents, denyAllPermissions };

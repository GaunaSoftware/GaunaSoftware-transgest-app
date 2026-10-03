const http = require('node:http');
const path = require('node:path');
const express = require('express');

function createGateway({ webRoot, backendPort = 3001 }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-TransGest-Environment': 'staging', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  const proxy = (req, res) => {
    const headers = { ...req.headers, host: `127.0.0.1:${backendPort}` };
    delete headers.connection;
    headers['x-forwarded-proto'] = 'https';
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.originalUrl, method: req.method, headers }, response => {
      res.status(response.statusCode);
      for (const [key, value] of Object.entries(response.headers)) if (key !== 'connection' && value !== undefined) res.setHeader(key, value);
      response.pipe(res);
      response.on('error', () => res.destroy());
    });
    upstream.setTimeout(120000, () => upstream.destroy());
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.status(502).json({ error: 'El servidor de pruebas no está disponible.' });
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  };
  app.use('/api/', proxy);
  app.get('/health', proxy);
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.maptiler.com https://tiles.openfreemap.org https://*.hereapi.com; worker-src 'self' blob:; frame-src 'self' blob: data:; manifest-src 'self'; upgrade-insecure-requests");
    next();
  });
  app.use(express.static(webRoot, { index: false, etag: false, lastModified: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  return app;
}
module.exports = { createGateway };

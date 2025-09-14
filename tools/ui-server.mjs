import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = path.resolve(path.join(process.cwd()));
const REACT_DIST = path.join(ROOT, 'web', 'dist');
const PROXY_BASE = 'http://127.0.0.1:8787';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', ...headers };
  res.writeHead(status, h);
  res.end(body);
}

function proxy(req, res, target) {
  const t = new url.URL(target);
  const mod = t.protocol === 'https:' ? https : http;
  const opts = {
    method: req.method,
    headers: { ...req.headers, host: t.host },
  };
  const p = mod.request(t, opts, (pr) => {
    res.writeHead(pr.statusCode || 502, pr.headers);
    pr.pipe(res);
  });
  p.on('error', (e) => send(res, 502, String(e)));
  if (req.method !== 'GET' && req.method !== 'HEAD') req.pipe(p); else p.end();
}

const server = http.createServer((req, res) => {
  try {
    const u = new url.URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(u.pathname);
    // Favicon placeholder to avoid 404 noise
    if (pathname === '/favicon.ico') {
      return send(res, 204, '');
    }

    // Proxy endpoints
    if (pathname === '/api/fgi') {
      return proxy(req, res, PROXY_BASE + '/api/fgi' + (u.search || ''));
    }
    if (pathname.startsWith('/api/yf/')) {
      return proxy(req, res, PROXY_BASE + pathname + (u.search || ''));
    }
    if (pathname === '/api/signals') {
      return proxy(req, res, PROXY_BASE + '/api/signals');
    }

    // React app (built) under /react and /assets
    if (pathname === '/react' || pathname.startsWith('/react/')) {
      const indexPath = path.join(REACT_DIST, 'index.html');
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf8');
        const inject = '<script>try{window.__REACT_DEVTOOLS_GLOBAL_HOOK__=undefined;}catch(e){}</script>';
        if (!html.includes('__REACT_DEVTOOLS_GLOBAL_HOOK__')) {
          html = html.replace('<head>', '<head>' + inject);
        }
        return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      return send(res, 404, 'React dist not found');
    }
    if (pathname.startsWith('/assets/')) {
      const p = path.join(REACT_DIST, pathname.replace(/^\/assets\//, 'assets/'));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.extname(p).toLowerCase();
        const type = mime[ext] || 'application/octet-stream';
        return send(res, 200, fs.readFileSync(p), { 'Content-Type': type });
      }
    }

    // Static data folder
    if (pathname.startsWith('/data/')) {
      const p = path.join(ROOT, pathname.replace(/^\//, ''));
      if (!p.startsWith(ROOT)) return send(res, 403, 'Forbidden');
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.extname(p).toLowerCase();
        const type = mime[ext] || 'application/octet-stream';
        return send(res, 200, fs.readFileSync(p), { 'Content-Type': type });
      }
      return send(res, 404, 'Not Found');
    }

    // NMY.html default
    if (pathname === '/' || pathname === '/index.html') {
      const p = path.join(ROOT, 'NMY.html');
      return send(res, 200, fs.readFileSync(p), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    // Serve arbitrary files under root (for NMY.html assets)
    const p = path.join(ROOT, pathname.replace(/^\//, ''));
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      const ext = path.extname(p).toLowerCase();
      const type = mime[ext] || 'application/octet-stream';
      return send(res, 200, fs.readFileSync(p), { 'Content-Type': type });
    }
    return send(res, 404, 'Not Found');
  } catch (e) {
    return send(res, 500, String(e?.message || e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`UI server listening at http://127.0.0.1:${PORT}`);
});

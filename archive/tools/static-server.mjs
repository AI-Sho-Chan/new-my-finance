import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = 5500;

const mime = (f) => {
  const ext = path.extname(f).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.map': 'application/json; charset=utf-8',
      '.wasm': 'application/wasm',
    }[ext] || 'application/octet-stream'
  );
};

const server = http.createServer((req, res) => {
  try {
    let p = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (p.endsWith('/')) p += 'index.html';
    // serve from project root
    const filePath = path.resolve(ROOT, '.' + p);
    if (!filePath.startsWith(ROOT)) throw new Error('Path traversal');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime(filePath), 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(e?.message || e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Static server at http://localhost:${PORT}`);
});

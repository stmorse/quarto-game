// Minimal static file server — the app needs http:// for ES modules and the
// Web Worker, so opening index.html from the filesystem will not work.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Quarto running at http://localhost:${PORT}`);
});

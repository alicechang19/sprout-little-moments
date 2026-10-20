// Local server: the static site plus the api/ functions, run the way Vercel runs them. It never serves api/
// source (that's where the odds live) or dotfiles, and tells the browser to recheck files so edits show up.
// Run: node tools/dev-server.mjs   (PORT sets the port, default 5179)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pick from '../api/pick.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5179;
const API = { '/api/pick': pick };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};

const send = (res, code, body = '') => { res.statusCode = code; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(body); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
  if (API[path]) return API[path](req, res);
  if (path.startsWith('/api/') || path.split('/').some((s) => s.startsWith('.'))) return send(res, 404, 'Not found');

  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden'); // ../ out of the project
  try {
    if ((await stat(file)).isDirectory()) {
      // a folder's page needs the trailing slash, or its relative links point one level up
      if (!path.endsWith('/')) { res.statusCode = 301; res.setHeader('Location', `${path}/${url.search}`); return res.end(); }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Sprout: http://localhost:${PORT}`));


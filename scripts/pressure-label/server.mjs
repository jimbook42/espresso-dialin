import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = '/workspace/pl-state/label-frames';
const LABELS_PATH = '/workspace/pl-state/labels.json';
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function tokenOk(url) {
  const token = process.env.LABEL_TOKEN;
  if (!token) return false;
  return url.searchParams.get('k') === token;
}

function readLabels() {
  if (!fs.existsSync(LABELS_PATH)) return { frames: {} };
  try {
    return JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8'));
  } catch {
    return { frames: {} };
  }
}

function writeLabelsAtomic(doc) {
  const dir = path.dirname(LABELS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${LABELS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, LABELS_PATH);
}

function notFound(res) {
  res.writeHead(404);
  res.end();
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}`);
  if (!tokenOk(url)) return notFound(res);

  const pathname = url.pathname;

  if (pathname === '/api/manifest' && req.method === 'GET') {
    const manifestPath = path.join(FRAMES_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return notFound(res);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(manifestPath));
    return;
  }

  if (pathname === '/api/labels') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(readLabels()));
      return;
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      if (!body || typeof body !== 'object' || !body.frames) {
        res.writeHead(400);
        res.end('expected { frames: ... }');
        return;
      }
      writeLabelsAtomic(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  if (pathname.startsWith('/frames/')) {
    const base = path.basename(pathname);
    if (base.includes('..')) return notFound(res);
    const framePath = path.join(FRAMES_DIR, base);
    if (!fs.existsSync(framePath)) return notFound(res);
    return serveFile(res, framePath);
  }

  const staticName = pathname === '/' ? 'index.html' : path.basename(pathname);
  const staticPath = path.join(__dirname, staticName);
  if (fs.existsSync(staticPath) && staticPath.startsWith(__dirname)) {
    if (staticName === 'index.html') {
      const q = url.search;
      let html = fs.readFileSync(staticPath, 'utf8');
      html = html.replace('href="style.css"', `href="style.css${q}"`);
      html = html.replace('src="app.js"', `src="app.js${q}"`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    return serveFile(res, staticPath);
  }

  notFound(res);
});

server.listen(PORT, HOST, () => {
  console.log(`pressure-label http://${HOST}:${PORT}/?k=…`);
});

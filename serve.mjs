// 零依赖静态服务器：这台机器连不上 npm registry，所以不装 vite。
// 只用 node 内置模块，负责正确的 MIME 与 no-cache，改完刷新就能看到。
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = normalize(join(ROOT, relative));
  // 目录逃逸防护：解析后必须仍在 ROOT 内。
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  const target = resolvePath(request.url ?? '/');
  if (!target) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Moebius Core demo  →  http://127.0.0.1:${PORT}/`);
  console.log(`three.js vendor    →  vendor/three/three.module.js`);
});

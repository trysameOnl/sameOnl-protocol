import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

export function startServer(rootDir = 'dist', port = 0) {
  const root = path.resolve(rootDir);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, close: () => srv.close() })));
}

if (process.argv[1]?.endsWith('serve.mjs')) {
  const s = await startServer(process.argv[2] || 'dist', Number(process.argv[3] || 47831));
  console.log(`serving on http://localhost:${s.port}`);
}

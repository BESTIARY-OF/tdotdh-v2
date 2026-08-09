import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('../../', import.meta.url))).replace(/[\\/]+$/, '');
const port = Number(process.argv[2] || 5174);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer((request, response) => {
  const requestPath = request.url?.split('?')[0] || '/';
  const requested = requestPath === '/' ? '/apps/field-guide/product/index.html' : requestPath;
  const file = normalize(join(root, requested.replace(/^[/\\]+/, '')));
  if (!file.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
  if (!existsSync(file)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`TDOTDH v2 field guide: http://127.0.0.1:${port}/`));

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Not found');
  }
}).listen(port, () => console.log(`Paleta is running at http://localhost:${port}`));

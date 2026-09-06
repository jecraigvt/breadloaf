import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = await realpath(path.dirname(fileURLToPath(import.meta.url)));
const photosRoot = await realpath(path.resolve(previewRoot, '../../public/photos'));
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4178);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port number between 1 and 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const entryFiles = new Set(['index.html', 'compare.css', 'compare.js', 'prototype.html', 'base.css', 'themes.css', 'prototype.js', 'fonts.css']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg']);
const assetExtensions = new Set([...imageExtensions, '.woff', '.woff2', '.ttf']);
const headers = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; frame-ancestors 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cache-Control': 'no-store',
};
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

const server = http.createServer(async (request, response) => {
  const fail = (status, message) => { response.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : message); };
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'This design preview only serves local static files.');
  try {
    const rawPath = (request.url || '/').split('?')[0];
    const decoded = decodeURIComponent(rawPath);
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((segment) => segment === '..' || segment === '.')) return fail(404, 'Not found.');
    const pathname = decoded === '/' ? '/index.html' : decoded;
    const relative = pathname.slice(1);
    const extension = path.extname(relative).toLowerCase();
    let root = previewRoot;
    let candidate;
    if (pathname.startsWith('/photos/') && imageExtensions.has(extension)) {
      root = photosRoot;
      candidate = path.resolve(root, pathname.slice('/photos/'.length));
    } else if (entryFiles.has(relative) || ((pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) && assetExtensions.has(extension))) {
      candidate = path.resolve(root, relative);
    } else return fail(404, 'Not found.');
    if (!inside(root, candidate)) return fail(404, 'Not found.');
    const resolved = await realpath(candidate);
    if (!inside(root, resolved)) return fail(404, 'Not found.');
    const info = await stat(resolved);
    if (!info.isFile()) return fail(404, 'Not found.');
    response.writeHead(200, { ...headers, 'Content-Type': types[extension], 'Content-Length': info.size });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(resolved);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    return fail(error instanceof URIError ? 400 : 404, 'Not found.');
  }
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Breadloaf Hill design study: http://127.0.0.1:${port}\nLocal prototypes only. No database, API, or live-site connections.\n`);
});
server.on('error', (error) => { process.stderr.write(`Could not start design preview: ${error.message}\n`); process.exitCode = 1; });

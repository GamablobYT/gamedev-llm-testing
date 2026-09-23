import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.glb':'model/gltf-binary', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const direct = path.resolve(root, '.' + pathname);
  const asset = path.resolve(root, 'public', '.' + pathname);
  if (!direct.startsWith(root + path.sep) || !asset.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  const file = fs.existsSync(direct) ? direct : asset;
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(bytes);
  });
});
server.listen(4173, '127.0.0.1', () => console.log('Tidal Bell: http://127.0.0.1:4173'));

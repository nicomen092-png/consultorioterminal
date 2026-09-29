// Servidor local sin Netlify CLI: sirve /public y enruta POST /api a la función.
// Uso: npm run dev:local  (usa datos en memoria salvo que definas las variables de Google)
if (!process.env.SHEET_ID) process.env.USE_MEMORY = '1';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handler } = require('./netlify/functions/api');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const root = path.join(__dirname, 'public');

http.createServer((req, res) => {
  if (req.url === '/api') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const r = await handler({ httpMethod: req.method, headers: req.headers, body: data });
      res.writeHead(r.statusCode, r.headers);
      res.end(r.body);
    });
    return;
  }
  const file = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8888, () => console.log('http://localhost:8888', process.env.USE_MEMORY ? '(datos en memoria)' : ''));

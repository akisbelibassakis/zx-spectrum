// Tiny static file server: node serve.js [port]  ->  http://localhost:8048
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = +(process.argv[2] || 8048);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([\\/]\.\.)+/, '');
  const file = path.join(root, p, /[\\/]$/.test(p) ? 'index.html' : '');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('ZX Spectrum emulator at http://localhost:' + port));

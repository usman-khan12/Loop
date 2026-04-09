const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? '/spreadsheet.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🔁 Loop test server running at:\n`);
  console.log(`  📋 Spreadsheet: http://localhost:${PORT}/spreadsheet.html`);
  console.log(`  📝 Form:        http://localhost:${PORT}/form.html\n`);
  console.log(`Press Ctrl+C to stop.\n`);
});

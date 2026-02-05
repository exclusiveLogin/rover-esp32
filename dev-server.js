/**
 * ============================================================
 * 🚀 Dev Server — Локальная отладка с MJPEG Proxy
 * ============================================================
 * 
 * Запуск:
 *   node dev-server.js [port]
 * 
 * Функции:
 *   - Раздача статики из /data
 *   - MJPEG Proxy (обход CORS для любых источников)
 * 
 * ============================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// === Конфигурация ===
const PORT = parseInt(process.argv[2]) || 8080;
const DATA_DIR = path.join(__dirname, 'data');

// MIME типы
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// === CORS заголовки ===
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// === Статика ===
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  
  // Убираем query string
  filePath = filePath.split('?')[0];
  
  const fullPath = path.join(DATA_DIR, filePath);
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }

    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// === MJPEG Proxy ===
// Проксирует MJPEG стрим и добавляет CORS заголовки
// 
// Использование:
//   /proxy/stream?url=http://192.168.1.100:8080/video
//
function proxyMjpeg(req, res, targetUrl) {
  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing url parameter. Usage: /proxy/stream?url=http://...');
    return;
  }

  console.log(`🔄 Proxy: ${targetUrl}`);

  const parsedUrl = new URL(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 80,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Копируем заголовки от источника
    const headers = {
      'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
    
    // Добавляем CORS
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';

    res.writeHead(proxyRes.statusCode, headers);

    // Пайпим данные
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error('Proxy source error:', err.message);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  });

  // Закрываем proxy при отключении клиента
  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

// === Сервер ===
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // MJPEG Proxy
  if (pathname === '/proxy/stream') {
    proxyMjpeg(req, res, parsedUrl.query.url);
    return;
  }

  // Статика
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  🚀 ESP32-CAM Rover Dev Server                           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  📁 Статика:  http://localhost:${PORT}/`);
  console.log(`║  🔄 Proxy:    http://localhost:${PORT}/proxy/stream?url=...`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Пример proxy для IP Webcam:                             ║');
  console.log('║  /proxy/stream?url=http://192.168.1.50:8080/video        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
});

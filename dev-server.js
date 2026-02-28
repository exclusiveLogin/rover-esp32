/**
 * ============================================================
 * Dev Server — Локальная отладка фронтенда с MJPEG Proxy
 * ============================================================
 *
 * Запуск:
 *   node dev-server.js [port]     (по умолчанию: 8080)
 *
 * Что делает:
 *   1. Раздаёт статику из папки /data (фронтенд FoxOnline)
 *   2. Проксирует MJPEG-стрим с внешнего источника (ESP32, IP Webcam)
 *      с добавлением CORS-заголовков — обход ограничений браузера
 *
 * Зачем proxy:
 *   Браузер блокирует запросы к другим хостам (CORS).
 *   ESP32 не умеет отдавать Access-Control-Allow-Origin.
 *   Dev-server берёт стрим с ESP32 и отдаёт клиенту
 *   с нужными заголовками — как будто это свой ресурс.
 *
 * Схема:
 *   Браузер (localhost:8080)
 *     ↓ GET /proxy/stream?url=http://192.168.31.135:8080/
 *   Dev-server
 *     ↓ http.request → ESP32/IP Webcam
 *     ↓ pipe: MJPEG данные + CORS заголовки
 *   Браузер ← непрерывный поток JPEG-фреймов
 *
 * ============================================================
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// ── Конфигурация ────────────────────────────────────────────

// Порт можно передать аргументом: node dev-server.js 3000
const PORT = parseInt(process.argv[2]) || 8080;

// Папка со статикой (фронтенд FoxOnline)
const DATA_DIR = path.join(__dirname, 'data');

// Маппинг расширений → Content-Type
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ── CORS ────────────────────────────────────────────────────

/**
 * Добавить заголовки CORS — разрешает любому origin
 * делать запросы к нашему серверу (для локальной отладки).
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Раздача статики ─────────────────────────────────────────

/**
 * Отдаёт файлы из DATA_DIR.
 * "/" → index.html, остальное — по пути.
 * Query string отсекается (?_t=123 не ломает путь).
 */
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;

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

// ── MJPEG Proxy ─────────────────────────────────────────────

/**
 * Проксирует MJPEG-стрим с внешнего источника к клиенту.
 *
 * Эндпоинт:
 *   GET /proxy/stream?url=http://192.168.31.135:8080/
 *
 * Участники:
 *   req      — входящий запрос от БРАУЗЕРА (клиент)
 *   res      — ответ БРАУЗЕРУ
 *   proxyReq — исходящий запрос К ИСТОЧНИКУ (ESP32 / IP Webcam)
 *   proxyRes — ответ ОТ ИСТОЧНИКА (MJPEG поток)
 *
 * Поток данных:
 *   proxyRes.pipe(res) — данные от ESP32 напрямую льются в браузер
 *
 * Обработка ошибок:
 *   - Источник недоступен      → 502 Bad Gateway
 *   - Источник молчит 10 сек   → 504 Gateway Timeout
 *   - Источник оборвал поток   → res.end() (браузер увидит обрыв)
 *   - Клиент закрыл вкладку    → proxyReq.destroy() (освобождаем соединение)
 *
 * @param {http.IncomingMessage} req       — запрос от браузера
 * @param {http.ServerResponse}  res       — ответ браузеру
 * @param {string}               targetUrl — URL источника MJPEG
 */
function proxyMjpeg(req, res, targetUrl) {
  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing url parameter. Usage: /proxy/stream?url=http://...');
    return;
  }

  console.log('Proxy: ' + targetUrl);

  // Разбираем целевой URL на составляющие
  const parsedUrl = new URL(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port:     parsedUrl.port || 80,
    path:     parsedUrl.pathname + parsedUrl.search,
    method:   'GET',
    headers:  {
      'User-Agent': 'Mozilla/5.0',  // Некоторые источники фильтруют по UA
    }
  };

  // ── Запрос к источнику (ESP32 / IP Webcam) ──

  const proxyReq = http.request(options, (proxyRes) => {
    // Источник ответил — пробрасываем заголовки клиенту
    const headers = {
      // Content-Type от источника (обычно multipart/x-mixed-replace)
      'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
      // Запрещаем кэширование — стрим всегда live
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      // CORS — разрешаем браузеру читать данные
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    res.writeHead(proxyRes.statusCode, headers);

    // pipe: данные от ESP32 → напрямую в браузер (без буферизации)
    proxyRes.pipe(res);

    // Ошибка чтения от источника (ESP32 перезагрузился и т.д.)
    proxyRes.on('error', (err) => {
      console.error('Proxy source error:', err.message);
      // writableEnded = true если res уже закрыт (клиент ушёл)
      if (!res.writableEnded) res.end();
    });
  });

  // ── Таймаут бездействия (idle timeout на сокете к ESP32) ──
  //
  // НЕ абсолютный таймер! Сбрасывается при каждом полученном чанке.
  // Срабатывает только если ESP32 молчит 10 секунд подряд:
  //   - Фаза подключения: ESP32 не отвечает → 504
  //   - Стрим идёт: таймер постоянно сбрасывается → не мешает
  //   - ESP32 завис: 10с тишины → destroy → клиент увидит обрыв
  proxyReq.setTimeout(10000, () => {
    console.error('Proxy timeout: ' + targetUrl);
    proxyReq.destroy();
    // headersSent = true если мы уже начали стримить (поздно слать 504)
    if (!res.headersSent) {
      res.writeHead(504);
      res.end('Proxy timeout');
    }
  });

  // ── Ошибка подключения к источнику ──
  // DNS не резолвится, порт закрыт, сеть недоступна и т.д.
  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Proxy error: ' + err.message);
    }
  });

  // ── Клиент закрыл вкладку / StreamService вызвал abort ──
  // Освобождаем соединение к ESP32 (иначе оно висит бесполезно)
  req.on('close', () => {
    proxyReq.destroy();
  });

  // Отправляем запрос к источнику
  proxyReq.end();
}

// ── HTTP-сервер ─────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS preflight: браузер шлёт OPTIONS перед кросс-доменным запросом
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);  // No Content — просто подтверждаем разрешение
    res.end();
    return;
  }

  // Проксирование MJPEG стрима
  if (pathname === '/proxy/stream') {
    proxyMjpeg(req, res, parsedUrl.query.url);
    return;
  }

  // Всё остальное — статика из /data
  serveStatic(req, res);
});

// ── Запуск ──────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('===========================================================');
  console.log('  FoxOnline Dev Server');
  console.log('===========================================================');
  console.log('  Static:  http://localhost:' + PORT + '/');
  console.log('  Proxy:   http://localhost:' + PORT + '/proxy/stream?url=...');
  console.log('-----------------------------------------------------------');
  console.log('  Example: /proxy/stream?url=http://192.168.1.50:8080/video');
  console.log('===========================================================');
  console.log('');
});

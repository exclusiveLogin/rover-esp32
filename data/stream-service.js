/**
 * ============================================================
 * StreamService — fetch-based MJPEG с retry и backoff
 * ============================================================
 *
 * Почему fetch, а не <img src="mjpeg">?
 * ──────────────────────────────────────
 * Браузер нативно парсит MJPEG через <img>, но:
 *   - img.onerror срабатывает ТОЛЬКО при ошибке начального подключения
 *   - Если стрим обрывается на лету (WiFi, перезагрузка ESP),
 *     браузер просто показывает последний кадр — без каких-либо событий
 *
 * Здесь мы используем fetch + ReadableStream:
 *   - reader.read() кидает исключение при ЛЮБОМ обрыве
 *   - Мы сами парсим JPEG-фреймы по маркерам SOI/EOI
 *   - Рендерим через Blob URL → img.src (быстро, без сети)
 *   - Полный контроль: retry, backoff, FPS throttle
 *
 * Публичный API:
 *   start()  — подключиться (или переподключиться)
 *   stop()   — отключиться, очистить ретраи
 *   active   — getter, идёт ли стрим
 *
 * Конфиг (из AppState / config.js):
 *   streamMaxRetries  — макс. попыток переподключения (def: 5)
 *   streamBaseDelay   — начальная задержка retry в мс (def: 2000)
 *
 * ============================================================
 */

/* global AppState */

class StreamService {

  /**
   * @param {Object} store - AppState (SSOT)
   * @param {HTMLImageElement} imgEl - <img> куда рендерим кадры
   */
  constructor(store, imgEl) {
    this.store = store;
    this.img   = imgEl;

    this._ctrl       = null;   // AbortController для fetch (отмена запроса)
    this._blobUrl    = null;   // Текущий Blob URL (один кадр в памяти)
    this._retries    = 0;      // Счётчик попыток переподключения
    this._retryTimer = null;   // setTimeout ID для retry
    this._running    = false;  // Флаг активности стрима
  }

  get active() { return this._running; }

  // ── Public ────────────────────────────────────────────────

  /**
   * Подключиться к MJPEG-потоку.
   * Если уже подключены — переподключение (stop + start).
   */
  async start() {
    this.stop();
    this._running = true;

    const url = this.store.getStreamUrl?.();
    if (!url) {
      window.uiLogger?.warn('Стрим: URL не задан');
      this._running = false;
      return;
    }

    // AbortController позволяет прервать fetch извне (при stop)
    this._ctrl = new AbortController();

    try {
      const res = await fetch(url, { signal: this._ctrl.signal });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!res.body) throw new Error('ReadableStream not supported');

      // Подключение успешно — сбрасываем счётчик ретраев
      this._retries = 0;
      window.uiLogger?.success('Стрим: подключено');

      // Бесконечный цикл чтения фреймов (выход — по ошибке или stop)
      await this._readFrames(res.body.getReader());

    } catch (e) {
      // AbortError = нормальный stop(), не ретраим
      if (e.name === 'AbortError') return;
      this._retry(e);
    }
  }

  /**
   * Остановить стрим, очистить все ресурсы.
   */
  stop() {
    this._running = false;
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._retries = 0;

    // Прерываем fetch (вызовет AbortError в start)
    if (this._ctrl) {
      this._ctrl.abort();
      this._ctrl = null;
    }

    // Освобождаем память от последнего кадра
    this._revokeBlob();
    this.img.removeAttribute('src');
  }

  // ── Frame reader ──────────────────────────────────────────

  /**
   * Основной цикл чтения потока.
   *
   * reader.read() возвращает чанки сырых байт (Uint8Array).
   * MJPEG — это последовательность JPEG-файлов, разделённых
   * HTTP multipart boundary. Но нам не нужно парсить boundary —
   * мы ищем JPEG-маркеры напрямую:
   *   SOI (Start Of Image): 0xFF 0xD8
   *   EOI (End Of Image):   0xFF 0xD9
   *
   * Когда нашли пару SOI..EOI — это один кадр.
   */
  async _readFrames(reader) {
    let buf = new Uint8Array(0);

    while (this._running) {
      // Ждём новый чанк данных из сокета.
      // Если соединение оборвётся — read() бросит исключение.
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream closed by server');

      // Дописываем чанк к буферу
      buf = this._append(buf, value);

      // Пытаемся извлечь JPEG-кадр из буфера
      buf = this._extractFrame(buf);

      // Защита от утечки памяти: если буфер вырос слишком большим
      // (например, битые данные без EOI), обрезаем начало
      if (buf.length > 512 * 1024) {
        buf = buf.slice(-256 * 1024);
      }
    }
  }

  /**
   * Ищет JPEG-кадр в буфере (SOI → EOI).
   *
   * Алгоритм:
   * 1. Сканируем байты попарно
   * 2. Запоминаем последний найденный SOI (0xFF 0xD8)
   * 3. Когда находим EOI (0xFF 0xD9) после SOI — вырезаем кадр
   * 4. Возвращаем остаток буфера (после EOI)
   *
   * Если кадр не найден — буфер возвращается как есть,
   * ждём следующий чанк для дополнения.
   *
   * @returns {Uint8Array} Остаток буфера после извлечения кадра
   */
  _extractFrame(buf) {
    let soi = -1; // позиция начала JPEG (Start Of Image)

    for (let i = 0; i < buf.length - 1; i++) {
      // SOI маркер: FF D8
      if (buf[i] === 0xFF && buf[i + 1] === 0xD8) {
        soi = i;
      }
      // EOI маркер: FF D9 (конец JPEG)
      if (soi >= 0 && buf[i] === 0xFF && buf[i + 1] === 0xD9) {
        // Нашли полный кадр: от soi до i+2 (включая EOI)
        this._renderFrame(buf.slice(soi, i + 2));
        // Возвращаем всё, что после этого кадра
        return buf.slice(i + 2);
      }
    }

    // Кадр не завершён — ждём ещё данных
    return buf;
  }

  /**
   * Рендер одного JPEG-кадра.
   *
   * Blob — это объект в RAM (не файл на диске).
   * createObjectURL даёт ему временный адрес "blob:http://...".
   * img.src = blobUrl — браузер рендерит из памяти, без сети.
   *
   * Перед созданием нового Blob обязательно revokeObjectURL
   * предыдущего — иначе утечка памяти (по 10-50 КБ на кадр).
   */
  _renderFrame(jpeg) {
    this._revokeBlob();
    this._blobUrl = URL.createObjectURL(
      new Blob([jpeg], { type: 'image/jpeg' })
    );
    this.img.src = this._blobUrl;
  }

  /**
   * Освободить память предыдущего кадра.
   */
  _revokeBlob() {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }

  // ── Retry с exponential backoff ───────────────────────────

  /**
   * Переподключение с нарастающей задержкой.
   *
   * Backoff: base * 2^(n-1), но не более 16 сек.
   * При base=2000: 2с → 4с → 8с → 16с → 16с
   *
   * Если исчерпаны все попытки — выключаем стрим через store
   * (UI-кнопка вернётся в состояние ▶).
   */
  _retry(err) {
    if (!this._running) return;

    this._retries++;
    const max   = this.store.streamMaxRetries  || 5;
    const base  = this.store.streamBaseDelay   || 2000;

    if (this._retries > max) {
      window.uiLogger?.error(
        'Стрим: ' + max + ' попыток исчерпано — ' + err.message
      );
      // Автоматически выключаем стрим (подписчик в script.js обновит UI)
      this.store.set('isStreaming', false);
      return;
    }

    const delay = Math.min(base * Math.pow(2, this._retries - 1), 16000);
    window.uiLogger?.warn(
      'Стрим: ' + err.message +
      ', повтор ' + this._retries + '/' + max +
      ' через ' + (delay / 1000 | 0) + 'с'
    );

    this._retryTimer = setTimeout(() => {
      if (this._running) this.start();
    }, delay);
  }

  // ── Utils ─────────────────────────────────────────────────

  /**
   * Конкатенация двух Uint8Array.
   * Нет встроенного метода — приходится через копирование.
   */
  _append(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }
}

window.StreamService = StreamService;

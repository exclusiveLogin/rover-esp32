/**
 * ============================================================
 * 🔴 Motion Detector — Детекция движения в браузере
 * ============================================================
 * 
 * Модуль обнаружения движения на видеопотоке с помощью OpenCV.js
 * 
 * Алгоритм:
 *   1. Захват кадра → grayscale
 *   2. absdiff с предыдущим кадром → diff
 *   3. GaussianBlur → убираем шум сенсора
 *   4. Threshold → бинарная маска
 *   5. Dilate + Erode → морфология (убираем мелкий шум)
 *   6. countNonZero → процент движения
 *   7. findContours → bounding boxes (опционально)
 * 
 * Визуализация (на отдельном canvas, независимо от CV overlay):
 *   - Красная маска изменённых пикселей (showPixels)
 *   - Зелёные bounding box-ы контуров (showBoxes)
 * 
 * Десатурация и OSD управляются снаружи (script.js)
 * 
 * @requires OpenCV.js (загружается асинхронно)
 * 
 * Использование:
 *   const detector = new MotionDetector(videoElement, options);
 *   await detector.start();       // включает обработку
 *   // Compositor вызывает detector.tick(now) + detector.getLayer(i)
 *   detector.stop();
 * 
 * ============================================================
 */

class MotionDetector {

  // ==========================================================
  // 📐 Константы
  // ==========================================================

  static DEFAULTS = {
    // Разрешение обработки (px)
    processWidth: 320,
    processHeight: 240,
    processInterval: 100,  // мс между кадрами (10 FPS)

    // Детекция
    threshold: 25,          // порог бинаризации (0-255)
    minContourArea: 500,    // мин. площадь контура для BB (px²)
    dilateIterations: 2,    // итераций dilate (расширение)
    blurSize: 5,            // размер GaussianBlur ядра

    // Цвета рендера слоёв
    colors: {
      boxes: '#00FF00',                    // зелёный — BB рамки
      boxText: '#00FF00',                  // текст BB
      contours: '#00FFFF',                 // cyan — контуры силуэтов
    }
  };

  // ==========================================================
  // 🏗️ Конструктор
  // ==========================================================

  /**
   * @param {HTMLVideoElement|HTMLImageElement} videoElement - источник видео
   * @param {Object} options - настройки (см. DEFAULTS)
   */
  constructor(videoElement, options = {}) {
    // Элементы DOM
    this.video = videoElement;

    // Скрытый canvas для захвата кадров (уменьшенное разрешение)
    this.captureCanvas = document.createElement('canvas');
    this.captureCtx = this.captureCanvas.getContext('2d');

    // Конфигурация: defaults + пользовательские опции
    this.config = {
      ...MotionDetector.DEFAULTS,
      colors: { ...MotionDetector.DEFAULTS.colors },
      ...options
    };

    // Состояние управления
    this._running = false;
    this._lastProcessTime = 0;
    this._cvReady = false;

    // Стейт пайплайна (приватный)
    this._prevGray = null;       // предыдущий кадр (grayscale, cv.Mat)
    this._currentGray = null;    // текущий кадр (grayscale, cv.Mat)
    this._mask = null;           // бинарная маска движения (CV_8UC1)
    this._regions = [];          // текущие BB регионы
    this._contourPoints = [];    // точки контуров (JS-массивы, для Canvas2D рендера)
    this._motionPercent = 0;     // процент пикселей с движением
    this._centerOfMass = null;   // центр масс движения

    // Callbacks
    this.onMotion = options.onMotion || null;
    this.onError = options.onError || null;

    // ── Offscreen canvases для getLayer() (композитор) ──────
    // 3 слоя: 0=Mask(Pixels), 1=Contours, 2=BB(BoundingBoxes)
    this._layerCanvases = [];
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('canvas');
      c.width = this.config.processWidth;
      c.height = this.config.processHeight;
      this._layerCanvases.push(c);
    }

    this._checkOpenCV();
  }

  // ==========================================================
  // 🔧 Инициализация OpenCV
  // ==========================================================

  /** Проверка готовности OpenCV.js */
  async _checkOpenCV() {
    try {
      if (typeof cv !== 'undefined') {
        if (cv instanceof Promise || typeof cv === 'function') {
          cv = await cv;
        }
        if (cv.Mat) {
          this._cvReady = true;
          console.log('✅ MotionDetector: OpenCV.js ready');
          return;
        }
      }
      console.warn('⏳ MotionDetector: waiting for OpenCV.js...');
    } catch (e) {
      console.warn('⏳ MotionDetector: OpenCV.js not ready yet:', e.message);
    }
  }

  /**
   * Ожидание загрузки OpenCV.js
   * @param {number} timeout - таймаут в мс (по умолчанию 30 сек)
   * @returns {Promise<boolean>}
   */
  async waitForOpenCV(timeout = 30000) {
    if (this._cvReady) return true;

    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (typeof cv !== 'undefined') {
          if (cv instanceof Promise || typeof cv === 'function') {
            cv = await cv;
          }
          if (cv.Mat) {
            this._cvReady = true;
            console.log('✅ MotionDetector: OpenCV.js loaded');
            return true;
          }
        }
      } catch (e) { /* WASM ещё инициализируется */ }
      await new Promise(r => setTimeout(r, 100));
    }

    console.error('❌ MotionDetector: OpenCV.js timeout');
    return false;
  }

  // ==========================================================
  // 🎬 Публичный API — Управление
  // ==========================================================

  /** Запуск обработки (tick вызывается Compositor'ом) */
  async start() {
    if (!this._cvReady && !(await this.waitForOpenCV())) {
      this.onError?.('OpenCV.js не загружен');
      return false;
    }

    this._running = true;
    console.log('▶️ MotionDetector: Started');
    return true;
  }

  /** Остановка обработки */
  stop() {
    this._running = false;

    // Очистка OpenCV матриц
    this._cleanup();

    // Очистка offscreen layer canvases
    for (const c of this._layerCanvases) {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
    }
    console.log('⏹️ MotionDetector: Stopped');
  }

  // ==========================================================
  // 🎬 Публичный API — Настройка параметров
  // ==========================================================

  /**
   * Установить порог детекции
   * @param {number} value - 0-255
   */
  setThreshold(value) {
    this.config.threshold = Math.max(0, Math.min(255, value));
  }

  /**
   * Установить минимальную площадь контура
   * @param {number} value - площадь в px²
   */
  setMinArea(value) {
    this.config.minContourArea = Math.max(0, value);
  }

  /**
   * Установить размер GaussianBlur ядра
   * @param {number} value - нечётное число 3-15
   */
  setBlurSize(value) {
    // GaussianBlur требует нечётный размер ядра
    const v = Math.max(3, Math.min(15, value));
    this.config.blurSize = v % 2 === 0 ? v + 1 : v;
  }

  /**
   * Установить количество итераций dilate
   * @param {number} value - 0-5
   */
  setDilateIterations(value) {
    this.config.dilateIterations = Math.max(0, Math.min(5, value));
  }

  // ==========================================================
  // 🎬 Compositor API — tick() + getLayer()
  // ==========================================================

  /**
   * Вызывается композитором каждый кадр.
   * Внутри — throttle по processInterval.
   * @param {number} now - performance.now() timestamp
   */
  tick(now) {
    if (!this._running || !this._cvReady) return;

    if (now - this._lastProcessTime >= this.config.processInterval) {
      this._lastProcessTime = now;
      this._processFrame();
    }
  }

  /**
   * Возвращает offscreen canvas для слоя.
   * @param {number} localIndex - 0..2
   *   0=Mask(Pixels), 1=Contours, 2=BB(BoundingBoxes)
   * @returns {HTMLCanvasElement|null}
   */
  getLayer(localIndex) {
    if (localIndex < 0 || localIndex >= this._layerCanvases.length) return null;
    return this._layerCanvases[localIndex];
  }

  /** Число слоёв этого процессора */
  static get LAYER_COUNT() { return 3; }

  // ==========================================================
  // 🔄 Приватный пайплайн — Обработка кадра
  // ==========================================================

  /** Обработка одного кадра */
  _processFrame() {
    try {
      this._syncCanvasSize();

      // 1. Захват текущего кадра
      if (!this._captureFrame()) return;

      // 2. Если нет предыдущего кадра — сохраняем и ждём следующий
      if (!this._prevGray) {
        this._prevGray = this._currentGray.clone();
        this._currentGray.delete();
        this._currentGray = null;
        return;
      }

      // 3. Вычисление маски движения
      this._computeDiffMask();

      // 4. Поиск регионов (всегда — нужны для getLayer и превью)
      this._findRegions();

      // 5. Рендер в offscreen layer canvases
      this._renderLayerCanvases();

      // 6. Callback с метаданными
      if (this.onMotion) {
        this.onMotion({
          motionPercent: this._motionPercent,
          regionCount: this._regions.length,
          regions: this._regions,
          centerOfMass: this._centerOfMass,
          timestamp: Date.now()
        });
      }

      // 7. Обновление стейта: текущий → предыдущий
      if (this._prevGray) this._prevGray.delete();
      this._prevGray = this._currentGray.clone();

      // 8. Очистка текущего кадра и маски
      if (this._currentGray) {
        this._currentGray.delete();
        this._currentGray = null;
      }
      if (this._mask) {
        this._mask.delete();
        this._mask = null;
      }

    } catch (error) {
      console.error('MotionDetector error:', error);
      this.onError?.(error.message);
    }
  }

  // ==========================================================
  // 📷 Приватный пайплайн — Захват кадра
  // ==========================================================

  /** Синхронизация размеров capture canvas */
  _syncCanvasSize() {
    const { captureCanvas, config } = this;

    if (captureCanvas.width !== config.processWidth) {
      captureCanvas.width = config.processWidth;
      captureCanvas.height = config.processHeight;
    }
  }

  /**
   * Захват кадра и конвертация в grayscale
   * Результат: this._currentGray (cv.Mat, CV_8UC1)
   * @returns {boolean} успех
   */
  _captureFrame() {
    const { video, captureCanvas, captureCtx, config } = this;
    const isVideo = video.tagName === 'VIDEO';

    // Проверка готовности источника
    if (isVideo) {
      if (video.readyState < 2 || video.videoWidth === 0) return false;
    } else {
      if (!video.complete || video.naturalWidth === 0) return false;
    }

    // Масштабируем в уменьшенный canvas
    captureCtx.drawImage(video, 0, 0, config.processWidth, config.processHeight);

    // Читаем в OpenCV Mat и конвертируем в grayscale
    const src = cv.imread(captureCanvas);
    this._currentGray = new cv.Mat();
    cv.cvtColor(src, this._currentGray, cv.COLOR_RGBA2GRAY);
    src.delete();

    return true;
  }

  // ==========================================================
  // 🔍 Приватный пайплайн — Детекция движения
  // ==========================================================

  /**
   * Вычисление маски движения
   * Читает: this._prevGray, this._currentGray
   * Пишет: this._mask (CV_8UC1), this._motionPercent
   */
  _computeDiffMask() {
    const { config } = this;
    
    // Временные матрицы (ВАЖНО: удаляются в finally)
    const diff = new cv.Mat();     // разница между кадрами (CV_8UC1)
    const blurred = new cv.Mat();  // размытая разница (CV_8UC1)

    try {
      // ── Шаг 1: Абсолютная разница между кадрами ──────────────
      //
      //  absdiff(prev, curr, dst):
      //    dst[x,y] = |prev[x,y] - curr[x,y]|
      //
      //  На выходе: grayscale изображение где яркие пиксели =
      //  места, где произошло изменение между кадрами.
      //  Неподвижные области → чёрные (0), движение → светлые.
      //
      cv.absdiff(this._prevGray, this._currentGray, diff);

      // ── Шаг 2: GaussianBlur — подавление шума сенсора ────────
      //
      //  Камера (особенно OV2640 на ESP32) генерирует тепловой
      //  шум — случайные колебания яркости ±5-15 единиц даже
      //  на неподвижной сцене. Без blur эти пиксели пройдут
      //  через threshold и создадут ложные срабатывания.
      //
      //  blurSize=5 → ядро 5×5, сглаживает шум сенсора,
      //  но сохраняет контуры реального движения.
      //  Увеличить до 7-9 для шумных камер.
      //
      const ksize = new cv.Size(config.blurSize, config.blurSize);
      cv.GaussianBlur(diff, blurred, ksize, 0);

      // ── Шаг 3: Threshold — бинаризация ───────────────────────
      //
      //  threshold(src, dst, thresh, maxVal, type):
      //    dst[x,y] = (src[x,y] > thresh) ? 255 : 0
      //
      //  Превращает градиентную карту разницы в чёткую маску:
      //    • Пиксели с разницей > threshold → белые (255) = движение
      //    • Пиксели с разницей ≤ threshold → чёрные (0) = фон
      //
      //  threshold=25 — баланс: отсекает шум камеры (~5-15),
      //  но ловит реальное движение (обычно разница >30).
      //  Настраивается слайдером в панели (5-100).
      //
      this._mask = new cv.Mat();
      cv.threshold(blurred, this._mask, config.threshold, 255, cv.THRESH_BINARY);

      // ── Шаг 4: Морфология — очистка маски ────────────────────
      //
      //  Проблема: после threshold маска содержит:
      //    • «дыры» внутри областей движения
      //    • мелкие одиночные пиксели (остатки шума)
      //
      //  dilate (расширение):
      //    Каждый белый пиксель «растёт» на 1px во все стороны.
      //    → Заполняет дыры, соединяет близкие области.
      //    dilateIterations=2 → расширение на 2px.
      //
      //  erode (сужение):
      //    Каждый белый пиксель «сжимается» на 1px.
      //    → Убирает мелкие шумовые пиксели, которые dilate
      //      мог усилить. 1 итерация — мягкая очистка.
      //
      //  Порядок dilate→erode (а не erode→dilate) важен:
      //  сначала соединяем, потом чистим. Обратный порядок
      //  (opening) удалил бы мелкие области до соединения.
      //
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(this._mask, this._mask, kernel, new cv.Point(-1, -1), config.dilateIterations);
      cv.erode(this._mask, this._mask, kernel, new cv.Point(-1, -1), 1);
      kernel.delete();  // ВАЖНО: освобождаем StructuringElement

      // ── Шаг 5: Процент движения ─────────────────────────────
      //
      //  countNonZero(mask) / totalPixels × 100%
      //
      //  Быстрая метрика «сколько кадра занято движением».
      //  Типичные значения:
      //    0-1%   — покой (шум)
      //    1-10%  — локальное движение (рука, кошка)
      //    10-50% — крупное движение (человек идёт)
      //    >50%   — смена сцены / тряска камеры
      //
      const totalPixels = this._mask.rows * this._mask.cols;
      const nonZero = cv.countNonZero(this._mask);
      this._motionPercent = (nonZero / totalPixels) * 100;

    } finally {
      // ВАЖНО: всегда освобождаем временные матрицы OpenCV
      // (нет garbage collection для cv.Mat в WASM)
      diff.delete();
      blurred.delete();
    }
  }

  /**
   * Поиск регионов движения (bounding boxes)
   * Читает: this._mask
   * Пишет: this._regions, this._centerOfMass
   */
  _findRegions() {
    const { config } = this;
    this._regions = [];
    this._contourPoints = [];
    this._centerOfMass = null;

    if (!this._mask) return;

    // Временные структуры OpenCV (удаляются в finally)
    const contours = new cv.MatVector();  // массив контуров (каждый — массив точек)
    const hierarchy = new cv.Mat();        // иерархия вложенности (не используем)

    try {
      // ── Шаг 1: Поиск контуров ───────────────────────────────
      //
      //  findContours(image, contours, hierarchy, mode, method):
      //
      //  Находит границы белых областей на бинарной маске.
      //  Каждый контур — замкнутая кривая вокруг связной области.
      //
      //  RETR_EXTERNAL — только внешние контуры (без вложенных).
      //    Если внутри большой области есть «дыра» → игнорируем.
      //
      //  CHAIN_APPROX_SIMPLE — сжатие контура: хранит только
      //    вершины (углы), а не каждый пиксель границы.
      //    Экономит память, не влияет на boundingRect.
      //
      //  ⚠️ findContours МОДИФИЦИРУЕТ входное изображение!
      //  Поэтому клонируем маску перед вызовом.
      //
      const maskClone = this._mask.clone();
      cv.findContours(maskClone, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      maskClone.delete();

      // ── Шаг 2: Фильтрация + BoundingRect ────────────────────
      //
      //  Для каждого контура:
      //    1. contourArea() — площадь (в px²)
      //    2. Если площадь ≥ minContourArea → boundingRect()
      //    3. Если площадь < minContourArea → пропускаем (шум)
      //
      //  minContourArea=500 отсекает мелкие случайные области,
      //  оставляя только значимое движение.
      //
      //  boundingRect() — минимальный прямоугольник, содержащий
      //  весь контур. Координаты в пространстве обработки
      //  (processWidth × processHeight).
      //
      let totalX = 0, totalY = 0, totalArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        if (area >= config.minContourArea) {
          const rect = cv.boundingRect(contour);
          this._regions.push({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          });

          // ── Извлечение точек контура для Canvas2D рендера ────
          //
          //  contour.data32S — Int32Array с координатами точек:
          //    [x0, y0, x1, y1, x2, y2, ...]
          //
          //  Копируем в обычный JS-массив [{x, y}, ...],
          //  чтобы можно было рисовать через ctx.lineTo()
          //  после того как cv.MatVector будет удалён.
          //
          // Всегда извлекаем точки контуров (для getLayer и превью)
          const points = [];
          for (let j = 0; j < contour.data32S.length; j += 2) {
            points.push({
              x: contour.data32S[j],
              y: contour.data32S[j + 1]
            });
          }
          this._contourPoints.push(points);

          // ── Накапливаем данные для центра масс ───────────────
          //
          //  Центр масс = взвешенное среднее центров BB,
          //  где вес = площадь контура.
          //  Большие области влияют сильнее мелких.
          //
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          totalX += cx * area;
          totalY += cy * area;
          totalArea += area;
        }
      }

      // ── Шаг 3: Центр масс всего движения ────────────────────
      //
      //  centerOfMass = Σ(center_i × area_i) / Σ(area_i)
      //
      //  Координаты в пространстве обработки.
      //  Полезно для трекинга: «куда смотреть».
      //  null если движения нет.
      //
      if (totalArea > 0) {
        this._centerOfMass = {
          x: totalX / totalArea,
          y: totalY / totalArea
        };
      }

    } finally {
      // ВАЖНО: освобождаем MatVector и Mat
      contours.delete();
      hierarchy.delete();
    }
  }

  // ==========================================================
  // 🎨 Приватный пайплайн — Визуализация
  // ==========================================================

  /** Рендер каждого слоя в offscreen canvas (для композитора) */
  _renderLayerCanvases() {
    const { config } = this;

    const video = this.video;
    const isVideo = video.tagName === 'VIDEO';
    const displayW = video.clientWidth || (isVideo ? video.videoWidth : video.naturalWidth);
    const displayH = video.clientHeight || (isVideo ? video.videoHeight : video.naturalHeight);

    // Синхронизация размеров offscreen canvases
    for (let i = 0; i < this._layerCanvases.length; i++) {
      const c = this._layerCanvases[i];
      if (c.width !== displayW || c.height !== displayH) {
        c.width = displayW;
        c.height = displayH;
      }
      c.getContext('2d').clearRect(0, 0, displayW, displayH);
    }

    // Layer 0: Mask (Pixels)
    if (this._mask) {
      this._renderPixelMaskTo(this._layerCanvases[0].getContext('2d'), displayW, displayH);
    }

    // Layer 1: Contours
    if (this._contourPoints.length > 0) {
      this._renderContoursTo(this._layerCanvases[1].getContext('2d'), displayW, displayH);
    }

    // Layer 2: BB (Bounding Boxes)
    if (this._regions.length > 0) {
      this._renderBBTo(this._layerCanvases[2].getContext('2d'), displayW, displayH);
    }
  }

  /** Рендер маски пикселей на произвольный ctx */
  _renderPixelMaskTo(ctx, w, h) {
    const mask = this._mask;
    if (!mask) return;

    const width = mask.cols;
    const height = mask.rows;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < width * height; i++) {
      if (mask.data[i] > 0) {
        data[i * 4]     = 255;
        data[i * 4 + 1] = 0;
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 115;
      }
    }
    tempCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, w, h);
  }

  /** Рендер контуров на произвольный ctx */
  _renderContoursTo(ctx, w, h) {
    const { config } = this;
    const scaleX = w / config.processWidth;
    const scaleY = h / config.processHeight;

    ctx.strokeStyle = config.colors.contours;
    ctx.lineWidth = 2;

    for (const points of this._contourPoints) {
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  /** Рендер bounding boxes на произвольный ctx */
  _renderBBTo(ctx, w, h) {
    const { config } = this;
    const scaleX = w / config.processWidth;
    const scaleY = h / config.processHeight;

    ctx.strokeStyle = config.colors.boxes;
    ctx.lineWidth = 2;
    ctx.font = '11px monospace';
    ctx.fillStyle = config.colors.boxText;

    for (const region of this._regions) {
      const x = region.x * scaleX;
      const y = region.y * scaleY;
      const rw = region.width * scaleX;
      const rh = region.height * scaleY;
      ctx.strokeRect(x, y, rw, rh);
      const area = region.width * region.height;
      ctx.fillText(`${area}px²`, x + 2, y - 4);
    }
  }

  // ==========================================================
  // 🧹 Приватные утилиты
  // ==========================================================

  /** Очистка OpenCV матриц */
  _cleanup() {
    if (this._prevGray) {
      this._prevGray.delete();
      this._prevGray = null;
    }
    if (this._currentGray) {
      this._currentGray.delete();
      this._currentGray = null;
    }
    if (this._mask) {
      this._mask.delete();
      this._mask = null;
    }
    this._regions = [];
    this._contourPoints = [];
    this._motionPercent = 0;
    this._centerOfMass = null;
  }
}

// ==========================================================
// 🌐 Экспорт
// ==========================================================

window.MotionDetector = MotionDetector;

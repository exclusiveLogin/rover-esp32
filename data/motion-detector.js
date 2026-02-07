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
 *   const detector = new MotionDetector(videoElement, overlayCanvas);
 *   await detector.start();
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

    // Слои визуализации (управляемые этим классом)
    showPixels: true,       // красная маска пикселей
    showBoxes: true,        // зелёные BB рамки
    showContours: false,    // контуры (силуэты) движущихся объектов

    // Цвета
    colors: {
      pixels: 'rgba(255, 0, 0, 0.45)',   // красный полупрозрачный
      boxes: '#00FF00',                    // зелёный
      boxText: '#00FF00',                  // текст BB
      contours: '#00FFFF',                 // cyan — контуры силуэтов
    }
  };

  // ==========================================================
  // 🏗️ Конструктор
  // ==========================================================

  /**
   * @param {HTMLVideoElement|HTMLImageElement} videoElement - источник видео
   * @param {HTMLCanvasElement} overlayCanvas - canvas для отрисовки (#motion-overlay)
   * @param {Object} options - настройки (см. DEFAULTS)
   */
  constructor(videoElement, overlayCanvas, options = {}) {
    // Элементы DOM
    this.video = videoElement;
    this.overlay = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');

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
    this._animationId = null;
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

  /** Запуск обработки */
  async start() {
    if (!this._cvReady && !(await this.waitForOpenCV())) {
      this.onError?.('OpenCV.js не загружен');
      return false;
    }

    this._running = true;
    this._processLoop();
    console.log('▶️ MotionDetector: Started');
    return true;
  }

  /** Остановка обработки */
  stop() {
    this._running = false;

    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }

    // Очистка OpenCV матриц
    this._cleanup();
    this._clearOverlay();
    console.log('⏹️ MotionDetector: Stopped');
  }

  /** Переключение вкл/выкл */
  toggle() {
    this._running ? this.stop() : this.start();
    return this._running;
  }

  /** Проверка состояния */
  isRunning() {
    return this._running;
  }

  // ==========================================================
  // 🎬 Публичный API — Настройка слоёв
  // ==========================================================

  /**
   * Установить видимость слоя
   * @param {string} name - 'pixels' или 'boxes'
   * @param {boolean} enabled
   */
  setLayer(name, enabled) {
    const key = `show${name.charAt(0).toUpperCase() + name.slice(1)}`;
    if (key in this.config) {
      this.config[key] = enabled;
      console.log(`🔴 MotionDetector: layer '${name}' = ${enabled}`);
    }
  }

  /**
   * Переключить видимость слоя
   * @param {string} name - 'pixels' или 'boxes'
   * @returns {boolean} новое состояние
   */
  toggleLayer(name) {
    const key = `show${name.charAt(0).toUpperCase() + name.slice(1)}`;
    if (key in this.config) {
      this.config[key] = !this.config[key];
      console.log(`🔴 MotionDetector: layer '${name}' = ${this.config[key]}`);
      return this.config[key];
    }
    return false;
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
   * Обновление конфигурации
   * @param {Object} options
   */
  updateConfig(options) {
    Object.assign(this.config, options);
  }

  // ==========================================================
  // 🔄 Приватный пайплайн — Главный цикл
  // ==========================================================

  /** Цикл обработки кадров (requestAnimationFrame) */
  _processLoop() {
    if (!this._running) return;

    const now = Date.now();
    if (now - this._lastProcessTime >= this.config.processInterval) {
      this._lastProcessTime = now;
      this._processFrame();
    }

    this._animationId = requestAnimationFrame(() => this._processLoop());
  }

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

      // 4. Поиск регионов (если нужны BB, контуры или callback с регионами)
      if (this.config.showBoxes || this.config.showContours || this.onMotion) {
        this._findRegions();
      } else {
        this._regions = [];
        this._contourPoints = [];
        this._centerOfMass = null;
      }

      // 5. Рендер
      this._render();

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

  /** Синхронизация размеров canvas */
  _syncCanvasSize() {
    const { video, overlay, captureCanvas, config } = this;

    const isVideo = video.tagName === 'VIDEO';
    const srcWidth = isVideo ? video.videoWidth : video.naturalWidth;
    const srcHeight = isVideo ? video.videoHeight : video.naturalHeight;

    // Overlay = размер на экране
    const displayW = video.clientWidth || srcWidth;
    const displayH = video.clientHeight || srcHeight;

    if (overlay.width !== displayW || overlay.height !== displayH) {
      overlay.width = displayW;
      overlay.height = displayH;
    }

    // Capture = уменьшенное разрешение для обработки
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
          if (config.showContours) {
            const points = [];
            for (let j = 0; j < contour.data32S.length; j += 2) {
              points.push({
                x: contour.data32S[j],
                y: contour.data32S[j + 1]
              });
            }
            this._contourPoints.push(points);
          }

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

  /** Рендер включённых слоёв на canvas */
  _render() {
    const { config } = this;

    this._clearOverlay();

    if (config.showPixels && this._mask) {
      this._renderPixelMask();
    }

    if (config.showContours && this._contourPoints.length > 0) {
      this._renderContours();
    }

    if (config.showBoxes && this._regions.length > 0) {
      this._renderBoundingBoxes();
    }
  }

  /**
   * Рендер красной маски изменённых пикселей
   * Читает: this._mask (CV_8UC1, processWidth × processHeight)
   * Рисует: полупрозрачные красные пиксели на overlay canvas
   */
  _renderPixelMask() {
    const { overlay, ctx, config } = this;
    const mask = this._mask;

    if (!mask) return;

    const width = mask.cols;    // = processWidth (напр. 320)
    const height = mask.rows;   // = processHeight (напр. 240)

    // ── Стратегия рендера ──────────────────────────────────────
    //
    //  Маска живёт в координатах обработки (320×240),
    //  а overlay canvas — в координатах дисплея (напр. 640×480).
    //
    //  Подход: создаём временный canvas размером маски,
    //  попиксельно заполняем красным где mask > 0,
    //  затем масштабируем drawImage на overlay canvas.
    //
    //  imageSmoothingEnabled = false → чёткие «пиксельные» края,
    //  без антиалиасинга. Выглядит как тепловая карта.
    //

    // Временный canvas для попиксельного заполнения
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    const imageData = tempCtx.createImageData(width, height);
    const data = imageData.data;  // Uint8ClampedArray [R,G,B,A, R,G,B,A, ...]

    // RGBA для пикселей движения (красный, ~45% прозрачности)
    const r = 255, g = 0, b = 0;
    const alpha = 115;  // 115/255 ≈ 0.45

    // ── Попиксельное заполнение ────────────────────────────────
    //
    //  mask.data — Uint8Array, один байт на пиксель:
    //    0   = фон (нет движения)
    //    255 = движение
    //
    //  imageData.data — RGBA, 4 байта на пиксель:
    //    [R, G, B, A] для каждого пикселя
    //
    //  Пиксели с mask=0 остаются (0,0,0,0) → полностью прозрачные.
    //  Пиксели с mask>0 → (255,0,0,115) → полупрозрачный красный.
    //
    for (let i = 0; i < width * height; i++) {
      if (mask.data[i] > 0) {
        data[i * 4]     = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = alpha;
      }
    }

    tempCtx.putImageData(imageData, 0, 0);

    // ── Масштабирование на overlay canvas ──────────────────────
    //
    //  drawImage(src, dx, dy, dw, dh) — растягивает tempCanvas
    //  (320×240) на размер overlay (640×480 и т.д.).
    //
    //  imageSmoothingEnabled = false отключает билинейную
    //  интерполяцию → пиксели масштабируются как «блоки»,
    //  создавая характерный вид тепловой карты движения.
    //
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, overlay.width, overlay.height);
  }

  /**
   * Рендер контуров (силуэтов) движущихся объектов
   * Читает: this._contourPoints (массив массивов { x, y })
   * Рисует: замкнутые линии контуров cyan-цветом на overlay canvas
   */
  _renderContours() {
    const { overlay, ctx, config } = this;

    // ── Масштабирование координат ──────────────────────────────
    //
    //  Точки контуров хранятся в координатах обработки
    //  (processWidth × processHeight). Масштабируем при рисовании.
    //
    const scaleX = overlay.width / config.processWidth;
    const scaleY = overlay.height / config.processHeight;

    ctx.strokeStyle = config.colors.contours;
    ctx.lineWidth = 2;

    // ── Рисуем каждый контур как замкнутый путь ────────────────
    //
    //  Контур — массив точек [{x, y}, ...], описывающих границу
    //  связной области движения. CHAIN_APPROX_SIMPLE сжимает
    //  прямолинейные участки до вершин (углов), поэтому точек
    //  немного — рисовать через lineTo() дёшево.
    //
    //  closePath() замыкает контур — соединяет последнюю точку
    //  с первой, образуя силуэт объекта.
    //
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

  /**
   * Рендер зелёных bounding box-ов вокруг областей движения
   * Читает: this._regions (массив { x, y, width, height })
   * Рисует: зелёные рамки + подписи площади на overlay canvas
   */
  _renderBoundingBoxes() {
    const { overlay, ctx, config } = this;

    // ── Масштабирование координат ──────────────────────────────
    //
    //  this._regions содержит координаты в пространстве
    //  обработки (processWidth × processHeight, напр. 320×240).
    //
    //  Overlay canvas имеет размер дисплея (напр. 640×480).
    //  Умножаем координаты на scale для корректного отображения.
    //
    const scaleX = overlay.width / config.processWidth;
    const scaleY = overlay.height / config.processHeight;

    ctx.strokeStyle = config.colors.boxes;
    ctx.lineWidth = 2;
    ctx.font = '11px monospace';
    ctx.fillStyle = config.colors.boxText;

    for (const region of this._regions) {
      // Перевод из координат обработки → координаты дисплея
      const x = region.x * scaleX;
      const y = region.y * scaleY;
      const w = region.width * scaleX;
      const h = region.height * scaleY;

      // Рамка (strokeRect — только обводка, без заливки)
      ctx.strokeRect(x, y, w, h);

      // Подпись: площадь BB в пикселях обработки
      // Помогает оценить размер области движения
      const area = region.width * region.height;
      ctx.fillText(`${area}px²`, x + 2, y - 4);
    }
  }

  // ==========================================================
  // 🧹 Приватные утилиты
  // ==========================================================

  /** Очистка overlay */
  _clearOverlay() {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

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

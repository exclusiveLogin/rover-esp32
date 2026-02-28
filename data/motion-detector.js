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

    // POI Tracking
    poiMinFrames: 5,        // мин. кадров устойчивости
    poiMatchRadius: 30,     // радиус сопоставления центров (px)
    poiPersistence: 5,      // кадров удержания после пропадания
    poiMinSize: 500,        // мин. площадь BB (px²)
    poiMaxSize: 50000,      // макс. площадь BB (px²)
    poiMaxZones: 3,         // макс. зон POI
    poiNoiseThreshold: 30,  // порог motionPercent для режима "шум" (%)
    poiEmaPosition: 70,     // EMA коэфф. позиции (% старого, 50..90)
    poiEmaSize: 80,         // EMA коэфф. размера (% старого, 50..95)

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

    // Стейт POI tracking
    this._poiTrackers = [];      // массив трекеров { cx, cy, width, height, frameCount, age, id }
    this._poiResults = [];       // отфильтрованные POI для рендера
    this._poiNoiseMode = false;  // режим "слишком много шума"
    this._nextPoiId = 1;         // счётчик ID для новых трекеров

    // Callbacks
    this.onMotion = options.onMotion || null;
    this.onError = options.onError || null;

    // ── Offscreen canvases для getLayer() (композитор) ──────
    // 4 слоя: 0=Mask(Pixels), 1=Contours, 2=BB(BoundingBoxes), 3=POI
    this._layerCanvases = [];
    for (let i = 0; i < 4; i++) {
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
  static get LAYER_COUNT() { return 4; }

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

      // 5. POI Tracking — корреляция и накопление
      this._updatePoiTrackers();

      // 6. Рендер в offscreen layer canvases
      this._renderLayerCanvases();

      // 7. Callback с метаданными
      if (this.onMotion) {
        this.onMotion({
          motionPercent: this._motionPercent,
          regionCount: this._regions.length,
          regions: this._regions,
          centerOfMass: this._centerOfMass,
          poiCount: this._poiResults.length,
          pois: this._poiResults,
          poiNoiseMode: this._poiNoiseMode,
          timestamp: Date.now()
        });
      }

      // 8. Обновление стейта: текущий → предыдущий
      if (this._prevGray) this._prevGray.delete();
      this._prevGray = this._currentGray.clone();

      // 9. Очистка текущего кадра и маски
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

  /**
   * POI Tracking — корреляция регионов с трекерами, накопление достоверности
   * 
   * Алгоритм SORT-подобного трекинга:
   *   1. Проверка шумового режима (motionPercent > порог)
   *   2. Nearest-center matching между _regions и существующими трекерами
   *   3. EMA-сглаживание для matched (коэффициенты настраиваются: poiEmaPosition, poiEmaSize)
   *   4. Aging неиспользованных трекеров
   *   5. Удаление по persistence (age > poiPersistence)
   *   6. Фильтрация: frameCount >= poiMinFrames, area в [poiMinSize, poiMaxSize]
   *   7. Ранжирование по frameCount (устойчивости), топ-N (poiMaxZones)
   * 
   * @private
   * @reads {Array} this._regions - текущие BB регионы из _findRegions()
   * @reads {number} this._motionPercent - процент движущихся пикселей
   * @writes {Array} this._poiTrackers - массив трекеров { cx, cy, width, height, frameCount, age, id }
   * @writes {Array} this._poiResults - отфильтрованные топ-N POI для рендера
   * @writes {boolean} this._poiNoiseMode - флаг режима "шум"
   */
  _updatePoiTrackers() {
    const { config } = this;

    // ── Шаг 1: Проверка шумового режима ────────────────────────
    //
    // Если motionPercent слишком велик → вся сцена движется
    // (тряска камеры, смена сцены, много объектов).
    // В этом режиме отключаем рендер POI зон.
    //
    this._poiNoiseMode = this._motionPercent > config.poiNoiseThreshold;

    // ── Шаг 2: Матчинг текущих регионов с существующими трекерами ──
    //
    // Для каждого region из _regions[] ищем ближайший tracker,
    // где расстояние между центрами < poiMatchRadius.
    //
    const usedTrackers = new Set();

    for (const region of this._regions) {
      const regionCx = region.x + region.width / 2;
      const regionCy = region.y + region.height / 2;

      // Поиск ближайшего трекера
      let nearestTracker = null;
      let minDist = config.poiMatchRadius;

      for (const tracker of this._poiTrackers) {
        const dx = tracker.cx - regionCx;
        const dy = tracker.cy - regionCy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDist) {
          minDist = dist;
          nearestTracker = tracker;
        }
      }

      if (nearestTracker) {
        // ── MATCH — обновляем трекер с EMA-сглаживанием ──────────
        //
        // EMA (Exponential Moving Average) подавляет джиттер детекции:
        //   новое_значение = α * старое + (1-α) * измерение
        //
        // α из config (в %, конвертируем в 0..1)
        // По умолчанию: 70% для позиции, 80% для размера
        //
        const alphaPos = config.poiEmaPosition / 100;
        const alphaSize = config.poiEmaSize / 100;
        
        // Сглаженные координаты (для матчинга/стабильности)
        nearestTracker.cx = alphaPos * nearestTracker.cx + (1 - alphaPos) * regionCx;
        nearestTracker.cy = alphaPos * nearestTracker.cy + (1 - alphaPos) * regionCy;
        nearestTracker.width = alphaSize * nearestTracker.width + (1 - alphaSize) * region.width;
        nearestTracker.height = alphaSize * nearestTracker.height + (1 - alphaSize) * region.height;
        
        // Актуальные координаты текущего кадра (для отрисовки прицела без лага)
        nearestTracker.rawCx = regionCx;
        nearestTracker.rawCy = regionCy;
        nearestTracker.rawWidth = region.width;
        nearestTracker.rawHeight = region.height;
        
        nearestTracker.frameCount++;
        nearestTracker.age = 0;  // сброс aging — объект активен
        usedTrackers.add(nearestTracker);
      } else {
        // ── NO MATCH — создаём новый трекер ─────────────────────
        this._poiTrackers.push({
          cx: regionCx,
          cy: regionCy,
          width: region.width,
          height: region.height,
          rawCx: regionCx,    // изначально совпадают
          rawCy: regionCy,
          rawWidth: region.width,
          rawHeight: region.height,
          frameCount: 1,
          age: 0,
          id: this._nextPoiId++
        });
      }
    }

    // ── Шаг 3: Aging неиспользованных трекеров ──────────────────
    //
    // Трекеры, которые не совпали ни с одним region → стареют.
    // После poiPersistence кадров удаляем (fade-out).
    //
    for (const tracker of this._poiTrackers) {
      if (!usedTrackers.has(tracker)) {
        tracker.age++;
      }
    }

    // ── Шаг 4: Очистка по persistence ───────────────────────────
    this._poiTrackers = this._poiTrackers.filter(
      t => t.age <= config.poiPersistence
    );

    // ── Шаг 5: Фильтрация + ранжирование для рендера ───────────
    //
    // Показываем только трекеры, которые:
    //   1. Достигли минимального порога устойчивости (frameCount >= poiMinFrames)
    //   2. Площадь в допустимых пределах [poiMinSize, poiMaxSize]
    //
    // Сортируем по frameCount (самые устойчивые первыми),
    // берём топ-N (poiMaxZones).
    //
    this._poiResults = this._poiTrackers
      .filter(t => {
        const area = t.width * t.height;
        return t.frameCount >= config.poiMinFrames &&
               area >= config.poiMinSize &&
               area <= config.poiMaxSize;
      })
      .sort((a, b) => b.frameCount - a.frameCount)
      .slice(0, config.poiMaxZones);
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

    // Layer 3: POI HUD
    this._renderPoiTo(this._layerCanvases[3].getContext('2d'), displayW, displayH);
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

  /**
   * Рендер POI HUD на произвольный ctx (layer 3)
   * 
   * Три визуальных элемента:
   *   1. HUD Crosshair (всегда):
   *      - Тонкие серые линии через центр canvas
   *      - Утолщённый центральный маркер 16×16px
   *   
   *   2. POI Zones (если не шум):
   *      - BB прямоугольник: 4 цвета по состоянию трекинга
   *        • Зелёный #00FF00: age=0, frameCount >= 2×poiMinFrames (уверенный трекинг)
   *        • Оранжевый #FF8C00: age=0, frameCount >= poiMinFrames (сомнительный)
   *        • Красный #FF3030: age>0, age <= persistence/2 (потеря недавняя)
   *        • Тёмно-красный #990000: age > persistence/2 (старый, скоро удалится)
   *      - Перекрестие 10px в центре POI
   *      - Пунктирные линии от центра canvas к POI (по осям)
   *      - Текст смещения в % от центра: "X:+12% Y:-8%"
   *   
   *   3. Noise indicator (если _poiNoiseMode):
   *      - Текст "NOISE" в центре canvas
   * 
   * @private
   * @param {CanvasRenderingContext2D} ctx - контекст offscreen layer canvas
   * @param {number} w - ширина canvas (display space)
   * @param {number} h - высота canvas (display space)
   */
  _renderPoiTo(ctx, w, h) {
    const { config } = this;
    const scaleX = w / config.processWidth;
    const scaleY = h / config.processHeight;

    const canvasCx = w / 2;
    const canvasCy = h / 2;

    // ── 1. HUD Crosshair (всегда рисуем) ───────────────────────
    //
    // Тонкие серые линии через центр + утолщённый маркер центра
    //
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
    ctx.lineWidth = 1;

    // Горизонтальная линия через весь canvas
    ctx.beginPath();
    ctx.moveTo(0, canvasCy);
    ctx.lineTo(w, canvasCy);
    ctx.stroke();

    // Вертикальная линия через весь canvas
    ctx.beginPath();
    ctx.moveTo(canvasCx, 0);
    ctx.lineTo(canvasCx, h);
    ctx.stroke();

    // Центральный маркер (16×16 px, утолщённая линия)
    ctx.lineWidth = 2;
    const markerSize = 8; // половина 16px
    ctx.beginPath();
    ctx.moveTo(canvasCx - markerSize, canvasCy);
    ctx.lineTo(canvasCx + markerSize, canvasCy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvasCx, canvasCy - markerSize);
    ctx.lineTo(canvasCx, canvasCy + markerSize);
    ctx.stroke();

    // ── 2. Режим "шум" — текст вместо зон ──────────────────────
    if (this._poiNoiseMode) {
      ctx.font = '24px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NOISE', canvasCx, canvasCy - 40);
      return;
    }

    // ── 3. POI Zones — прицелы + смещения ──────────────────────
    if (this._poiResults.length === 0) return;

    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const poi of this._poiResults) {
      // Используем RAW координаты (актуальные) для отрисовки прицела без лага
      // EMA-сглаженные (cx,cy) остаются для алгоритма матчинга
      const poiCx = (poi.rawCx || poi.cx) * scaleX;
      const poiCy = (poi.rawCy || poi.cy) * scaleY;
      const poiW = (poi.rawWidth || poi.width) * scaleX;
      const poiH = (poi.rawHeight || poi.height) * scaleY;

      // ── Логика цвета (4 режима по состоянию трекинга) ───────
      //
      // Зелёный:        age=0, frameCount >= 2x (уверенное трассирование)
      // Оранжевый:      age=0, frameCount >= 1x (сомнительный)
      // Красный яркий:  age > 0, age <= persistence/2 (потеря)
      // Красный тёмный: age > persistence/2 (старый, скоро удалится)
      //
      let color;
      if (poi.age === 0) {
        // Активное трассирование
        if (poi.frameCount >= config.poiMinFrames * 2) {
          color = '#00FF00';  // зелёный — уверенный трекинг
        } else {
          color = '#FF8C00';  // оранжевый — сомнительный
        }
      } else {
        // Потеря объекта (persistence mode)
        if (poi.age <= config.poiPersistence / 2) {
          color = '#FF3030';  // красный яркий — недавняя потеря
        } else {
          color = '#990000';  // красный тёмный — старый, скоро удалится
        }
      }

      // ── BB прямоугольник ────────────────────────────────────
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const x = poiCx - poiW / 2;
      const y = poiCy - poiH / 2;
      ctx.strokeRect(x, y, poiW, poiH);

      // ── Перекрестие центра POI ──────────────────────────────
      const crossSize = 5;
      ctx.beginPath();
      ctx.moveTo(poiCx - crossSize, poiCy);
      ctx.lineTo(poiCx + crossSize, poiCy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(poiCx, poiCy - crossSize);
      ctx.lineTo(poiCx, poiCy + crossSize);
      ctx.stroke();

      // ── Пунктирные линии к центру (по осям) ─────────────────
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;

      // Горизонтальная пунктирная линия от центра canvas до POI
      ctx.beginPath();
      ctx.moveTo(canvasCx, poiCy);
      ctx.lineTo(poiCx, poiCy);
      ctx.stroke();

      // Вертикальная пунктирная линия от центра canvas до POI
      ctx.beginPath();
      ctx.moveTo(poiCx, canvasCy);
      ctx.lineTo(poiCx, poiCy);
      ctx.stroke();

      ctx.setLineDash([]);  // сброс пунктира

      // ── Текст смещения (проценты от центра) ─────────────────
      //
      // offsetX = ((poiCx - canvasCx) / (w/2)) * 100
      // offsetY = ((poiCy - canvasCy) / (h/2)) * 100
      //
      const offsetX = Math.round(((poiCx - canvasCx) / (w / 2)) * 100);
      const offsetY = Math.round(((poiCy - canvasCy) / (h / 2)) * 100);
      const signX = offsetX >= 0 ? '+' : '';
      const signY = offsetY >= 0 ? '+' : '';

      ctx.fillStyle = color;
      ctx.fillText(`X:${signX}${offsetX}% Y:${signY}${offsetY}%`, x + 4, y - 16);
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

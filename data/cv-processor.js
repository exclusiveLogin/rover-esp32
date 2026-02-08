/**
 * ============================================================
 * 👁️ CV Processor — Компьютерное зрение в браузере
 * ============================================================
 * 
 * Модуль обработки видеопотока с помощью OpenCV.js
 * 
 * Функции:
 *   - Детекция линии горизонта (с учётом наклона камеры)
 *   - Построение перспективной сетки пола
 *   - Детекция вертикальных линий (стены, углы)
 * 
 * Алгоритм детекции горизонта:
 *   1. Canny edge detection → контуры
 *   2. Hough transform → линии
 *   3. Кластеризация по углу → параллельные линии
 *   4. Кластеризация по параметру d → коллинеарные линии
 *   5. Взвешенная медиана → финальная линия
 * 
 * @requires OpenCV.js (загружается асинхронно)
 * 
 * Использование:
 *   const processor = new CVProcessor(videoElement, options);
 *   await processor.start();       // включает обработку
 *   // Compositor вызывает processor.tick(now) + processor.getLayer(i)
 *   processor.stop();
 * 
 * ============================================================
 */

class CVProcessor {
  
  // ==========================================================
  // 📐 Константы
  // ==========================================================
  
  static DEFAULTS = {
    // Разрешение обработки (px)
    processWidth: 320,
    processHeight: 240,
    processInterval: 100,  // мс между кадрами (10 FPS)
    
    // Canny edge detection
    cannyLow: 50,
    cannyHigh: 150,
    
    // Hough line detection
    houghThreshold: 50,
    houghMinLength: 50,
    houghMaxGap: 10,
    
    // Углы (градусы)
    horizonMaxAngle: 45,     // макс. отклонение от горизонтали
    wallAngleTolerance: 15,  // допуск от вертикали для стен
    clusterAngleTolerance: 8,// допуск для кластеризации по углу
    
    // Сглаживание
    smoothFrames: 5,         // буфер медианного фильтра
    minClusterSegments: 1,   // минимум сегментов в кластере
    
    // Цвета
    colors: {
      horizon: '#00FF00',
      grid: 'rgba(0, 255, 255, 0.4)',
      walls: '#FF6600'
    },
    
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
      ...CVProcessor.DEFAULTS,
      colors: { ...CVProcessor.DEFAULTS.colors },
      ...options
    };
    
    // Состояние
    this._running = false;
    this._lastProcessTime = 0;
    this._cvReady = false;
    
    // Буферы для временного сглаживания (медианный фильтр)
    this._buffers = {
      horizonY: [],
      horizonAngle: []
    };
    
    // Результаты последней обработки
    this.lastResult = { horizon: null, walls: [], timestamp: 0 };
    
    // Callbacks
    this.onProcess = options.onProcess || null;
    this.onError = options.onError || null;
    
    // ── Offscreen canvases для getLayer() (композитор) ──────
    // 6 слоёв: 0=Grayscale, 1=Edges, 2=Lines, 3=Horizon, 4=Grid, 5=Walls
    this._layerCanvases = [];
    for (let i = 0; i < 6; i++) {
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
      // OpenCV.js 4.5+ WASM: cv — это Promise, нужно await
      if (typeof cv !== 'undefined') {
        if (cv instanceof Promise || typeof cv === 'function') {
          cv = await cv;
        }
        if (cv.Mat) {
          this._cvReady = true;
          console.log('✅ CVProcessor: OpenCV.js ready');
          return;
        }
      }
      console.warn('⏳ CVProcessor: waiting for OpenCV.js...');
    } catch (e) {
      console.warn('⏳ CVProcessor: OpenCV.js not ready yet:', e.message);
    }
  }
  
  /**
   * Ожидание загрузки OpenCV.js
   * @param {number} timeout - таймаут в мс (по умолчанию 30 сек)
   * @returns {Promise<boolean>} - true если загружен
   */
  async waitForOpenCV(timeout = 30000) {
    if (this._cvReady) return true;
    
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        // OpenCV.js 4.5+ WASM: cv — это Promise, нужно await
        if (typeof cv !== 'undefined') {
          if (cv instanceof Promise || typeof cv === 'function') {
            cv = await cv;
          }
          if (cv.Mat) {
            this._cvReady = true;
            console.log('✅ CVProcessor: OpenCV.js loaded');
            return true;
          }
        }
      } catch (e) { /* WASM ещё инициализируется */ }
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.error('❌ CVProcessor: OpenCV.js timeout');
    return false;
  }
  
  // ==========================================================
  // 🎬 Управление
  // ==========================================================
  
  /** Запуск обработки (tick вызывается Compositor'ом) */
  async start() {
    if (!this._cvReady && !(await this.waitForOpenCV())) {
      this.onError?.('OpenCV.js не загружен');
      return false;
    }
    
    this.config.enabled = true;
    this._running = true;
    console.log('▶️ CVProcessor: Started');
    return true;
  }
  
  /** Остановка обработки */
  stop() {
    this._running = false;
    this.config.enabled = false;
    
    // Очистка offscreen layer canvases
    for (const c of this._layerCanvases) {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
    }
    console.log('⏹️ CVProcessor: Stopped');
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
   * @param {number} localIndex - 0..5
   *   0=Grayscale, 1=Edges, 2=Lines, 3=Horizon, 4=Grid, 5=Walls
   * @returns {HTMLCanvasElement|null}
   */
  getLayer(localIndex) {
    if (localIndex < 0 || localIndex >= this._layerCanvases.length) return null;
    return this._layerCanvases[localIndex];
  }

  /** Число слоёв этого процессора */
  static get LAYER_COUNT() { return 6; }

  // ==========================================================
  // 🔄 Обработка кадра
  // ==========================================================
  
  /** Обработка одного кадра */
  _processFrame() {
    try {
      this._syncCanvasSize();
      
      const src = this._captureFrame();
      if (!src) return;
      
      const result = this._analyze(src);
      this.lastResult = { ...result, timestamp: Date.now() };
      
      // Рендер в offscreen layer canvases (для композитора)
      this._renderLayers(result);
      
      this.onProcess?.(result);
      
      src.delete();  // ВАЖНО: освобождаем память OpenCV
      
    } catch (error) {
      console.error('CVProcessor error:', error);
      this.onError?.(error.message);
    }
  }
  
  // ==========================================================
  // 📷 Захват кадра
  // ==========================================================
  
  /** Синхронизация размеров capture canvas */
  _syncCanvasSize() {
    const { captureCanvas, config } = this;
    
    if (captureCanvas.width !== config.processWidth) {
      captureCanvas.width = config.processWidth;
      captureCanvas.height = config.processHeight;
    }
  }
  
  /** Захват кадра с видео/изображения */
  _captureFrame() {
    const { video, captureCanvas, captureCtx, config } = this;
    const isVideo = video.tagName === 'VIDEO';
    
    // Проверка готовности источника
    if (isVideo) {
      if (video.readyState < 2 || video.videoWidth === 0) return null;
    } else {
      if (!video.complete || video.naturalWidth === 0) return null;
    }
    
    // Масштабируем в уменьшенный canvas
    captureCtx.drawImage(video, 0, 0, config.processWidth, config.processHeight);
    
    return cv.imread(captureCanvas);
  }
  
  // ==========================================================
  // 🔍 Анализ изображения
  // ==========================================================
  
  /**
   * Основной анализ: edge detection → line detection → clustering
   * @param {cv.Mat} src - входное изображение
   * @returns {Object} { horizon, walls }
   */
  _analyze(src) {
    const width = src.cols;
    const height = src.rows;
    
    // Вычисляем адаптивные параметры (зависят от разрешения)
    const params = this._computeAdaptiveParams(width, height);
    
    // OpenCV матрицы (создаём здесь, чтобы гарантировать delete)
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    const lines = new cv.Mat();
    
    try {
      // 1. Grayscale + Gaussian blur (убирает шум)
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      
      // 2. Canny edge detection
      cv.Canny(gray, edges, params.cannyLow, params.cannyHigh);
      
      // 3. Hough line detection (probabilistic)
      cv.HoughLinesP(
        edges, lines,
        1,                    // rho resolution (px)
        Math.PI / 180,        // theta resolution (rad)
        params.houghThreshold,
        params.houghMinLength,
        params.houghMaxGap
      );
      
      // Заполняем layer canvases 0-2 (Grayscale, Edges, Lines)
      // + legacy debug canvases если debug включён
      this._renderDebugCanvases(gray, edges, lines, width, height);
      
      // 4. Классификация и кластеризация линий
      return this._classifyLines(lines, width, height, params);
      
    } finally {
      // ВАЖНО: всегда освобождаем память OpenCV
      gray.delete();
      edges.delete();
      lines.delete();
    }
  }
  
  /**
   * Рендер слоёв 0-2 (Grayscale, Edges, Lines) в offscreen canvases
   * @param {cv.Mat} gray - grayscale изображение
   * @param {cv.Mat} edges - Canny edges
   * @param {cv.Mat} lines - Hough lines
   * @param {number} width - ширина изображения
   * @param {number} height - высота изображения
   */
  _renderDebugCanvases(gray, edges, lines, width, height) {
    const layers = this._layerCanvases;
    
    try {
      // Layer 0: Grayscale (яркость → альфа)
      if (layers[0].width !== width || layers[0].height !== height) {
        layers[0].width = width;
        layers[0].height = height;
      }
      cv.imshow(layers[0], gray);
      this._brightnessToAlpha(layers[0]);
      
      // Layer 1: Canny Edges (белые края → видимые, чёрный фон → прозрачный)
      if (layers[1].width !== width || layers[1].height !== height) {
        layers[1].width = width;
        layers[1].height = height;
      }
      cv.imshow(layers[1], edges);
      this._brightnessToAlpha(layers[1]);
      
      // Layer 2: Lines visualization (цветные линии → видимые, чёрный фон → прозрачный)
      const linesVis = new cv.Mat.zeros(height, width, cv.CV_8UC3);
      
      for (let i = 0; i < lines.rows; i++) {
        const x1 = lines.data32S[i * 4];
        const y1 = lines.data32S[i * 4 + 1];
        const x2 = lines.data32S[i * 4 + 2];
        const y2 = lines.data32S[i * 4 + 3];
        
        const angle = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
        const normAngle = angle > 90 ? 180 - angle : angle;
        
        let color;
        if (normAngle < this.config.horizonMaxAngle) {
          color = new cv.Scalar(0, 255, 0);
        } else if (normAngle > 90 - this.config.wallAngleTolerance) {
          color = new cv.Scalar(255, 100, 0);
        } else {
          color = new cv.Scalar(100, 100, 255);
        }
        
        cv.line(linesVis, new cv.Point(x1, y1), new cv.Point(x2, y2), color, 2);
      }
      
      if (layers[2].width !== width || layers[2].height !== height) {
        layers[2].width = width;
        layers[2].height = height;
      }
      cv.imshow(layers[2], linesVis);
      this._brightnessToAlpha(layers[2]);
      linesVis.delete();
      
    } catch (e) {
      console.warn('CVProcessor layer 0-2 render error:', e);
    }
  }
  
  /**
   * Вычисление адаптивных параметров под разрешение
   * @param {number} w - ширина
   * @param {number} h - высота
   */
  _computeAdaptiveParams(w, h) {
    const diagonal = Math.sqrt(w * w + h * h);
    const scale = Math.min(w / 640, h / 480);
    const { config } = this;
    
    return {
      // Canny: снижаем пороги для лучшей детекции тёмных линий
      cannyLow: Math.max(20, config.cannyLow * scale * 0.7),
      cannyHigh: Math.max(60, config.cannyHigh * scale * 0.8),
      
      // Hough: адаптируем под размер изображения
      houghThreshold: Math.max(20, Math.min(config.houghThreshold, Math.sqrt(w * h) * 0.15)),
      houghMinLength: Math.max(20, Math.min(config.houghMinLength, diagonal * 0.08)),
      houghMaxGap: Math.max(5, Math.min(config.houghMaxGap, w * 0.05)),
      
      // Кластеризация
      clusterToleranceD: Math.max(10, diagonal * 0.03),  // 3% от диагонали
      clusterToleranceAngle: config.clusterAngleTolerance || 8
    };
  }
  
  // ==========================================================
  // 📊 Классификация линий
  // ==========================================================
  
  /**
   * Классификация линий на горизонтальные и вертикальные
   * @param {cv.Mat} lines - результат HoughLinesP
   * @param {number} width - ширина изображения
   * @param {number} height - высота изображения
   * @param {Object} params - адаптивные параметры
   */
  _classifyLines(lines, width, height, params) {
    const horizonCandidates = [];
    const wallCandidates = [];
    
    const maxHorizonAngle = this.config.horizonMaxAngle;
    const wallTolerance = this.config.wallAngleTolerance;
    
    // Проходим по всем линиям из Hough transform
    for (let i = 0; i < lines.rows; i++) {
      const [x1, y1, x2, y2] = [
        lines.data32S[i * 4],
        lines.data32S[i * 4 + 1],
        lines.data32S[i * 4 + 2],
        lines.data32S[i * 4 + 3]
      ];
      
      // Угол линии (градусы, -180..180)
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const length = Math.hypot(x2 - x1, y2 - y1);
      
      // Нормализуем угол к диапазону [-90, 90]
      let normAngle = angle;
      if (normAngle > 90) normAngle -= 180;
      if (normAngle < -90) normAngle += 180;
      
      // Центр линии
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      
      // Параметр d (расстояние от начала координат до прямой)
      // Уравнение прямой: x·sin(θ) - y·cos(θ) = d
      // Это инвариант для коллинеарных сегментов
      const rad = normAngle * Math.PI / 180;
      const d = cx * Math.sin(rad) - cy * Math.cos(rad);
      
      // Классификация по углу
      if (Math.abs(normAngle) < maxHorizonAngle) {
        // Горизонтальные/наклонные (кандидаты на горизонт)
        horizonCandidates.push({ x1, y1, x2, y2, cx, cy, angle: normAngle, d, length });
      }
      
      if (Math.abs(Math.abs(angle) - 90) < wallTolerance) {
        // Вертикальные (стены)
        wallCandidates.push({ x1, y1, x2, y2, angle, length });
      }
    }
    
    // Детекция горизонта через кластеризацию
    const horizon = this._detectHorizon(horizonCandidates, width, height, params);
    
    // Стены: топ-10 по длине
    wallCandidates.sort((a, b) => b.length - a.length);
    const walls = wallCandidates.slice(0, 10);
    
    return { horizon, walls };
  }
  
  // ==========================================================
  // 🎯 Детекция горизонта (кластеризация)
  // ==========================================================
  
  /**
   * Robust детекция горизонта через двухэтапную кластеризацию
   * 
   * Алгоритм:
   *   1. Кластеризация по углу → группы параллельных линий
   *   2. Кластеризация по d → группы коллинеарных линий
   *   3. Выбор лучшего кластера по score = length × √segments
   *   4. Финальная линия по взвешенной медиане
   */
  _detectHorizon(candidates, width, height, params) {
    if (candidates.length === 0) return null;
    
    const { clusterToleranceD, clusterToleranceAngle } = params;
    const minSegments = this.config.minClusterSegments;
    
    // ШАГ 1: Кластеризация по углу (параллельные линии)
    const angleClusters = this._clusterByProperty(
      candidates, 
      'angle', 
      clusterToleranceAngle,
      minSegments
    );
    
    if (angleClusters.length === 0) return null;
    
    // ШАГ 2: Для каждого кластера → подкластеры по d (коллинеарные)
    const collinearClusters = [];
    for (const angleCluster of angleClusters) {
      const dClusters = this._clusterByProperty(
        angleCluster, 
        'd', 
        clusterToleranceD,
        minSegments
      );
      collinearClusters.push(...dClusters);
    }
    
    if (collinearClusters.length === 0) return null;
    
    // ШАГ 3: Оценка кластеров и выбор лучшего
    const best = this._selectBestCluster(collinearClusters);
    
    // ШАГ 4: Построение финальной линии по взвешенной медиане
    return this._buildHorizonLine(best, width, height);
  }
  
  /**
   * Универсальная кластеризация по свойству
   * @param {Array} items - массив объектов
   * @param {string} prop - свойство для сравнения
   * @param {number} tolerance - допуск
   * @param {number} minSize - минимальный размер кластера
   */
  _clusterByProperty(items, prop, tolerance, minSize = 1) {
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      
      const seed = items[i];
      const cluster = [seed];
      used.add(i);
      
      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;
        
        if (Math.abs(seed[prop] - items[j][prop]) < tolerance) {
          cluster.push(items[j]);
          used.add(j);
        }
      }
      
      if (cluster.length >= minSize) {
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }
  
  /**
   * Выбор лучшего кластера по score
   * Score = totalLength × √segmentCount × angleBonus
   */
  _selectBestCluster(clusters) {
    let best = null;
    let bestScore = -Infinity;
    
    for (const cluster of clusters) {
      const totalLength = cluster.reduce((sum, l) => sum + l.length, 0);
      const segmentCount = cluster.length;
      
      // Взвешенный средний угол
      const avgAngle = cluster.reduce((sum, l) => sum + l.angle * l.length, 0) / totalLength;
      
      // Бонус за близость к горизонтали (0°)
      const angleBonus = 1.0 - Math.abs(avgAngle) / 45;
      
      // Score: длина × √сегменты × бонус
      const score = totalLength * Math.sqrt(segmentCount) * (0.7 + 0.3 * angleBonus);
      
      if (score > bestScore) {
        bestScore = score;
        best = { cluster, totalLength, segmentCount, avgAngle, score };
      }
    }
    
    return best;
  }
  
  /**
   * Построение финальной линии горизонта по взвешенной медиане
   */
  _buildHorizonLine(best, width, height) {
    const { cluster, totalLength, segmentCount, score } = best;
    
    // Взвешенная медиана (вес = длина сегмента)
    const medianAngle = this._weightedMedian(cluster.map(l => ({ v: l.angle, w: l.length })));
    const medianD = this._weightedMedian(cluster.map(l => ({ v: l.d, w: l.length })));
    
    // Вычисляем Y в центре экрана
    // Уравнение: x·sin(θ) - y·cos(θ) = d
    // При x = width/2: y = (x·sin(θ) - d) / cos(θ)
    const rad = medianAngle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    
    let centerY = Math.abs(cos) > 0.001
      ? ((width / 2) * sin - medianD) / cos
      : height / 2;
    
    // Временное сглаживание (медианный фильтр)
    const smoothY = this._smoothValue('horizonY', centerY);
    const smoothAngle = this._smoothValue('horizonAngle', medianAngle);
    
    // Confidence: нормализуем относительно диагонали изображения
    // Ожидаем: totalLength ≈ diagonal/2, segments ≥ 3 для хорошей уверенности
    // Score = totalLength × √segments × angleBonus
    // При "идеальном" горизонте: score ≈ (diagonal/2) × √3 × 1.0 ≈ diagonal × 0.87
    const diagonal = Math.sqrt(width * width + height * height);
    const expectedScore = diagonal * 0.8;  // ~80% диагонали как "отличный" score
    const confidence = Math.min(score / expectedScore, 1);
    
    return {
      y: smoothY,
      angle: smoothAngle,
      d: medianD,
      segments: cluster,
      confidence,
      segmentCount,
      totalLength
    };
  }
  
  // ==========================================================
  // 🧮 Утилиты
  // ==========================================================
  
  /**
   * Взвешенная медиана
   * @param {Array} items - массив { v: value, w: weight }
   */
  _weightedMedian(items) {
    if (items.length === 0) return 0;
    if (items.length === 1) return items[0].v;
    
    const sorted = [...items].sort((a, b) => a.v - b.v);
    const totalWeight = sorted.reduce((sum, x) => sum + x.w, 0);
    const half = totalWeight / 2;
    
    let cumWeight = 0;
    for (const item of sorted) {
      cumWeight += item.w;
      if (cumWeight >= half) return item.v;
    }
    
    return sorted[sorted.length - 1].v;
  }
  
  /**
   * Временное сглаживание (медианный фильтр)
   * @param {string} bufferName - имя буфера
   * @param {number} value - новое значение
   */
  _smoothValue(bufferName, value) {
    const buffer = this._buffers[bufferName];
    const maxSize = this.config.smoothFrames;
    
    buffer.push(value);
    if (buffer.length > maxSize) buffer.shift();
    
    // Медиана
    const sorted = [...buffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  
  // ==========================================================
  // 🎨 Визуализация
  // ==========================================================
  
  /**
   * Рендер в offscreen layer canvases (для композитора).
   * Layers 0-2 (Grayscale, Edges, Lines) заполняются в _renderDebugCanvases.
   * Layers 3-5 (Horizon, Grid, Walls) рендерятся здесь.
   */
  _renderLayers(result) {
    const { config } = this;
    const { horizon, walls } = result;

    // Размеры для overlay-слоёв (3, 4, 5) = display size
    const video = this.video;
    const isVideo = video.tagName === 'VIDEO';
    const displayW = video.clientWidth || (isVideo ? video.videoWidth : video.naturalWidth);
    const displayH = video.clientHeight || (isVideo ? video.videoHeight : video.naturalHeight);

    // Масштаб: обработка → дисплей
    const scaleX = displayW / config.processWidth;
    const scaleY = displayH / config.processHeight;

    // Синхронизация размеров overlay-слоёв (3, 4, 5)
    for (let i = 3; i < 6; i++) {
      const c = this._layerCanvases[i];
      if (c.width !== displayW || c.height !== displayH) {
        c.width = displayW;
        c.height = displayH;
      }
      c.getContext('2d').clearRect(0, 0, displayW, displayH);
    }

    // Layer 3: Horizon
    if (horizon) {
      const ctx3 = this._layerCanvases[3].getContext('2d');
      this._drawHorizonToCtx(ctx3, horizon, scaleX, scaleY, displayW);
    }

    // Layer 4: Grid
    if (horizon) {
      const ctx4 = this._layerCanvases[4].getContext('2d');
      this._drawGridToCtx(ctx4, horizon, scaleX, scaleY, displayW, displayH);
    }

    // Layer 5: Walls
    if (walls && walls.length > 0) {
      const ctx5 = this._layerCanvases[5].getContext('2d');
      this._drawWallsToCtx(ctx5, walls, scaleX, scaleY);
    }
  }

  /** Отрисовка горизонта на произвольный ctx */
  _drawHorizonToCtx(ctx, horizon, scaleX, scaleY, canvasWidth) {
    const { config } = this;
    const { y, angle, confidence, segments, segmentCount } = horizon;
    const yScaled = y * scaleY;
    const alpha = 0.5 + confidence * 0.5;

    ctx.strokeStyle = this._colorWithAlpha(config.colors.horizon, alpha);
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    if (Math.abs(angle) > 0.5) {
      const rad = angle * Math.PI / 180;
      const halfW = canvasWidth / 2;
      const offset = Math.tan(rad) * halfW;
      ctx.moveTo(0, yScaled - offset);
      ctx.lineTo(canvasWidth, yScaled + offset);
    } else {
      ctx.moveTo(0, yScaled);
      ctx.lineTo(canvasWidth, yScaled);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (segments && segments.length > 1) {
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
      ctx.lineWidth = 4;
      for (const seg of segments) {
        ctx.beginPath();
        ctx.moveTo(seg.x1 * scaleX, seg.y1 * scaleY);
        ctx.lineTo(seg.x2 * scaleX, seg.y2 * scaleY);
        ctx.stroke();
      }
    }

    ctx.fillStyle = config.colors.horizon;
    ctx.font = '12px monospace';
    const angleStr = Math.abs(angle) > 0.5 ? ` ∠${angle.toFixed(1)}°` : '';
    ctx.fillText(`Горизонт ${Math.round(confidence * 100)}% (${segmentCount})${angleStr}`, 10, yScaled - 5);
  }

  /** Отрисовка сетки на произвольный ctx */
  _drawGridToCtx(ctx, horizon, scaleX, scaleY, canvasWidth, canvasHeight) {
    const { config } = this;
    const vpX = (config.processWidth / 2) * scaleX;
    const vpY = horizon.y * scaleY;
    const bottomY = canvasHeight;
    const width = canvasWidth;

    ctx.strokeStyle = config.colors.grid;
    ctx.lineWidth = 1;

    const gridCols = 12;
    for (let i = 0; i <= gridCols; i++) {
      const t = i / gridCols;
      ctx.beginPath();
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(t * width, bottomY);
      ctx.stroke();
    }

    const gridRows = 8;
    const angleRad = (horizon.angle || 0) * Math.PI / 180;
    for (let i = 1; i <= gridRows; i++) {
      const t = Math.pow(i / gridRows, 1.5);
      const y = vpY + t * (bottomY - vpY);
      const perspScale = (y - vpY) / (bottomY - vpY);
      const halfW = (width / 2) * perspScale * 1.2;
      const offset = Math.tan(angleRad) * halfW;
      ctx.beginPath();
      ctx.moveTo(vpX - halfW, y - offset);
      ctx.lineTo(vpX + halfW, y + offset);
      ctx.stroke();
    }
  }

  /** Отрисовка стен на произвольный ctx */
  _drawWallsToCtx(ctx, walls, scaleX, scaleY) {
    ctx.strokeStyle = this.config.colors.walls;
    ctx.lineWidth = 2;
    for (const wall of walls) {
      ctx.beginPath();
      ctx.moveTo(wall.x1 * scaleX, wall.y1 * scaleY);
      ctx.lineTo(wall.x2 * scaleX, wall.y2 * scaleY);
      ctx.stroke();
    }
  }

  
  /**
   * Конвертация яркости в альфа-канал.
   * Чёрный (0) → прозрачный, белый/цветной → непрозрачный.
   * Позволяет слоям 0-2 прозрачно накладываться поверх видео.
   */
  _brightnessToAlpha(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = Math.max(d[i], d[i + 1], d[i + 2]);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  /** Добавление альфа-канала к цвету */
  _colorWithAlpha(color, alpha) {
    // #RRGGBB → rgba(r, g, b, alpha)
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }
  
  // ==========================================================
  // ⚙️ API настроек
  // ==========================================================
  
  /** Обновление конфигурации */
  updateConfig(options) {
    Object.assign(this.config, options);
  }
}

// ==========================================================
// 🌐 Экспорт
// ==========================================================

window.CVProcessor = CVProcessor;

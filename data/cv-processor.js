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
 *   const processor = new CVProcessor(videoElement, overlayCanvas);
 *   await processor.start();
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
    
    // Debug
    debug: false  // Вывод промежуточных этапов на debug-canvas
  };
  
  // ==========================================================
  // 🏗️ Конструктор
  // ==========================================================
  
  /**
   * @param {HTMLVideoElement|HTMLImageElement} videoElement - источник видео
   * @param {HTMLCanvasElement} overlayCanvas - canvas для отрисовки
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
      ...CVProcessor.DEFAULTS,
      colors: { ...CVProcessor.DEFAULTS.colors },
      ...options,
      enabled: false
    };
    
    // Состояние
    this._running = false;
    this._lastProcessTime = 0;
    this._animationId = null;
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
    
    // Debug canvases (для визуализации промежуточных этапов)
    this._debugCanvases = {
      gray: null,
      edges: null,
      lines: null
    };
    
    this._checkOpenCV();
  }
  
  // ==========================================================
  // 🔧 Инициализация OpenCV
  // ==========================================================
  
  /** Проверка готовности OpenCV.js */
  _checkOpenCV() {
    if (typeof cv !== 'undefined' && cv.Mat) {
      this._cvReady = true;
      console.log('✅ CVProcessor: OpenCV.js ready');
    } else {
      console.warn('⏳ CVProcessor: waiting for OpenCV.js...');
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
      if (typeof cv !== 'undefined' && cv.Mat) {
        this._cvReady = true;
        console.log('✅ CVProcessor: OpenCV.js loaded');
        return true;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    console.error('❌ CVProcessor: OpenCV.js timeout');
    return false;
  }
  
  // ==========================================================
  // 🎬 Управление
  // ==========================================================
  
  /** Запуск обработки */
  async start() {
    if (!this._cvReady && !(await this.waitForOpenCV())) {
      this.onError?.('OpenCV.js не загружен');
      return false;
    }
    
    this.config.enabled = true;
    this._running = true;
    this._processLoop();
    console.log('▶️ CVProcessor: Started');
    return true;
  }
  
  /** Остановка обработки */
  stop() {
    this._running = false;
    this.config.enabled = false;
    
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    
    this._clearOverlay();
    console.log('⏹️ CVProcessor: Stopped');
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
  // 👁️ Debug режим
  // ==========================================================
  
  /**
   * Установка debug-канвасов для отображения промежуточных этапов CV
   * @param {Object} canvases - объект с canvas элементами
   * @param {HTMLCanvasElement} canvases.gray - canvas для grayscale
   * @param {HTMLCanvasElement} canvases.edges - canvas для Canny edges
   * @param {HTMLCanvasElement} canvases.lines - canvas для Hough lines
   */
  setDebugCanvases(canvases) {
    if (canvases.gray) this._debugCanvases.gray = canvases.gray;
    if (canvases.edges) this._debugCanvases.edges = canvases.edges;
    if (canvases.lines) this._debugCanvases.lines = canvases.lines;
    console.log('👁️ CVProcessor: Debug canvases configured');
  }
  
  /**
   * Включение/выключение debug режима
   * @param {boolean} enabled - true для включения
   */
  setDebug(enabled) {
    this.config.debug = enabled;
    console.log(`👁️ CVProcessor: Debug mode ${enabled ? 'ON' : 'OFF'}`);
  }
  
  /**
   * Переключение debug режима
   * @returns {boolean} - новое состояние
   */
  toggleDebug() {
    this.setDebug(!this.config.debug);
    return this.config.debug;
  }
  
  // ==========================================================
  // 🔄 Главный цикл обработки
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
      
      const src = this._captureFrame();
      if (!src) return;
      
      const result = this._analyze(src);
      this.lastResult = { ...result, timestamp: Date.now() };
      
      this._render(result);
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
  
  /** Синхронизация размеров canvas */
  _syncCanvasSize() {
    const { video, overlay, captureCanvas, config } = this;
    
    // Размеры источника
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
      
      // 👁️ Debug: отображение промежуточных этапов
      if (this.config.debug) {
        this._renderDebugCanvases(gray, edges, lines, width, height);
      }
      
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
   * 👁️ Отрисовка debug-канвасов (промежуточные этапы CV)
   * @param {cv.Mat} gray - grayscale изображение
   * @param {cv.Mat} edges - Canny edges
   * @param {cv.Mat} lines - Hough lines
   * @param {number} width - ширина изображения
   * @param {number} height - высота изображения
   */
  _renderDebugCanvases(gray, edges, lines, width, height) {
    const { _debugCanvases: canvases } = this;
    
    try {
      // 1. Grayscale
      if (canvases.gray) {
        cv.imshow(canvases.gray, gray);
      }
      
      // 2. Canny Edges
      if (canvases.edges) {
        cv.imshow(canvases.edges, edges);
      }
      
      // 3. Lines visualization (рисуем линии на чёрном фоне)
      if (canvases.lines) {
        const linesVis = new cv.Mat.zeros(height, width, cv.CV_8UC3);
        
        // Рисуем все найденные линии
        for (let i = 0; i < lines.rows; i++) {
          const x1 = lines.data32S[i * 4];
          const y1 = lines.data32S[i * 4 + 1];
          const x2 = lines.data32S[i * 4 + 2];
          const y2 = lines.data32S[i * 4 + 3];
          
          // Определяем угол для раскраски
          const angle = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
          const normAngle = angle > 90 ? 180 - angle : angle;
          
          // Горизонтальные - зелёные, вертикальные - красные, остальные - жёлтые
          let color;
          if (normAngle < this.config.horizonMaxAngle) {
            color = new cv.Scalar(0, 255, 0);   // Зелёный - горизонтальные
          } else if (normAngle > 90 - this.config.wallAngleTolerance) {
            color = new cv.Scalar(255, 100, 0); // Оранжевый - вертикальные (walls)
          } else {
            color = new cv.Scalar(100, 100, 255); // Бледно-красный - остальные
          }
          
          cv.line(
            linesVis,
            new cv.Point(x1, y1),
            new cv.Point(x2, y2),
            color,
            2
          );
        }
        
        cv.imshow(canvases.lines, linesVis);
        linesVis.delete();
      }
      
    } catch (e) {
      console.warn('👁️ CVProcessor debug render error:', e);
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
      houghMaxGap: Math.max(5, Math.min(config.houghMaxGap, w * 0.03)),
      
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
    
    return {
      y: smoothY,
      angle: smoothAngle,
      d: medianD,
      segments: cluster,
      confidence: Math.min(score / 500, 1),
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
  
  /** Отрисовка результатов */
  _render(result) {
    const { config, overlay } = this;
    const { horizon, walls } = result;
    
    // Масштаб: обработка → дисплей
    const scaleX = overlay.width / config.processWidth;
    const scaleY = overlay.height / config.processHeight;
    
    this._clearOverlay();
    
    if (config.showHorizon && horizon) {
      this._drawHorizon(horizon, scaleX, scaleY);
    }
    
    if (config.showGrid && horizon) {
      this._drawGrid(horizon, scaleX, scaleY);
    }
    
    if (config.showWalls && walls.length > 0) {
      this._drawWalls(walls, scaleX, scaleY);
    }
  }
  
  /** Очистка overlay */
  _clearOverlay() {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
  
  /** Отрисовка линии горизонта */
  _drawHorizon(horizon, scaleX, scaleY) {
    const { ctx, overlay, config } = this;
    const { y, angle, confidence, segments, segmentCount } = horizon;
    
    const yScaled = y * scaleY;
    const alpha = 0.5 + confidence * 0.5;
    
    // Основная линия (пунктир)
    ctx.strokeStyle = this._colorWithAlpha(config.colors.horizon, alpha);
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    
    ctx.beginPath();
    if (Math.abs(angle) > 0.5) {
      // Наклонная линия
      const rad = angle * Math.PI / 180;
      const halfW = overlay.width / 2;
      const offset = Math.tan(rad) * halfW;
      ctx.moveTo(0, yScaled - offset);
      ctx.lineTo(overlay.width, yScaled + offset);
    } else {
      // Горизонтальная линия
      ctx.moveTo(0, yScaled);
      ctx.lineTo(overlay.width, yScaled);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Сегменты кластера (полупрозрачные)
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
    
    // Метка
    ctx.fillStyle = config.colors.horizon;
    ctx.font = '12px monospace';
    const angleStr = Math.abs(angle) > 0.5 ? ` ∠${angle.toFixed(1)}°` : '';
    ctx.fillText(`HORIZON ${Math.round(confidence * 100)}% (${segmentCount} seg)${angleStr}`, 10, yScaled - 5);
  }
  
  /** Отрисовка перспективной сетки */
  _drawGrid(horizon, scaleX, scaleY) {
    const { ctx, overlay, config } = this;
    
    const vpX = (config.processWidth / 2) * scaleX;  // точка схода X
    const vpY = horizon.y * scaleY;                  // точка схода Y
    const bottomY = overlay.height;
    const width = overlay.width;
    
    ctx.strokeStyle = config.colors.grid;
    ctx.lineWidth = 1;
    
    // Вертикальные линии (от точки схода к низу)
    const gridCols = 12;
    for (let i = 0; i <= gridCols; i++) {
      const t = i / gridCols;
      ctx.beginPath();
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(t * width, bottomY);
      ctx.stroke();
    }
    
    // Горизонтальные линии (параллельны горизонту)
    const gridRows = 8;
    const angleRad = (horizon.angle || 0) * Math.PI / 180;
    
    for (let i = 1; i <= gridRows; i++) {
      const t = Math.pow(i / gridRows, 1.5);  // нелинейное распределение
      const y = vpY + t * (bottomY - vpY);
      
      // Ширина с перспективой
      const perspScale = (y - vpY) / (bottomY - vpY);
      const halfW = (width / 2) * perspScale * 1.2;
      
      // Наклон параллельно горизонту
      const offset = Math.tan(angleRad) * halfW;
      
      ctx.beginPath();
      ctx.moveTo(vpX - halfW, y - offset);
      ctx.lineTo(vpX + halfW, y + offset);
      ctx.stroke();
    }
  }
  
  /** Отрисовка вертикальных линий (стены) */
  _drawWalls(walls, scaleX, scaleY) {
    const { ctx, config } = this;
    
    ctx.strokeStyle = config.colors.walls;
    ctx.lineWidth = 2;
    
    for (const wall of walls) {
      ctx.beginPath();
      ctx.moveTo(wall.x1 * scaleX, wall.y1 * scaleY);
      ctx.lineTo(wall.x2 * scaleX, wall.y2 * scaleY);
      ctx.stroke();
    }
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
  
  /** Переключение слоя (horizon, grid, walls) */
  toggleLayer(layer, enabled) {
    const key = `show${layer.charAt(0).toUpperCase() + layer.slice(1)}`;
    if (key in this.config) {
      this.config[key] = enabled ?? !this.config[key];
    }
  }
}

// ==========================================================
// 🌐 Экспорт
// ==========================================================

window.CVProcessor = CVProcessor;

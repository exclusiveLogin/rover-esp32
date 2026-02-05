/**
 * ============================================================
 * 👁️ CV Processor — Компьютерное зрение в браузере
 * ============================================================
 * 
 * Модуль обработки видеопотока с помощью OpenCV.js
 * Детекция: горизонт, сетка пола, стены
 * 
 * @requires OpenCV.js (загружается асинхронно)
 * 
 * Использование:
 *   const cv = new CVProcessor(videoElement, overlayCanvas);
 *   cv.start();
 *   cv.stop();
 * 
 * ============================================================
 */

class CVProcessor {
  constructor(videoElement, overlayCanvas, options = {}) {
    this.video = videoElement;
    this.overlay = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    
    // Скрытый canvas для захвата кадров
    this.captureCanvas = document.createElement('canvas');
    this.captureCtx = this.captureCanvas.getContext('2d');
    
    // Настройки
    this.config = {
      enabled: false,
      processWidth: options.processWidth || 320,    // Разрешение обработки
      processHeight: options.processHeight || 240,
      processInterval: options.processInterval || 100,  // мс между кадрами
      
      // Детекция
      showHorizon: options.showHorizon ?? true,
      showGrid: options.showGrid ?? true,
      showWalls: options.showWalls ?? true,
      
      // Параметры Canny
      cannyLow: options.cannyLow || 50,
      cannyHigh: options.cannyHigh || 150,
      
      // Параметры Hough
      houghThreshold: options.houghThreshold || 50,
      houghMinLength: options.houghMinLength || 50,
      houghMaxGap: options.houghMaxGap || 10,
      
      // Углы фильтрации
      horizonAngleTolerance: options.horizonAngleTolerance || 15,  // градусы
      wallAngleTolerance: options.wallAngleTolerance || 15,
      
      // Цвета
      colors: {
        horizon: options.horizonColor || '#00FF00',
        grid: options.gridColor || 'rgba(0, 255, 255, 0.4)',
        walls: options.wallsColor || '#FF6600',
      },
      
      ...options
    };
    
    // Состояние
    this._running = false;
    this._lastProcessTime = 0;
    this._animationId = null;
    this._cvReady = false;
    
    // Результаты последней обработки
    this.lastResult = {
      horizon: null,
      walls: [],
      timestamp: 0
    };
    
    // Callbacks
    this.onProcess = options.onProcess || null;
    this.onError = options.onError || null;
    
    this._checkOpenCV();
  }
  
  // ============================================================
  // 🔧 Инициализация
  // ============================================================
  
  /**
   * Проверка готовности OpenCV.js
   */
  _checkOpenCV() {
    if (typeof cv !== 'undefined' && cv.Mat) {
      this._cvReady = true;
      console.log('✅ CVProcessor: OpenCV.js ready');
    } else {
      console.warn('⏳ CVProcessor: OpenCV.js not loaded yet');
    }
  }
  
  /**
   * Ожидание загрузки OpenCV.js
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
    
    console.error('❌ CVProcessor: OpenCV.js load timeout');
    return false;
  }
  
  // ============================================================
  // 🎬 Управление
  // ============================================================
  
  /**
   * Запуск обработки
   */
  async start() {
    if (!this._cvReady) {
      const ready = await this.waitForOpenCV();
      if (!ready) {
        this.onError?.('OpenCV.js не загружен');
        return false;
      }
    }
    
    this.config.enabled = true;
    this._running = true;
    this._processLoop();
    console.log('▶️ CVProcessor: Started');
    return true;
  }
  
  /**
   * Остановка обработки
   */
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
  
  /**
   * Переключение
   */
  toggle() {
    if (this._running) {
      this.stop();
    } else {
      this.start();
    }
    return this._running;
  }
  
  /**
   * Проверка состояния
   */
  isRunning() {
    return this._running;
  }
  
  // ============================================================
  // 🔄 Цикл обработки
  // ============================================================
  
  _processLoop() {
    if (!this._running) return;
    
    const now = Date.now();
    if (now - this._lastProcessTime >= this.config.processInterval) {
      this._lastProcessTime = now;
      this._processFrame();
    }
    
    this._animationId = requestAnimationFrame(() => this._processLoop());
  }
  
  _processFrame() {
    try {
      // Синхронизация размеров
      this._syncCanvasSize();
      
      // Захват кадра
      const src = this._captureFrame();
      if (!src) return;
      
      // Обработка
      const result = this._analyze(src);
      this.lastResult = { ...result, timestamp: Date.now() };
      
      // Визуализация
      this._render(result);
      
      // Callback
      this.onProcess?.(result);
      
      // Cleanup
      src.delete();
      
    } catch (error) {
      console.error('CVProcessor error:', error);
      this.onError?.(error.message);
    }
  }
  
  // ============================================================
  // 📷 Захват кадра
  // ============================================================
  
  _syncCanvasSize() {
    const { video, overlay, captureCanvas, config } = this;
    
    // Получаем размеры видео (поддержка img и video элементов)
    const isVideoElement = video.tagName === 'VIDEO';
    const videoWidth = isVideoElement ? video.videoWidth : video.naturalWidth;
    const videoHeight = isVideoElement ? video.videoHeight : video.naturalHeight;
    
    // Используем clientWidth/clientHeight для overlay (размер на экране)
    const displayWidth = video.clientWidth || videoWidth;
    const displayHeight = video.clientHeight || videoHeight;
    
    // Overlay = размер видео на экране
    if (overlay.width !== displayWidth || overlay.height !== displayHeight) {
      overlay.width = displayWidth;
      overlay.height = displayHeight;
    }
    
    // Capture = уменьшенное разрешение для обработки
    if (captureCanvas.width !== config.processWidth) {
      captureCanvas.width = config.processWidth;
      captureCanvas.height = config.processHeight;
    }
  }
  
  _captureFrame() {
    const { video, captureCanvas, captureCtx, config } = this;
    
    // Проверяем что видео готово (поддержка img и video элементов)
    const isVideoElement = video.tagName === 'VIDEO';
    
    if (isVideoElement) {
      // HTMLVideoElement: проверяем readyState и videoWidth
      if (video.readyState < 2 || video.videoWidth === 0) {
        return null;
      }
    } else {
      // HTMLImageElement: проверяем complete и naturalWidth
      if (!video.complete || video.naturalWidth === 0) {
        return null;
      }
    }
    
    // Рисуем кадр на capture canvas (уменьшенный)
    captureCtx.drawImage(video, 0, 0, config.processWidth, config.processHeight);
    
    // Создаём Mat из canvas
    return cv.imread(captureCanvas);
  }
  
  // ============================================================
  // 🔍 Анализ
  // ============================================================
  
  _analyze(src) {
    const result = {
      horizon: null,
      walls: []
    };
    
    // Подготовка
    let gray = new cv.Mat();
    let edges = new cv.Mat();
    let lines = new cv.Mat();
    
    try {
      // Grayscale + Blur
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      
      // Canny edges
      cv.Canny(gray, edges, this.config.cannyLow, this.config.cannyHigh);
      
      // Hough lines
      cv.HoughLinesP(
        edges, lines, 1, Math.PI / 180,
        this.config.houghThreshold,
        this.config.houghMinLength,
        this.config.houghMaxGap
      );
      
      // Классифицируем линии (с кластеризацией горизонта)
      const classified = this._classifyLines(lines, src.cols, src.rows);
      
      result.horizon = classified.horizon;
      result.walls = classified.walls;
      
    } finally {
      gray.delete();
      edges.delete();
      lines.delete();
    }
    
    return result;
  }
  
  _classifyLines(lines, width, height) {
    const horizontalLines = [];
    const verticalLines = [];
    const { horizonAngleTolerance, wallAngleTolerance } = this.config;
    
    // Зона поиска горизонта (верхняя часть кадра)
    const searchZoneTop = height * 0.1;
    const searchZoneBottom = height * 0.7;
    
    for (let i = 0; i < lines.rows; i++) {
      const x1 = lines.data32S[i * 4];
      const y1 = lines.data32S[i * 4 + 1];
      const x2 = lines.data32S[i * 4 + 2];
      const y2 = lines.data32S[i * 4 + 3];
      
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const avgY = (y1 + y2) / 2;
      
      // Горизонтальные (угол ~0° или ~180°)
      const isHorizontal = Math.abs(angle) < horizonAngleTolerance || 
                           Math.abs(angle) > (180 - horizonAngleTolerance);
      
      if (isHorizontal && avgY > searchZoneTop && avgY < searchZoneBottom) {
        horizontalLines.push({ x1, y1, x2, y2, angle, length, avgY });
      }
      
      // Вертикальные (угол ~90° или ~-90°)
      if (Math.abs(Math.abs(angle) - 90) < wallAngleTolerance) {
        verticalLines.push({ x1, y1, x2, y2, angle, length });
      }
    }
    
    // Robust детекция горизонта через кластеризацию
    const horizon = this._findHorizonCluster(horizontalLines, width, height);
    
    // Стены — вертикальные линии, отсортированные по длине
    verticalLines.sort((a, b) => b.length - a.length);
    const walls = verticalLines.slice(0, 10);
    
    return { horizon, walls };
  }
  
  /**
   * Кластеризация горизонтальных линий для robust детекции горизонта
   */
  _findHorizonCluster(horizontalLines, width, height) {
    if (horizontalLines.length === 0) return null;
    
    const clusterTolerance = 15;  // px
    const minClusterSegments = 1;
    
    // Кластеризация по Y
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < horizontalLines.length; i++) {
      if (used.has(i)) continue;
      
      const cluster = [horizontalLines[i]];
      used.add(i);
      
      for (let j = i + 1; j < horizontalLines.length; j++) {
        if (used.has(j)) continue;
        
        const line = horizontalLines[j];
        const isNear = cluster.some(c => Math.abs(c.avgY - line.avgY) < clusterTolerance);
        
        if (isNear) {
          cluster.push(line);
          used.add(j);
        }
      }
      
      clusters.push(cluster);
    }
    
    // Оцениваем кластеры
    const scoredClusters = clusters
      .filter(c => c.length >= minClusterSegments)
      .map(cluster => {
        const totalLength = cluster.reduce((sum, l) => sum + l.length, 0);
        const segmentCount = cluster.length;
        const avgY = cluster.reduce((sum, l) => sum + l.avgY, 0) / segmentCount;
        
        // Score: длина × √(количество сегментов)
        // Больше сегментов = более надёжный горизонт
        const score = totalLength * Math.sqrt(segmentCount);
        
        return { cluster, totalLength, segmentCount, avgY, score };
      })
      .sort((a, b) => b.score - a.score);
    
    if (scoredClusters.length === 0) return null;
    
    const best = scoredClusters[0];
    
    // Сглаживание по времени
    const smoothedY = this._smoothHorizon(best.avgY);
    
    return {
      y: smoothedY,
      segments: best.cluster,
      confidence: Math.min(best.score / 500, 1),
      segmentCount: best.segmentCount,
      totalLength: best.totalLength,
    };
  }
  
  /**
   * Временное сглаживание горизонта (медианный фильтр)
   */
  _smoothHorizon(newY) {
    if (!this._horizonBuffer) {
      this._horizonBuffer = [];
    }
    
    this._horizonBuffer.push(newY);
    if (this._horizonBuffer.length > 5) {
      this._horizonBuffer.shift();
    }
    
    // Медиана
    const sorted = [...this._horizonBuffer].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  
  // ============================================================
  // 🎨 Визуализация
  // ============================================================
  
  _render(result) {
    const { ctx, overlay, config } = this;
    const { horizon, walls } = result;
    
    // Масштаб: обработка → дисплей
    const scaleX = overlay.width / config.processWidth;
    const scaleY = overlay.height / config.processHeight;
    
    // Очищаем
    this._clearOverlay();
    
    // Горизонт
    if (config.showHorizon && horizon) {
      this._drawHorizon(horizon, scaleX, scaleY);
    }
    
    // Сетка пола (используем Y горизонта как точку схода)
    if (config.showGrid && horizon) {
      const vanishingPoint = {
        x: config.processWidth / 2,  // центр по X
        y: horizon.y
      };
      this._drawGrid(vanishingPoint, horizon, scaleX, scaleY);
    }
    
    // Стены
    if (config.showWalls && walls.length > 0) {
      this._drawWalls(walls, scaleX, scaleY);
    }
  }
  
  _clearOverlay() {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
  
  _drawHorizon(horizon, scaleX, scaleY) {
    const { ctx, overlay, config } = this;
    
    const y = horizon.y * scaleY;
    const confidence = horizon.confidence || 0;
    
    // Основная линия горизонта (яркость зависит от confidence)
    const alpha = 0.5 + confidence * 0.5;
    ctx.strokeStyle = config.colors.horizon.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(overlay.width, y);
    ctx.stroke();
    
    ctx.setLineDash([]);
    
    // Отдельные сегменты (для визуализации кластера)
    if (horizon.segments && horizon.segments.length > 1) {
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
      ctx.lineWidth = 4;
      horizon.segments.forEach(seg => {
        ctx.beginPath();
        ctx.moveTo(seg.x1 * scaleX, seg.y1 * scaleY);
        ctx.lineTo(seg.x2 * scaleX, seg.y2 * scaleY);
        ctx.stroke();
      });
    }
    
    // Метка с confidence
    ctx.fillStyle = config.colors.horizon;
    ctx.font = '12px monospace';
    const label = `HORIZON ${Math.round(confidence * 100)}% (${horizon.segmentCount} seg)`;
    ctx.fillText(label, 10, y - 5);
  }
  
  _drawGrid(vp, horizon, scaleX, scaleY) {
    const { ctx, overlay, config } = this;
    
    const vpX = vp.x * scaleX;
    const vpY = vp.y * scaleY;
    const bottomY = overlay.height;
    const width = overlay.width;
    
    ctx.strokeStyle = config.colors.grid;
    ctx.lineWidth = 1;
    
    // Линии от точки схода к низу экрана
    const gridLines = 12;
    for (let i = 0; i <= gridLines; i++) {
      const t = i / gridLines;
      const bottomX = t * width;
      
      ctx.beginPath();
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(bottomX, bottomY);
      ctx.stroke();
    }
    
    // Горизонтальные линии с перспективой
    const gridRows = 8;
    for (let i = 1; i <= gridRows; i++) {
      const t = Math.pow(i / gridRows, 1.5);  // нелинейное распределение
      const y = vpY + t * (bottomY - vpY);
      
      // Ширина зависит от расстояния до горизонта
      const perspectiveScale = (y - vpY) / (bottomY - vpY);
      const halfWidth = (width / 2) * perspectiveScale * 1.2;
      
      ctx.beginPath();
      ctx.moveTo(vpX - halfWidth, y);
      ctx.lineTo(vpX + halfWidth, y);
      ctx.stroke();
    }
  }
  
  _drawWalls(walls, scaleX, scaleY) {
    const { ctx, config } = this;
    
    ctx.strokeStyle = config.colors.walls;
    ctx.lineWidth = 2;
    
    walls.forEach(wall => {
      ctx.beginPath();
      ctx.moveTo(wall.x1 * scaleX, wall.y1 * scaleY);
      ctx.lineTo(wall.x2 * scaleX, wall.y2 * scaleY);
      ctx.stroke();
    });
  }
  
  // ============================================================
  // ⚙️ Настройки
  // ============================================================
  
  /**
   * Обновление конфига
   */
  updateConfig(options) {
    Object.assign(this.config, options);
  }
  
  /**
   * Включить/выключить слой
   */
  toggleLayer(layer, enabled) {
    const key = `show${layer.charAt(0).toUpperCase() + layer.slice(1)}`;
    if (key in this.config) {
      this.config[key] = enabled ?? !this.config[key];
    }
  }
}

// ============================================================
// 🌐 Экспорт
// ============================================================

window.CVProcessor = CVProcessor;

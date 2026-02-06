/**
 * ============================================================
 * ⚙️ Конфигурация клиентского приложения
 * ============================================================
 * 
 * Все настройки в одном месте для удобной отладки.
 * 
 * ============================================================
 */

window.AppConfig = {
  // === Сетевые настройки ===
  
  // Адрес ESP32 (по умолчанию — текущий хост)
  // Для локальной отладки можно указать IP: "http://192.168.1.100"
  ESP32_HOST: location.hostname,
  
  // Адрес источника видеопотока (по умолчанию = ESP32_HOST)
  // Может быть любым источником, например: "192.168.1.101" или "camera.local"
  VIDEO_HOST: null,  // null = использовать ESP32_HOST
  
  // Порт основного HTTP сервера
  HTTP_PORT: location.port || 80,
  
  // Порт стрима
  STREAM_PORT: 81,
  
  // Путь к стриму (для IP Webcam и т.д.)
  // ESP32: "/stream", IP Webcam Android: "/video", "/videofeed" и т.д.
  STREAM_PATH: '/stream',
  
  // === MJPEG Proxy (обход CORS) ===
  // Для источников без CORS (IP Webcam, внешние камеры)
  // Работает только через dev-server!
  
  USE_PROXY: true,  // true = проксировать через dev-server
  
  // Полный URL внешнего стрима (для proxy)
  // Пример: "http://192.168.1.50:8080/video"
  EXTERNAL_STREAM_URL: "http://192.168.31.196:8080",
  
  // === API Endpoints ===
  
  // Основной API управления
  CONTROL_API: '/api/control',
  
  // Отладочный API моторов
  DRIVE_API: '/api/drive',
  
  // API камеры
  PHOTO_API: '/photo',
  LED_API: '/led',
  
  // === Управление ===
  
  // ControlService настройки
  CONTROL: {
    tickIntervalMs: 100,      // Интервал sync tick (мс)
    throttleMs: 1000,         // Throttle: heartbeat раз в 1 сек
    deadzone: 20,             // Мёртвая зона для X/Y
    maxValue: 255,            // Максимальное значение X/Y
    expo: 0,                  // Expo кривая: -1..+1 (0 = линейная)
  },
  
  // === Джойстики ===
  
  JOYSTICK: {
    // Размеры (будут пересчитаны динамически)
    defaultRadius: 120,       // Размер по умолчанию (px)
    stickSize: 50,            // Размер ручки (px)
  },
  
  // === UI ===
  
  UI: {
    reconnectDelay: 3000,     // Задержка переподключения стрима (мс)
    errorDisplayTime: 3000,   // Время показа ошибки (мс)
  },
  
  // === Computer Vision (OpenCV.js) ===
  
  CV: {
    enabled: false,           // Включить CV обработку по умолчанию
    
    // ─────────────────────────────────────────────────────────
    // 📐 Разрешение обработки
    // ─────────────────────────────────────────────────────────
    // Меньше = быстрее, больше = точнее
    //   320x240  — быстро, для слабых устройств
    //   640x480  — баланс (рекомендуется)
    //   1280x720 — максимум точности
    processWidth: 640,
    processHeight: 480,
    processInterval: 100,     // мс между кадрами (100 = 10 FPS)
    
    // ─────────────────────────────────────────────────────────
    // 👁️ Что отображать
    // ─────────────────────────────────────────────────────────
    showHorizon: true,        // Линия горизонта
    showGrid: true,           // Перспективная сетка пола
    showWalls: true,          // Вертикальные линии (стены)
    
    // ─────────────────────────────────────────────────────────
    // 🔍 Canny edge detection
    // ─────────────────────────────────────────────────────────
    // Пороги автоматически снижаются для лучшей детекции тёмных линий
    cannyLow: 50,             // Нижний порог (min 20)
    cannyHigh: 150,           // Верхний порог (min 60)
    
    // ─────────────────────────────────────────────────────────
    // 📏 Hough line detection
    // ─────────────────────────────────────────────────────────
    // Параметры адаптируются под разрешение автоматически
    houghThreshold: 50,       // Минимум точек на линии
    houghMinLength: 50,       // Минимальная длина линии (px)
    houghMaxGap: 10,          // Максимальный разрыв (px)
    
    // ─────────────────────────────────────────────────────────
    // 📐 Углы (градусы)
    // ─────────────────────────────────────────────────────────
    horizonMaxAngle: 45,      // Макс. отклонение от горизонтали (±45°)
    wallAngleTolerance: 15,   // Допуск от вертикали для стен
    
    // ─────────────────────────────────────────────────────────
    // 🎯 Кластеризация
    // ─────────────────────────────────────────────────────────
    // Алгоритм: угол (параллельность) → d (коллинеарность) → медиана
    clusterAngleTolerance: 8, // Допуск по углу для параллельных линий
    // clusterToleranceD автоматически = 3% от диагонали
    minClusterSegments: 1,    // Минимум сегментов в кластере
    smoothFrames: 5,          // Буфер медианного фильтра (кадры)
    
    // ─────────────────────────────────────────────────────────
    // 🎨 Цвета
    // ─────────────────────────────────────────────────────────
    colors: {
      horizon: '#00FF00',     // Зелёный
      grid: 'rgba(0, 255, 255, 0.4)',  // Cyan полупрозрачный
      walls: '#FF6600'        // Оранжевый
    }
  },
  
  // === Утилиты ===
  
  /**
   * Получить полный URL стрима (с учётом proxy)
   */
  getStreamUrl() {
    // Если задан внешний URL и включён proxy
    if (this.USE_PROXY && this.EXTERNAL_STREAM_URL) {
      return `/proxy/stream?url=${encodeURIComponent(this.EXTERNAL_STREAM_URL)}`;
    }
    
    // Прямой URL
    const videoHost = this.VIDEO_HOST || this.ESP32_HOST;
    const streamPath = this.STREAM_PATH || '/stream';
    return `http://${videoHost}:${this.STREAM_PORT}${streamPath}`;
  },
  
  /**
   * Получить базовый URL API
   */
  getApiBase() {
    const port = this.HTTP_PORT === 80 ? '' : `:${this.HTTP_PORT}`;
    return `http://${this.ESP32_HOST}${port}`;
  },
  
  /**
   * Получить полный URL для API endpoint
   */
  getApiUrl(endpoint) {
    return `${this.getApiBase()}${endpoint}`;
  },
  
  // === Сохранение настроек (localStorage) ===
  
  /**
   * Сохранить текущие настройки в localStorage
   * Использование: AppConfig.save()
   */
  save() {
    const toSave = {
      ESP32_HOST: this.ESP32_HOST,
      VIDEO_HOST: this.VIDEO_HOST,
      STREAM_PORT: this.STREAM_PORT,
      STREAM_PATH: this.STREAM_PATH,
      USE_PROXY: this.USE_PROXY,
      EXTERNAL_STREAM_URL: this.EXTERNAL_STREAM_URL,
    };
    localStorage.setItem('AppConfig', JSON.stringify(toSave));
    console.log('✅ Настройки сохранены:', toSave);
  },
  
  /**
   * Загрузить настройки из localStorage
   * Вызывается автоматически при загрузке страницы
   */
  load() {
    const saved = localStorage.getItem('AppConfig');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(this, parsed);
        console.log('📦 Настройки загружены из localStorage:', parsed);
      } catch (e) {
        console.warn('⚠️ Ошибка загрузки настроек:', e);
      }
    }
  },
  
  /**
   * Сбросить к дефолтным значениям
   */
  reset() {
    localStorage.removeItem('AppConfig');
    console.log('🗑️ Настройки сброшены. Перезагрузите страницу.');
  },
};

// Автозагрузка сохранённых настроек
window.AppConfig.load();

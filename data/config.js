/**
 * ============================================================
 * ⚙️ Дефолтные значения конфигурации
 * ============================================================
 *
 * Чистый объект данных — без логики, без save/load.
 * Используется как источник начальных значений для AppState (state.js).
 *
 * ============================================================
 */

window.AppDefaults = {

  // ═══════════════════════════════════════════════════════════
  // 🌐 Сетевые настройки
  // ═══════════════════════════════════════════════════════════

  // Адрес ESP32 (по умолчанию — текущий хост)
  ESP32_HOST: location.hostname,

  // Адрес источника видеопотока (null = ESP32_HOST)
  VIDEO_HOST: null,

  // Порт основного HTTP сервера
  HTTP_PORT: location.port || 80,

  // Порт стрима
  STREAM_PORT: 81,

  // Путь к стриму (ESP32: "/stream", IP Webcam: "/video" и т.д.)
  STREAM_PATH: '/stream',

  // MJPEG Proxy (обход CORS, только через dev-server)
  USE_PROXY: false,

  // Полный URL внешнего стрима (для proxy)
  EXTERNAL_STREAM_URL: null,

  // ═══════════════════════════════════════════════════════════
  // 🔗 API Endpoints
  // ═══════════════════════════════════════════════════════════

  CONTROL_API: '/api/control',
  DRIVE_API:   '/api/drive',
  SERVO_API:   '/api/servo',
  PHOTO_API:   '/photo',
  LED_API:     '/led',
  STATUS_API:  '/api/status',

  // ═══════════════════════════════════════════════════════════
  // 🎮 Control (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  tickIntervalMs: 100,        // Интервал sync tick (мс)
  throttleMs: 1000,           // Throttle: heartbeat раз в 1 сек
  deadzone: 20,               // Мёртвая зона для X/Y
  maxValue: 255,              // Максимальное значение X/Y
  expoX: 0,                   // Expo кривая руля: -100..+100 (0 = линейная)
  expoY: 0,                   // Expo кривая газа: -100..+100
  outputMinX: 0,              // Руль: мин. PWM (мёртвая зона мотора)
  outputMaxX: 255,            // Руль: макс. PWM
  outputMinY: 0,              // Газ: мин. PWM
  outputMaxY: 255,            // Газ: макс. PWM

  // ═══════════════════════════════════════════════════════════
  // 🕹️ Joystick (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  joystickDefaultRadius: 120,
  joystickStickSize: 50,
  joystickScale: 100,         // Масштаб стиков, % (25..175)
  servoPanSpeed: 80,          // Throttle отправки сервы (мс, 30..200)

  // ═══════════════════════════════════════════════════════════
  // 🔍 Motion Detection — параметры (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  motionThreshold: 25,        // Порог бинаризации (0-255)
  motionMinArea: 500,         // Мин. площадь контура для BB (px²)
  motionDilate: 2,            // Итерации dilate
  motionBlur: 5,              // Размер GaussianBlur ядра

  // POI Tracking
  poiMinFrames: 5,            // Мин. кадров устойчивости для квалификации POI
  poiMatchRadius: 30,         // Радиус сопоставления центров (px)
  poiPersistence: 5,          // Кадров удержания прицела после пропадания (fade-out)
  poiMinSize: 500,            // Мин. площадь BB для POI (px²)
  poiMaxSize: 50000,          // Макс. площадь BB для POI (px²)
  poiMaxZones: 3,             // Макс. кол-во зон POI
  poiNoiseThreshold: 30,      // Порог motionPercent для режима "шум" (%)
  poiEmaPosition: 70,         // EMA коэфф. для позиции (% старого значения, 50..90)
  poiEmaSize: 80,             // EMA коэфф. для размера (% старого значения, 50..95)

  // ═══════════════════════════════════════════════════════════
  // 🖼️ UI flags (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  baseLayer: true,            // Базовый слой (видео) виден
  motionDesaturate: false,    // CSS-десатурация видео при Motion
  motionOsd: true,            // OSD виджет Motion

  // ═══════════════════════════════════════════════════════════
  // 📦 Статический конфиг (вложенные, read-only)
  // ═══════════════════════════════════════════════════════════

  CV: {
    enabled: false,
    processWidth: 640,
    processHeight: 480,
    processInterval: 100,

    // Начальное состояние слоёв (читается в initLayers)
    showHorizon: true,
    showGrid: true,
    showWalls: true,

    // Canny
    cannyLow: 50,
    cannyHigh: 150,

    // Hough
    houghThreshold: 50,
    houghMinLength: 50,
    houghMaxGap: 10,

    // Углы
    horizonMaxAngle: 45,
    wallAngleTolerance: 15,

    // Кластеризация
    clusterAngleTolerance: 8,
    minClusterSegments: 1,
    smoothFrames: 5,

    // Цвета
    colors: {
      horizon: '#00FF00',
      grid: 'rgba(0, 255, 255, 0.4)',
      walls: '#FF6600',
    },
  },

  MOTION: {
    enabled: false,
    processWidth: 320,
    processHeight: 240,
    processInterval: 100,

    // Начальное состояние слоёв (читается в initLayers)
    showPixels: true,
    showBoxes: true,
    showContours: false,
    showDesaturate: false,
    showOSD: true,
    showPoi: true,
  },

  UI: {
    reconnectDelay: 3000,
    errorDisplayTime: 3000,
  },

  LAYERS: {
    borderActive: '#4CAF50',
    borderSolo:   '#FFC107',
    borderOff:    'rgba(255,255,255,0.15)',
  },

  OSD: {
    enabled: true,
    pollIntervalSec: 5,
  },
};

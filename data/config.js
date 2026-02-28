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
  EXTERNAL_STREAM_URL: 'http://192.168.31.135:8080/',

  // Retry стрима при обрыве
  streamMaxRetries: 5,
  streamBaseDelay: 2000,

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
  joystickMode: 'dual',        // dual | single | tank
  joystickScale: 100,          // Масштаб стиков, % (25..175)
  servoPanSpeed: 80,           // Скорость поворота сервы PAN (мс, 30..3000)

  // ═══════════════════════════════════════════════════════════
  // 🔍 Motion Detection — параметры (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  motionEnabled: false,       // Включен ли детектор движения
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
  // 👁️ Scene / CV Parameters (Flattened)
  // ═══════════════════════════════════════════════════════════

  sceneEnabled: false,        // Включен ли анализ сцены (CV)
  sceneProcessInterval: 100,  // Интервал обработки (мс)

  // Canny Edge Detection
  sceneCannyLow: 50,
  sceneCannyHigh: 150,

  // Hough Transform
  sceneHoughThreshold: 50,
  sceneHoughMinLength: 50,
  sceneHoughMaxGap: 10,

  // Фильтрация линий
  sceneHorizonMaxAngle: 45,
  sceneWallAngleTolerance: 15,

  // Кластеризация
  sceneClusterAngleTolerance: 8,
  sceneMinClusterSegments: 1,
  sceneSmoothFrames: 5,

  // ═══════════════════════════════════════════════════════════
  // 🖼️ UI flags / OSD (мутабельный, персистится)
  // ═══════════════════════════════════════════════════════════

  baseLayer: true,            // Базовый слой (видео) виден
  motionDesaturate: false,    // CSS-десатурация видео при Motion
  motionOsd: true,            // OSD виджет Motion
  osdEnabled: true,           // Глобальный OSD
  osdIntervalSec: 5,          // Интервал опроса статуса (сек)

  // ═══════════════════════════════════════════════════════════
  // 📦 Runtime-заглушки (будут переопределены в state.js)
  // ═══════════════════════════════════════════════════════════
  
  controlX: 0,
  controlY: 0,
  controlActive: false,
  controlMotors: [0, 0],
  ledState: false,
  isStreaming: false,
  isWebcamActive: false,
  
  // Цвета для Canvas (не персистятся, но нужны как константы)
  colors: {
    horizon: '#00FF00',
    grid: 'rgba(0, 255, 255, 0.4)',
    walls: '#FF6600',
    borderActive: '#4CAF50',
    borderSolo:   '#FFC107',
    borderOff:    'rgba(255,255,255,0.15)',
  }
};

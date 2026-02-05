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
  
  // === Утилиты ===
  
  /**
   * Получить полный URL стрима
   */
  getStreamUrl() {
    const videoHost = this.VIDEO_HOST || this.ESP32_HOST;
    return `http://${videoHost}:${this.STREAM_PORT}/stream`;
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
};

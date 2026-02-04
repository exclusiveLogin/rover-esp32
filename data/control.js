/**
 * ============================================================
 * 🎮 ControlService — Сервис управления движением
 * ============================================================
 * 
 * Доменный класс для управления ровером.
 * Инкапсулирует:
 *   - Состояние (x, y, lastSent, active)
 *   - Throttle/debounce логику
 *   - Sync tick (периодическая синхронизация с сервером)
 *   - Clamp/map преобразования
 *   - AbortController для switchMap паттерна
 * 
 * Использование:
 *   const control = new ControlService('/api/control');
 *   control.onStateChange = (state) => updateUI(state);
 *   control.setXY(100, -50);
 *   control.stop();
 * 
 * ============================================================
 */

class ControlService {
  // === Конфигурация ===
  static DEFAULTS = {
    apiUrl: '/api/control',
    tickIntervalMs: 100,      // Интервал sync tick (мс) — проверка состояния
    throttleMs: 1000,         // Throttle: heartbeat раз в 1 сек (меньше CONTROL_TIMEOUT_MS 2 сек)
    deadzone: 20,             // Мёртвая зона для X/Y
    maxValue: 255,            // Максимальное значение X/Y
  };

  constructor(apiUrl = ControlService.DEFAULTS.apiUrl, options = {}) {
    // Конфиг
    this.config = { ...ControlService.DEFAULTS, ...options, apiUrl };

    // === Состояние ===
    this.state = {
      // Текущие значения (от джойстика/кнопок)
      x: 0,
      y: 0,
      active: false,          // Активно ли управление (джойстик зажат)
      
      // Последние отправленные значения
      lastSentX: 0,
      lastSentY: 0,
      lastSentTime: 0,
      
      // Ответ сервера (состояние моторов)
      motors: { fl: 0, fr: 0, rl: 0, rr: 0 },
      
      // Статус
      pending: false,         // Есть ли запрос в полёте
      error: null,
    };

    // === SwitchMap ===
    this._abortController = null;
    this._requestId = 0;

    // === Tick loop ===
    this._tickTimer = null;

    // === Callbacks ===
    this.onStateChange = null;  // (state) => void
    this.onMotorsUpdate = null; // (motors) => void
    this.onError = null;        // (error) => void
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Запуск sync tick loop
   */
  start() {
    if (this._tickTimer) return;
    
    this._tickTimer = setInterval(() => this._tick(), this.config.tickIntervalMs);
    console.log('🎮 ControlService started');
  }

  /**
   * Остановка sync tick loop
   */
  stop() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    
    // Отменяем pending запрос
    this._abort();
    
    // Сбрасываем состояние
    this._updateState({ x: 0, y: 0, active: false });
    
    // Отправляем stop на сервер
    this._sendImmediate(0, 0);
    
    console.log('🎮 ControlService stopped');
  }

  /**
   * Установить X/Y (от джойстика)
   * @param {number} x - Сырое значение X
   * @param {number} y - Сырое значение Y
   */
  setXY(x, y) {
    // Clamp
    x = this._clamp(x, -this.config.maxValue, this.config.maxValue);
    y = this._clamp(y, -this.config.maxValue, this.config.maxValue);
    
    // Deadzone (применяем к каждой оси отдельно)
    if (Math.abs(x) < this.config.deadzone) x = 0;
    if (Math.abs(y) < this.config.deadzone) y = 0;

    this._updateState({ x, y, active: true });
  }

  /**
   * Установить только X (руль)
   * @param {number} x - Значение X (-255..+255)
   */
  setX(x) {
    x = this._clamp(x, -this.config.maxValue, this.config.maxValue);
    if (Math.abs(x) < this.config.deadzone) x = 0;
    
    this._updateState({ x, active: true });
  }

  /**
   * Установить только Y (газ)
   * @param {number} y - Значение Y (-255..+255)
   */
  setY(y) {
    y = this._clamp(y, -this.config.maxValue, this.config.maxValue);
    if (Math.abs(y) < this.config.deadzone) y = 0;
    
    this._updateState({ y, active: true });
  }

  /**
   * Сбросить только X (отпустили руль)
   */
  resetX() {
    this._updateState({ x: 0 });
    // Если Y тоже 0 — деактивируем
    if (this.state.y === 0) {
      this.deactivate();
    }
  }

  /**
   * Сбросить только Y (отпустили газ)
   */
  resetY() {
    this._updateState({ y: 0 });
    // Если X тоже 0 — деактивируем
    if (this.state.x === 0) {
      this.deactivate();
    }
  }

  /**
   * Активировать управление (джойстик зажат)
   */
  activate() {
    this._updateState({ active: true });
  }

  /**
   * Деактивировать управление (все джойстики отпущены)
   * Автоматически отправляет stop
   */
  deactivate() {
    this._updateState({ x: 0, y: 0, active: false });
    this._sendImmediate(0, 0);
  }

  /**
   * Экстренная остановка
   */
  emergencyStop() {
    this._abort();
    this._updateState({ x: 0, y: 0, active: false, lastSentX: 0, lastSentY: 0 });
    this._sendImmediate(0, 0);
  }

  /**
   * Получить текущее состояние (readonly копия)
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Проверить нужна ли синхронизация
   */
  needsSync() {
    const { x, y, lastSentX, lastSentY, lastSentTime, active } = this.state;
    
    // Если не активен — синхронизация не нужна
    if (!active) return false;
    
    // Если значения изменились — нужна
    if (x !== lastSentX || y !== lastSentY) return true;
    
    // Если прошло достаточно времени (throttle для watchdog) — нужна
    const elapsed = Date.now() - lastSentTime;
    return elapsed >= this.config.throttleMs;
  }

  // ============================================================
  // Private: State Management
  // ============================================================

  _updateState(patch) {
    const oldState = { ...this.state };
    Object.assign(this.state, patch);
    
    // Уведомляем подписчика
    if (this.onStateChange) {
      this.onStateChange(this.state, oldState);
    }
  }

  // ============================================================
  // Private: Sync Tick
  // ============================================================

  _tick() {
    if (!this.needsSync()) return;
    
    this._send(this.state.x, this.state.y);
  }

  // ============================================================
  // Private: Network
  // ============================================================

  _send(x, y) {
    // SwitchMap: отменяем предыдущий
    this._abort();
    this._abortController = new AbortController();
    
    const thisRequestId = ++this._requestId;
    
    // Обновляем lastSent ДО запроса
    this._updateState({
      lastSentX: x,
      lastSentY: y,
      lastSentTime: Date.now(),
      pending: true,
      error: null,
    });

    fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'xy', x, y }),
      signal: this._abortController.signal,
    })
      .then(r => r.json())
      .then(data => {
        // Проверка актуальности
        if (thisRequestId !== this._requestId) return;
        
        this._updateState({ pending: false });
        
        if (data.motors) {
          this._updateState({ motors: data.motors });
          if (this.onMotorsUpdate) {
            this.onMotorsUpdate(data.motors);
          }
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        
        console.error('🚨 ControlService error:', err.message);
        this._updateState({ pending: false, error: err.message });
        if (this.onError) {
          this.onError(err);
        }
      });
  }

  /**
   * Немедленная отправка (игнорирует throttle)
   */
  _sendImmediate(x, y) {
    this._send(x, y);
  }

  _abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  // ============================================================
  // Private: Utilities
  // ============================================================

  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Map значение из одного диапазона в другой
   * (пока не используется, но готово для расширения)
   */
  _map(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  }
}

// Экспорт для использования в script.js
window.ControlService = ControlService;

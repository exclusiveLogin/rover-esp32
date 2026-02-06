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
    expoX: 0,                 // Expo кривая руля (X): -1..+1 (0 = линейная)
    expoY: 0,                 // Expo кривая газа (Y): -1..+1 (0 = линейная)
  };

  constructor(apiUrl = ControlService.DEFAULTS.apiUrl, options = {}) {
    // Конфиг
    this.config = { ...ControlService.DEFAULTS, ...options, apiUrl };

    // === Состояние ===
    this.state = {
      // Текущие значения (от джойстика/кнопок) — сырые
      x: 0,
      y: 0,
      // Значения после expo — реальный сигнал
      expoX: 0,
      expoY: 0,
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
    this._updateState({ x: 0, y: 0, expoX: 0, expoY: 0, active: false });
    this._sendImmediate(0, 0);
  }

  /**
   * Экстренная остановка
   */
  emergencyStop() {
    this._abort();
    this._updateState({ x: 0, y: 0, expoX: 0, expoY: 0, active: false, lastSentX: 0, lastSentY: 0 });
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
    
    // Применяем expo кривую (раздельно для каждой оси)
    const expoX = this._applyExpo(x, this.config.expoX);
    const expoY = this._applyExpo(y, this.config.expoY);
    
    // Обновляем state (сырые + expo значения)
    this._updateState({
      expoX: expoX,
      expoY: expoY,
      lastSentX: x,
      lastSentY: y,
      lastSentTime: Date.now(),
      pending: true,
      error: null,
    });

    fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'xy', x: expoX, y: expoY }),
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
   */
  _map(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  }

  /**
   * Применить expo кривую к значению
   * 
   * Формула: output = (1 - |expo|) * input + expo * input^3
   * 
   * expo > 0: мягкий центр, резкие края (для точного управления)
   * expo < 0: резкий центр, мягкие края (для быстрого отклика)
   * expo = 0: линейная кривая
   * 
   * @param {number} value - Входное значение (-255..+255)
   * @param {number} expo - Значение expo для данной оси (-1..+1)
   * @returns {number} - Обработанное значение
   */
  _applyExpo(value, expo) {
    if (expo === 0) return value;
    
    // Нормализуем в -1..+1
    const maxVal = this.config.maxValue;
    const normalized = value / maxVal;
    
    // Применяем expo: mix линейной и кубической функций
    const absExpo = Math.abs(expo);
    const cubic = normalized * normalized * normalized;
    
    let result;
    if (expo > 0) {
      // Положительный expo: мягкий центр (кубическая доминирует)
      result = (1 - absExpo) * normalized + absExpo * cubic;
    } else {
      // Отрицательный expo: резкий центр (инверсия кубической)
      // Используем sqrt для обратного эффекта
      const sign = normalized >= 0 ? 1 : -1;
      const absNorm = Math.abs(normalized);
      const sqrtPart = sign * Math.pow(absNorm, 1/3);
      result = (1 - absExpo) * normalized + absExpo * sqrtPart;
    }
    
    // Возвращаем в исходный диапазон
    return Math.round(result * maxVal);
  }

  // ============================================================
  // Public: Settings
  // ============================================================

  /**
   * Установить expo кривую для оси
   * @param {'x'|'y'|'both'} axis - Ось
   * @param {number} expo - Значение от -1 до +1 (или -100..+100, будет нормализовано)
   */
  setExpo(axis, expo) {
    // Нормализуем если передано в процентах
    if (expo > 1 || expo < -1) {
      expo = expo / 100;
    }
    expo = this._clamp(expo, -1, 1);

    if (axis === 'x' || axis === 'both') {
      this.config.expoX = expo;
    }
    if (axis === 'y' || axis === 'both') {
      this.config.expoY = expo;
    }
    console.log(`📈 Expo ${axis.toUpperCase()} set to ${(expo * 100).toFixed(0)}%`);
  }

  /**
   * Получить текущий expo
   * @param {'x'|'y'} axis
   */
  getExpo(axis = 'x') {
    return axis === 'y' ? this.config.expoY : this.config.expoX;
  }

  /**
   * Вычислить expo для графика (статический метод)
   * @param {number} input - Нормализованный вход 0..1
   * @param {number} expo - Expo -1..+1
   * @returns {number} - Нормализованный выход 0..1
   */
  static calcExpoPoint(input, expo) {
    if (expo === 0) return input;
    
    const absExpo = Math.abs(expo);
    const cubic = input * input * input;
    
    if (expo > 0) {
      return (1 - absExpo) * input + absExpo * cubic;
    } else {
      const sqrtPart = Math.pow(input, 1/3);
      return (1 - absExpo) * input + absExpo * sqrtPart;
    }
  }
}

// Экспорт для использования в script.js
window.ControlService = ControlService;

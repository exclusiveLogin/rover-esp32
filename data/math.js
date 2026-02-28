/**
 * ============================================================
 * RoverMath — библиотека чистых математических функций
 * ============================================================
 *
 * Все функции — pure (без побочных эффектов, без обращения к DOM/state).
 * Используются в DriveMode, StickService, ExpoGraph.
 *
 * ============================================================
 */

window.RoverMath = {

  /**
   * Ограничить значение диапазоном [min, max].
   * clamp(300, 0, 255) → 255
   */
  clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  /**
   * Мёртвая зона: если |val| < deadzone — возвращаем 0.
   * Нужна чтобы мелкие дрожания стика не двигали моторы.
   *
   * @param {number} val      — входное значение (любой диапазон)
   * @param {number} deadzone — порог (абсолютное значение)
   * @returns {number} 0 если внутри зоны, иначе val как есть
   */
  applyDeadzone(val, deadzone) {
    if (Math.abs(val) < deadzone) return 0;
    return val;
  },

  /**
   * Экспо-кривая для джойстика.
   *
   * Делает стик менее чувствительным в центре (точное управление)
   * и более агрессивным на краях (полная мощность).
   *
   * Формула:  y = k·x³ + (1−k)·x
   *   где k = expo/100 (0 = линейно, 1 = чистый куб)
   *
   * Визуально (expo=50):
   *   Вход: ──────┤─────── (линейная ось стика -1..1)
   *   Выход: ─────╮─────── (S-кривая, пологая в центре)
   *
   * @param {number} val  — нормализованное значение стика (-1..1)
   * @param {number} expo — коэффициент 0..100
   * @returns {number} значение после экспо (-1..1)
   */
  applyExpo(val, expo) {
    if (expo === 0) return val;
    const k = expo / 100;
    return k * Math.pow(val, 3) + (1 - k) * val;
  },

  /**
   * Рассчитать точку на экспо-кривой (для графика ExpoGraph).
   *
   * @param {number} rawValue — сырое значение стика (в масштабе -maxVal..maxVal)
   * @param {number} expo     — экспонента 0..100
   * @param {number} maxVal   — масштаб (обычно 255)
   * @returns {number} выходное значение в том же масштабе
   */
  calcExpoPoint(rawValue, expo, maxVal = 255) {
    const norm = rawValue / maxVal;
    const res = this.applyExpo(norm, expo);
    return res * maxVal;
  },

  /**
   * Ремаппинг выхода в диапазон PWM.
   *
   * Зачем: моторы не крутятся при PWM < ~60 (зависит от мотора).
   * outputMin задаёт минимальный PWM при котором мотор трогается.
   *
   * Формула: out = min + (|val|/255) × (max − min)
   *   val=0   → 0     (стоим)
   *   val=1   → min   (начало вращения)
   *   val=255 → max   (полная мощность)
   *
   * Знак сохраняется (направление вращения).
   *
   * @param {number} val    — значение после expo (-255..255)
   * @param {number} minOut — минимальный PWM (порог страгивания)
   * @param {number} maxOut — максимальный PWM
   * @returns {number} PWM со знаком (-255..255)
   */
  remapOutput(val, minOut, maxOut) {
    if (val === 0) return 0;

    const absVal = Math.abs(val);
    const sign = Math.sign(val);
    const mapped = minOut + (absVal / 255) * (maxOut - minOut);

    return sign * this.clamp(mapped, minOut, maxOut);
  },

  /**
   * Конвертация Tank (L/R моторы) → Arcade (X/Y).
   *
   * Контроллер (ESP32) работает в Arcade-формате:
   *   Left  motor = Y + X
   *   Right motor = Y - X
   *
   * Когда на фронте танковый режим (два стика = L и R),
   * нужно обратное преобразование, чтобы контроллер
   * из нашего X/Y восстановил исходные L/R:
   *
   *   L + R = 2Y  →  Y = (L + R) / 2
   *   L − R = 2X  →  X = (L − R) / 2
   *
   * Примеры:
   *   L=255, R=255 (вперёд)       → X=0,   Y=255
   *   L=255, R=-255 (разворот CW) → X=255, Y=0
   *   L=0,   R=255 (правая назад) → X=-128, Y=128
   *
   * @param {number} left  — PWM левого мотора (-255..255)
   * @param {number} right — PWM правого мотора (-255..255)
   * @returns {{x: number, y: number}}
   */
  tankToXY(left, right) {
    const y = (left + right) / 2;
    const x = (left - right) / 2;
    return { x: Math.round(x), y: Math.round(y) };
  },

  /**
   * Троттлинг: вызывает func не чаще чем раз в limit мс.
   * Первый вызов проходит сразу, повторные игнорируются до истечения таймера.
   */
  throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }
  },

  /**
   * Debounce: вызывает func только после wait мс тишины.
   * Каждый новый вызов сбрасывает таймер.
   * Используется для поисковых полей, ресайза, сохранения настроек.
   */
  debounce(func, wait) {
    let timeout;
    return function() {
      const context = this;
      const args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

};

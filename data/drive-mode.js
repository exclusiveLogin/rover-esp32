/**
 * ============================================================
 * DriveMode — Полиморфные стратегии управления
 * ============================================================
 *
 * Паттерн «Стратегия»: три режима джойстиков с одним интерфейсом.
 * StickService вызывает strategy.compute(sticks, config) —
 * не зная, какой именно режим активен.
 *
 * Все режимы используют единый пайплайн обработки оси:
 *   raw input → deadzone → expo → remap → PWM
 *
 * ────────────────────────────────────────────────────────────
 * Режимы:
 *
 *   Dual (Arcade)  — Левый стик: газ (Y), Правый: руль (X)
 *   Single         — Один правый стик: газ (Y) + руль (X)
 *   Tank           — Левый стик Y: левая гусеница,
 *                     Правый стик Y: правая гусеница
 *
 * ────────────────────────────────────────────────────────────
 * Протокол с контроллером (ESP32):
 *
 *   Фронт всегда отправляет {x, y} в Arcade-формате.
 *   Контроллер делает микширование:
 *     Left  motor PWM = Y + X
 *     Right motor PWM = Y - X
 *
 *   В танковом режиме мы делаем обратное преобразование
 *   (L,R → X,Y), чтобы контроллер восстановил L и R.
 *
 * ============================================================
 */

(function() {
  'use strict';

  // ── Базовый класс (интерфейс) ────────────────────────────

  class DriveMode {
    /**
     * @param {Object} sticks — { left: {x, y}, right: {x, y} }, нормализованные -1..1
     * @param {Object} config — { deadzone, expoX, expoY, outputMinX, ... }
     * @returns {{x: number, y: number}} — сигналы в Arcade-формате (-255..255)
     */
    compute(sticks, config) {
      throw new Error('compute() must be implemented');
    }

    /**
     * Пайплайн обработки одной оси стика.
     *
     * Порядок:
     *   1. Deadzone — обнуляем мелкие отклонения
     *   2. Expo     — S-кривая для точности в центре
     *   3. Remap    — масштабируем в диапазон PWM (minOut..maxOut)
     *
     * @param {number} val      — сырое значение оси (-1..1)
     * @param {number} deadzone — порог мёртвой зоны (0..255, приводим к 0..1)
     * @param {number} expo     — экспонента (0..100)
     * @param {number} minOut   — минимальный PWM (порог страгивания мотора)
     * @param {number} maxOut   — максимальный PWM
     * @returns {number} итоговый PWM (-255..255)
     */
    _pipe(val, deadzone, expo, minOut, maxOut) {
      // Deadzone в конфиге — абсолютное значение PWM (0..255),
      // а вход val — нормализованный (-1..1), поэтому делим на 255
      const dzNorm = deadzone / 255;
      let v = RoverMath.applyDeadzone(val, dzNorm);

      v = RoverMath.applyExpo(v, expo);

      // v сейчас -1..1, умножаем на 255 для remapOutput
      return RoverMath.remapOutput(v * 255, minOut, maxOut);
    }
  }

  // ── Dual Mode (Arcade, два стика) ─────────────────────────

  /**
   * Классическое RC-управление:
   *   Левый стик Y → газ/тормоз
   *   Правый стик X → поворот
   */
  class DualMode extends DriveMode {
    compute(sticks, config) {
      const throttle = sticks.left.y;
      const turn = sticks.right.x;

      const y = this._pipe(throttle, config.deadzone, config.expoY, config.outputMinY, config.outputMaxY);
      const x = this._pipe(turn, config.deadzone, config.expoX, config.outputMinX, config.outputMaxX);

      return { x: Math.round(x), y: Math.round(y) };
    }
  }

  // ── Single Mode (один стик) ───────────────────────────────

  /**
   * Всё на одном правом стике:
   *   Y → газ/тормоз
   *   X → поворот
   */
  class SingleMode extends DriveMode {
    compute(sticks, config) {
      const throttle = sticks.right.y;
      const turn = sticks.right.x;

      const y = this._pipe(throttle, config.deadzone, config.expoY, config.outputMinY, config.outputMaxY);
      const x = this._pipe(turn, config.deadzone, config.expoX, config.outputMinX, config.outputMaxX);

      return { x: Math.round(x), y: Math.round(y) };
    }
  }

  // ── Tank Mode (гусеницы, два стика) ───────────────────────

  /**
   * Каждый стик управляет своей гусеницей:
   *   Левый стик Y → левая гусеница
   *   Правый стик Y → правая гусеница
   *
   * Экспо применяется к КАЖДОЙ гусенице отдельно (expoY для обоих),
   * а НЕ к осям X/Y — иначе танковое управление исказится.
   *
   * Затем L и R конвертируются обратно в Arcade (X/Y),
   * потому что контроллер ожидает Arcade-формат и сам
   * делает микширование L=Y+X, R=Y-X.
   */
  class TankMode extends DriveMode {
    compute(sticks, config) {
      const leftRaw  = sticks.left.y;
      const rightRaw = sticks.right.y;

      // Пайплайн для каждого трака отдельно (оба используют expoY)
      const left  = this._pipe(leftRaw,  config.deadzone, config.expoY, config.outputMinY, config.outputMaxY);
      const right = this._pipe(rightRaw, config.deadzone, config.expoY, config.outputMinY, config.outputMaxY);

      // Обратное преобразование: L,R → X,Y (см. RoverMath.tankToXY)
      return RoverMath.tankToXY(left, right);
    }
  }

  // ── Фабрика ───────────────────────────────────────────────

  window.DriveModeFactory = {
    create(mode) {
      switch (mode) {
        case 'single': return new SingleMode();
        case 'tank':   return new TankMode();
        case 'dual':
        default:       return new DualMode();
      }
    }
  };

})();

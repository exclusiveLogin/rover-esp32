/**
 * ============================================================
 * StickService — Сервис ввода с джойстиков
 * ============================================================
 *
 * Связывает UI-джойстики (nipplejs) с AppState.
 *
 * Поток данных:
 *   nipplejs event → move(side, x, y) → DriveMode.compute()
 *     → store.setMany({ controlX, controlY, controlActive })
 *       → ControlService (подписчик) → POST /api/control
 *
 * Ответственность:
 *   - Приём сырых данных от UI (нормализованные -1..1)
 *   - Делегация вычислений текущей стратегии (DriveMode)
 *   - Запись результата в стейт (SSOT)
 *   - Троттлинг записи (~30fps, чтобы не спамить подписчиков)
 *   - Мгновенный сброс при отпускании стика (без троттлинга)
 *
 * НЕ делает:
 *   - Сетевые запросы (это ControlService)
 *   - Отрисовку UI (это script.js / StateBinder)
 *
 * ============================================================
 */

class StickService {
  constructor(store) {
    this.store = store;

    // Текущие позиции обоих стиков (нормализованные -1..1)
    this.sticks = {
      left:  { x: 0, y: 0 },
      right: { x: 0, y: 0 }
    };

    // Текущий режим и стратегия (полиморфный DriveMode)
    this.mode = store.joystickMode || 'dual';
    this.strategy = DriveModeFactory.create(this.mode);

    // При смене режима в UI → подставляем новую стратегию
    this.store.subscribe('joystickMode', (state) => {
      if (this.mode !== state.joystickMode) {
        this.mode = state.joystickMode;
        this.strategy = DriveModeFactory.create(this.mode);
        this._recalc();
      }
    });

    // Троттлинг вычислений: ~30fps достаточно для плавного управления,
    // а 60+ — лишняя нагрузка на подписчиков стейта
    this._throttledUpdate = RoverMath.throttle(this._updateState.bind(this), 33);
  }

  /**
   * Обновить положение стика (вызывается из nipplejs callback).
   *
   * @param {'left'|'right'} side — какой стик
   * @param {number} x — горизонталь, -1..1
   * @param {number} y — вертикаль, -1..1 (вверх = +1)
   */
  move(side, x, y) {
    if (!this.sticks[side]) return;
    this.sticks[side].x = x;
    this.sticks[side].y = y;
    this._throttledUpdate();
  }

  /**
   * Стик отпущен — мгновенный сброс (без троттлинга!).
   * Важно для безопасности: моторы должны остановиться сразу.
   */
  release(side) {
    if (!this.sticks[side]) return;
    this.sticks[side].x = 0;
    this.sticks[side].y = 0;
    this._updateState();
  }

  /**
   * Пересчитать управление и записать в стейт.
   *
   * 1. strategy.compute() — deadzone → expo → remap → X/Y
   * 2. Определяем активность (есть ли ненулевой ввод)
   * 3. Записываем в store атомарно (setMany)
   */
  _updateState() {
    const config = {
      deadzone:   this.store.deadzone,
      expoX:      this.store.expoX,
      expoY:      this.store.expoY,
      outputMinX: this.store.outputMinX,
      outputMaxX: this.store.outputMaxX,
      outputMinY: this.store.outputMinY,
      outputMaxY: this.store.outputMaxY
    };

    // Вычисляем итоговые X/Y через текущую стратегию
    const result = this.strategy.compute(this.sticks, config);

    // Активность определяем по СЫРЫМ данным (до deadzone),
    // чтобы heartbeat работал даже при малых отклонениях
    const active =
      Math.abs(this.sticks.left.x)  > 0.05 || Math.abs(this.sticks.left.y)  > 0.05 ||
      Math.abs(this.sticks.right.x) > 0.05 || Math.abs(this.sticks.right.y) > 0.05;

    // Сырые значения для графика ExpoGraph (зависят от режима)
    let rawX = 0, rawY = 0;
    if (this.mode === 'single') {
      rawX = this.sticks.right.x;
      rawY = this.sticks.right.y;
    } else if (this.mode === 'tank') {
      // В танке «X» графика = правый стик, «Y» = левый
      rawY = this.sticks.left.y;
      rawX = this.sticks.right.y;
    } else {
      rawY = this.sticks.left.y;
      rawX = this.sticks.right.x;
    }

    // Атомарная запись — все подписчики получат согласованный набор
    this.store.setMany({
      controlX:      result.x,
      controlY:      result.y,
      rawControlX:   rawX,
      rawControlY:   rawY,
      controlActive: active
    });
  }

  _recalc() {
    this._updateState();
  }
}

window.StickService = StickService;

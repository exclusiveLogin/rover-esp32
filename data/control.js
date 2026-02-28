/**
 * ============================================================
 * ControlService — Сетевой транспорт управления моторами
 * ============================================================
 *
 * Реактивный сервис: подписан на AppState (controlX, controlY, controlActive).
 * Когда StickService пишет в стейт — ControlService отправляет данные на ESP32.
 *
 * Ключевые механизмы:
 *
 * 1. Throttle — не чаще 50мс между отправками (защита от спама)
 * 2. Heartbeat — пока стик зажат, повторяем текущие значения каждые 1.5с,
 *    чтобы MCU watchdog не остановил моторы по таймауту
 * 3. Exponential backoff — при серии сетевых ошибок увеличиваем паузу
 *    между попытками: 2с → 4с → 8с → max 16с
 * 4. Stop-команда — при отпускании стика сразу отправляем x=0, y=0
 *
 * Протокол:
 *   POST /api/control
 *   Body: x=<-255..255>&y=<-255..255>
 *
 * ============================================================
 */

class ControlService {
  constructor(store) {
    this.store = store;

    this.lastSent          = 0;     // timestamp последней отправки
    this.hbTimer           = null;  // ID интервала heartbeat
    this.pending           = false; // true пока ждём ответ от сервера (защита от параллельных запросов)
    this.consecutiveErrors = 0;     // счётчик подряд идущих ошибок (для backoff)
    this._wasActive        = false; // предыдущее состояние стика (для detect press/release)

    // Подписка на изменения управления в стейте
    this.store.subscribe(['controlX', 'controlY', 'controlActive'], () => this._onStateChange());
  }

  // ── Реакция на стейт ──────────────────────────────────────

  /**
   * Единственная точка входа для отправки.
   * Вызывается при любом изменении controlX/controlY/controlActive.
   */
  _onStateChange() {
    const active = this.store.controlActive;

    // Стик нажат (было неактивно → стало активно): запускаем heartbeat
    if (active && !this._wasActive) {
      this._startHeartbeat();
    }

    // Стик отпущен (было активно → стало неактивно): стоп-команда
    if (!active && this._wasActive) {
      this._stopHeartbeat();
      this._sendNow(0, 0);     // Немедленная остановка моторов
      this._wasActive = false;
      return;
    }

    this._wasActive = active;

    // Стик активен — отправляем с троттлингом
    if (active) {
      this._throttledSend();
    }
  }

  // ── Throttle + Backoff ────────────────────────────────────

  /**
   * Отправка с учётом минимального интервала и backoff при ошибках.
   *
   * Нормальный режим: не чаще 50мс между запросами.
   * При ошибках (>3 подряд): backoff 2с → 4с → 8с → 16с.
   */
  _throttledSend() {
    if (this.pending) return; // уже ждём ответ
    const now = Date.now();
    const minInterval = 50;

    // Backoff при серии ошибок
    if (this.consecutiveErrors > 3) {
      const backoff = Math.min(2000 * Math.pow(2, this.consecutiveErrors - 3), 16000);
      if (now - this.lastSent < backoff) return;
    } else if (now - this.lastSent < minInterval) {
      return;
    }

    this._sendNow(this.store.controlX || 0, this.store.controlY || 0);
  }

  // ── Heartbeat ─────────────────────────────────────────────

  /**
   * Heartbeat: пока стик зажат — повторяем текущие X/Y каждые 1.5с.
   *
   * Зачем: ESP32 имеет watchdog — если не получает команд N секунд,
   * останавливает моторы (безопасность). Heartbeat не даёт watchdog
   * сработать, пока пользователь держит стик.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (!this.store.controlActive || this.pending) return;
      this._sendNow(this.store.controlX || 0, this.store.controlY || 0);
    }, 1500);
  }

  _stopHeartbeat() {
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
  }

  // ── HTTP отправка ─────────────────────────────────────────

  /**
   * Немедленная отправка POST /api/control с x и y.
   *
   * При успехе: сбрасываем счётчик ошибок, обновляем isOnline.
   * При ошибке: инкрементим consecutiveErrors,
   *   после 3+ ошибок — ставим controlError и isOnline=false.
   *   lastSent обновляется в обоих случаях — чтобы backoff работал.
   */
  async _sendNow(x, y) {
    this.pending = true;
    const apiUrl = this.store.getApiUrl ?
                   this.store.getApiUrl(window.AppDefaults.CONTROL_API) :
                   '/api/control';

    const payload = new URLSearchParams();
    payload.append('x', Math.round(x));
    payload.append('y', Math.round(y));

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        body: payload,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      this.lastSent = Date.now();
      this.consecutiveErrors = 0;
      this.store.setMany({
        controlError: false,
        isOnline: true
      });

    } catch (e) {
      // Обновляем lastSent и при ошибке — иначе backoff не работает
      this.lastSent = Date.now();
      this.consecutiveErrors++;

      if (this.consecutiveErrors > 3) {
        this.store.setMany({
          controlError: true,
          isOnline: false
        });
      }
    } finally {
      this.pending = false;
    }
  }
}

window.ControlService = ControlService;

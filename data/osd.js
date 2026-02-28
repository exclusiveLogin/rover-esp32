/**
 * ============================================================
 * OSDController — Экранная телеметрия (On-Screen Display)
 * ============================================================
 *
 * Опрашивает ESP32 по GET /api/status с настраиваемым интервалом
 * и обновляет виджеты в UI: RSSI, Heap, Uptime, IP, CPU, моторы и т.д.
 *
 * Два набора виджетов:
 *   1. OSD overlay (поверх видео) — RSSI, Heap, Uptime, Drive
 *   2. Info panel (боковая панель) — IP, RSSI, Uptime, Heap, CPU, Clients
 *
 * Конфиг (из AppState):
 *   osdEnabled    — показывать/скрывать OSD overlay
 *   osdIntervalSec — интервал поллинга в секундах
 *
 * ============================================================
 */

class OSDController {
  /**
   * @param {Object} store      — AppState (SSOT)
   * @param {Object} elementMap — Map DOM-элементов:
   *   { rssiVal, heapVal, uptimeVal, driveVal, overlay,
   *     ipVal, psramVal, cpuVal, clientsVal, ledVal,
   *     motorFL, motorFR, motorRL, motorRR,
   *     infoIp, infoRssi, infoUptime, infoHeap, infoCpu, infoClients }
   */
  constructor(store, elementMap) {
    this.store = store;
    this.els = elementMap;
    this.timer = null;
    this.lastData = null;

    // Реагируем на включение/выключение OSD и смену интервала
    this.store.subscribe(['osdEnabled', 'osdIntervalSec'], () => this.checkState());

    this.checkState();
  }

  /**
   * Запустить или остановить поллинг в зависимости от конфига.
   */
  checkState() {
    const enabled = this.store.osdEnabled;
    const interval = (this.store.osdIntervalSec || 5) * 1000;

    // Видимость OSD overlay
    if (this.els.overlay) {
      if (enabled) this.els.overlay.classList.remove('hidden');
      else this.els.overlay.classList.add('hidden');
    }

    if (interval > 0) {
      this.startPolling(interval);
    } else {
      this.stopPolling();
    }
  }

  startPolling(interval) {
    this.stopPolling();
    this.fetchStatus();  // Первый запрос сразу, не ждём интервал
    this.timer = setInterval(() => this.fetchStatus(), interval);
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Запросить статус с ESP32 и обновить виджеты.
   * При ошибке — ставим прочерк в RSSI (индикатор потери связи).
   */
  async fetchStatus() {
    try {
      const endpoint = this.store.STATUS_API || '/api/status';
      const url = this.store.getApiUrl ? this.store.getApiUrl(endpoint) : endpoint;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Status error');
      const data = await res.json();
      this.render(data);
    } catch (e) {
      if (this.els.rssiVal) this.els.rssiVal.textContent = '-';
    }
  }

  /**
   * Обновить все DOM-виджеты из полученных данных.
   *
   * Данные от ESP32 (примерная структура):
   *   { rssi, heap, uptime, ip, psram, cpu, clients, led,
   *     motors: { fl, fr, rl, rr } }
   */
  render(data) {
    this.lastData = data;

    // ── OSD Widgets (поверх видео) ──

    // RSSI: цветовая индикация качества WiFi
    if (this.els.rssiVal && data.rssi !== undefined) {
      const rssi = data.rssi;
      this.els.rssiVal.textContent = rssi + ' dBm';
      this.els.rssiVal.classList.remove('osd-rssi-good', 'osd-rssi-mid', 'osd-rssi-bad');
      if (rssi > -65) this.els.rssiVal.classList.add('osd-rssi-good');       // Отлично
      else if (rssi > -75) this.els.rssiVal.classList.add('osd-rssi-mid');   // Средне
      else this.els.rssiVal.classList.add('osd-rssi-bad');                   // Плохо
    }

    // Heap: свободная RAM, предупреждение при <50 КБ
    if (this.els.heapVal && data.heap !== undefined) {
      const heapKb = Math.round(data.heap / 1024);
      this.els.heapVal.textContent = heapKb + ' KB';
      this.els.heapVal.classList.remove('osd-heap-low');
      if (heapKb < 50) this.els.heapVal.classList.add('osd-heap-low');
    }

    // Uptime: время работы ESP32
    if (this.els.uptimeVal && data.uptime !== undefined) {
      this.els.uptimeVal.textContent = this.formatUptime(data.uptime);
    }

    if (this.els.ipVal && data.ip) this.els.ipVal.textContent = data.ip;
    if (this.els.psramVal && data.psram !== undefined) {
      this.els.psramVal.textContent = Math.round(data.psram / 1024) + ' KB';
    }
    if (this.els.cpuVal && data.cpu !== undefined) this.els.cpuVal.textContent = data.cpu;
    if (this.els.clientsVal && data.clients !== undefined) this.els.clientsVal.textContent = data.clients;
    if (this.els.ledVal && data.led !== undefined) this.els.ledVal.textContent = data.led ? 'ON' : 'OFF';

    // Моторы (PWM значения по каналам)
    if (data.motors) {
      if (this.els.motorFL) this.els.motorFL.textContent = data.motors.fl || 0;
      if (this.els.motorFR) this.els.motorFR.textContent = data.motors.fr || 0;
      if (this.els.motorRL) this.els.motorRL.textContent = data.motors.rl || 0;
      if (this.els.motorRR) this.els.motorRR.textContent = data.motors.rr || 0;
    }

    // ── Info Panel (боковая панель с доп. данными) ──
    if (this.els.infoIp && data.ip) this.els.infoIp.textContent = data.ip;
    if (this.els.infoRssi && data.rssi !== undefined) this.els.infoRssi.textContent = data.rssi;
    if (this.els.infoUptime && data.uptime !== undefined) this.els.infoUptime.textContent = this.formatUptime(data.uptime);
    if (this.els.infoHeap && data.heap !== undefined) this.els.infoHeap.textContent = Math.round(data.heap / 1024) + ' KB';
    if (this.els.infoCpu && data.cpu !== undefined) this.els.infoCpu.textContent = data.cpu + ' MHz';
    if (this.els.infoClients && data.clients !== undefined) this.els.infoClients.textContent = data.clients;
  }

  /**
   * Форматирование uptime из миллисекунд в человекочитаемый вид.
   * 3600000 → "1h 0m", 90000 → "1m 30s"
   */
  formatUptime(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const mm = m % 60;

    if (h > 0) return `${h}h ${mm}m`;
    return `${mm}m ${s}s`;
  }
}

window.OSDController = OSDController;

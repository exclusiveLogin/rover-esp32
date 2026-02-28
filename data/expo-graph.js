/**
 * ============================================================
 * ExpoGraph — Визуализация кривых экспоненты на Canvas
 * ============================================================
 *
 * Рисует две кривые (X — оранжевая, Y — зелёная) и точки
 * текущего положения стиков на этих кривых.
 *
 * Подписан на AppState: expoX, expoY, rawControlX, rawControlY.
 * Перерисовка через requestAnimationFrame (не чаще 60fps).
 *
 * Система координат Canvas:
 *   Центр (cx, cy) = середина canvas
 *   X: влево = -1, вправо = +1
 *   Y: вверх = +1, вниз = -1 (инвертирован, т.к. canvas Y растёт вниз)
 *
 * ============================================================
 */

class ExpoGraph {
  constructor(canvasId, store) {
    this.canvas = document.getElementById(canvasId);
    this.store = store;

    if (!this.canvas) {
      console.warn('ExpoGraph: Canvas not found:', canvasId);
      return;
    }

    this.ctx = this.canvas.getContext('2d');

    // Перерисовка при изменении экспо-кривых или положения стика
    this.store.subscribe(['expoX', 'expoY', 'rawControlX', 'rawControlY'], () => {
      window.requestAnimationFrame(() => this.draw());
    });

    // Адаптация при ресайзе окна
    window.addEventListener('resize', () => {
       window.requestAnimationFrame(() => this.resize());
    });

    this.resize();
  }

  /**
   * Синхронизировать размер canvas-буфера с CSS-размером элемента.
   * Без этого canvas растянется/сожмётся и будет мыльным.
   */
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.draw();
  }

  /**
   * Полная перерисовка: оси, сетка, кривые, точки.
   */
  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;            // Центр по X
    const cy = h / 2;            // Центр по Y
    const pad = 10;              // Отступ от краёв
    const plotW = w - pad * 2;   // Область графика
    const plotH = h - pad * 2;
    const scaleX = plotW / 2;    // Пикселей на единицу (-1..1 → 0..plotW)
    const scaleY = plotH / 2;

    ctx.clearRect(0, 0, w, h);

    // ── Оси ──
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, cy); ctx.lineTo(w - pad, cy);  // горизонтальная
    ctx.moveTo(cx, pad); ctx.lineTo(cx, h - pad);  // вертикальная
    ctx.stroke();

    // ── Рамка ──
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeRect(pad, pad, plotW, plotH);

    // ── Кривая X (руль, оранжевая) ──
    this.drawCurve(this.store.expoX, '#FF6A00', cx, cy, scaleX, scaleY);

    // ── Кривая Y (газ, зелёная) ──
    this.drawCurve(this.store.expoY, '#00C853', cx, cy, scaleX, scaleY);

    // ── Точка X (текущее положение стика на кривой) ──
    const rawX = this.store.rawControlX || 0;
    const valX = RoverMath.applyExpo(rawX, this.store.expoX);
    this.drawPoint(rawX, valX, '#FF6A00', cx, cy, scaleX, scaleY);

    // ── Точка Y ──
    const rawY = this.store.rawControlY || 0;
    const valY = RoverMath.applyExpo(rawY, this.store.expoY);
    this.drawPoint(rawY, valY, '#00C853', cx, cy, scaleX, scaleY);
  }

  /**
   * Нарисовать S-кривую экспо от -1 до +1 (40 сегментов).
   *
   * Для каждой точки:
   *   px = cx + input * scaleX     (горизонталь: вход)
   *   py = cy - output * scaleY    (вертикаль: выход, минус т.к. canvas Y вниз)
   */
  drawCurve(expo, color, cx, cy, scaleX, scaleY) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = -20; i <= 20; i++) {
      const x = i / 20;                         // вход: -1..1
      const y = RoverMath.applyExpo(x, expo);   // выход после экспо
      const px = cx + x * scaleX;
      const py = cy - y * scaleY;

      if (i === -20) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /**
   * Нарисовать точку текущего положения стика на кривой.
   * inVal = сырое значение стика, outVal = после экспо.
   */
  drawPoint(inVal, outVal, color, cx, cy, scaleX, scaleY) {
    const ctx = this.ctx;
    const px = cx + inVal * scaleX;
    const py = cy - outVal * scaleY;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    // Свечение вокруг точки
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

window.ExpoGraph = ExpoGraph;

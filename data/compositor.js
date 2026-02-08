/**
 * ============================================================
 * 🎬 Compositor — Единый RAF-композитор слоёв
 * ============================================================
 *
 * Один requestAnimationFrame, один overlay canvas.
 * Итерирует массив layers (SSOT), для каждого enabled слоя
 * вызывает processor.getLayer(localIndex) и рисует на canvas.
 *
 * Процессоры не держат свой RAF: предоставляют tick(now)
 * и getLayer(localIndex).
 *
 * Использование:
 *   const compositor = new Compositor(canvasEl, appState);
 *   compositor.start();
 *   compositor.stop();
 *
 * ============================================================
 */

class Compositor {

  /**
   * @param {HTMLCanvasElement} canvas - единый overlay canvas (#compositor-overlay)
   * @param {Object} appState - ссылка на AppState { processors, layers }
   */
  constructor(canvas, appState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = appState;

    this._running = false;
    this._animationId = null;
  }

  // ════════════════════════════════════════════════════════════
  // 🎬 Управление
  // ════════════════════════════════════════════════════════════

  /** Запуск RAF цикла */
  start() {
    if (this._running) return;
    this._running = true;
    this._loop();
    console.log('🎬 Compositor: Started');
  }

  /** Остановка RAF цикла */
  stop() {
    this._running = false;
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    this._clear();
    console.log('🎬 Compositor: Stopped');
  }

  /** Проверка состояния */
  isRunning() {
    return this._running;
  }

  // ════════════════════════════════════════════════════════════
  // 🔄 RAF цикл
  // ════════════════════════════════════════════════════════════

  /** Основной цикл: tick процессоров → композитинг слоёв */
  _loop() {
    if (!this._running) return;

    const now = performance.now();

    // 1. Синхронизация размеров canvas
    this._syncSize();

    // 2. Вызываем tick() у каждого включённого процессора
    const { processors } = this.state;
    for (const id in processors) {
      const proc = processors[id];
      if (proc.enabled && proc.instance) {
        proc.instance.tick(now);
      }
    }

    // 3. Очистка canvas
    this._clear();

    // 4. Отрисовка слоёв (порядок = порядок в массиве)
    const { layers } = this.state;
    for (let i = 0; i < layers.length; i++) {
      const entry = layers[i];
      if (!entry.enabled) continue;

      const proc = processors[entry.processorId];
      if (!proc || !proc.enabled || !proc.instance) continue;

      const layerCanvas = proc.instance.getLayer(entry.localIndex);
      if (!layerCanvas) continue;

      // drawImage масштабирует если размеры отличаются
      this.ctx.drawImage(layerCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }

    // 5. Обновление превью-плиток (маленькие canvas в панели настроек)
    this._updatePreviews();

    this._animationId = requestAnimationFrame(() => this._loop());
  }

  // ════════════════════════════════════════════════════════════
  // 📐 Утилиты
  // ════════════════════════════════════════════════════════════

  /** Синхронизация размеров canvas с видео-контейнером */
  _syncSize() {
    const video = window.getActiveVideoElement ? window.getActiveVideoElement() : null;
    if (!video) return;

    const isVideo = video.tagName === 'VIDEO';
    const srcW = isVideo ? video.videoWidth : video.naturalWidth;
    const srcH = isVideo ? video.videoHeight : video.naturalHeight;
    const displayW = video.clientWidth || srcW;
    const displayH = video.clientHeight || srcH;

    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
    }
  }

  /** Очистка canvas */
  _clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Обновление превью-плиток из getLayer() */
  _updatePreviews() {
    const { processors, layers } = this.state;

    for (let i = 0; i < layers.length; i++) {
      const entry = layers[i];
      const previewCanvas = document.getElementById(`layer-preview-${i}`);
      if (!previewCanvas) continue;

      const proc = processors[entry.processorId];
      if (!proc || !proc.enabled || !proc.instance) {
        // Процессор выключен — очищаем превью
        const pCtx = previewCanvas.getContext('2d');
        pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        continue;
      }

      const layerCanvas = proc.instance.getLayer(entry.localIndex);
      if (!layerCanvas) continue;

      const pCtx = previewCanvas.getContext('2d');
      pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      pCtx.drawImage(layerCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
    }
  }
}

// ════════════════════════════════════════════════════════════
// 🌐 Экспорт
// ════════════════════════════════════════════════════════════

window.Compositor = Compositor;

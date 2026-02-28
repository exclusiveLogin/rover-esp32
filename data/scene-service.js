/**
 * ============================================================
 * 🎬 SceneService — Агрегат визуального пайплайна
 * ============================================================
 *
 * Инкапсулирует: CVProcessor, MotionDetector, Compositor, Layers.
 * Предоставляет высокоуровневый API для script.js (pure wiring).
 *
 * API:
 *   toggleCV()        — вкл/выкл Scene Analysis
 *   toggleMotion()    — вкл/выкл Motion Detection
 *   toggleBaseLayer() — показать/скрыть базовый слой (видео)
 *   toggleWebcam()    — переключить источник на вебкамеру
 *   takePhoto()       — запросить фото с ESP
 *   toggleLayer(idx)  — вкл/выкл слой
 *   soloLayer(idx)    — соло слой
 */

class SceneService {
  constructor(store, elements) {
    this.store = store;
    this.videoFeed = elements.videoFeed;
    this.videoLocal = elements.videoLocal;
    this.overlayCanvas = elements.overlayCanvas;
    this.videoContainer = elements.videoContainer;

    this._webcamStream = null;

    window.getActiveVideoElement = () => this._getActiveVideo();

    this._initProcessors();
    this._initLayers();

    this.compositor = new Compositor(this.overlayCanvas, this.store);

    this._subscribeConfigs();
  }

  // ── Публичный API ─────────────────────────────────────

  async toggleCV() {
    const proc = this.store.processors.cv;

    if (proc.enabled) {
      if (proc.instance) proc.instance.stop();
      proc.enabled = false;
      this.store.set('sceneEnabled', false);
      this._onProcessorChanged();
      window.uiLogger?.info('Scene: выключен');
      return;
    }

    this._setBtnLoading('cv-btn', true);

    if (!proc.instance) {
      proc.instance = new CVProcessor(this._getActiveVideo(), this._cvConfig());
    }

    const ok = await proc.instance.start();
    this._setBtnLoading('cv-btn', false);

    if (ok) {
      proc.enabled = true;
      this.store.set('sceneEnabled', true);
      this._onProcessorChanged();
      window.uiLogger?.success('Scene: запущен');
    } else {
      window.uiLogger?.error('Scene: OpenCV.js не загружен');
    }
  }

  async toggleMotion() {
    const proc = this.store.processors.motion;

    if (proc.enabled) {
      if (proc.instance) proc.instance.stop();
      proc.enabled = false;
      this.store.set('motionEnabled', false);
      this._onProcessorChanged();
      window.uiLogger?.info('Motion: выключен');
      return;
    }

    this._setBtnLoading('motion-btn', true);

    if (!proc.instance) {
      proc.instance = new MotionDetector(this._getActiveVideo(), {
        ...this._motionConfig(),
        onMotion: (data) => this._onMotionData(data),
      });
    }

    const ok = await proc.instance.start();
    this._setBtnLoading('motion-btn', false);

    if (ok) {
      proc.enabled = true;
      this.store.set('motionEnabled', true);
      this._onProcessorChanged();
      window.uiLogger?.success('Motion: запущен');
    } else {
      window.uiLogger?.error('Motion: OpenCV.js не загружен');
    }
  }

  toggleBaseLayer() {
    this.store.toggle('baseLayer');
    const on = this.store.baseLayer;
    this.videoContainer?.classList.toggle('base-hidden', !on);
    document.getElementById('base-layer-btn')?.classList.toggle('active', on);
  }

  async toggleWebcam() {
    if (this._webcamStream) {
      this._webcamStream.getTracks().forEach(t => t.stop());
      this._webcamStream = null;
      this.videoLocal.srcObject = null;
      this.videoLocal.classList.remove('active');
      this.store.set('isWebcamActive', false);
      document.getElementById('webcam-btn')?.classList.remove('active');
      window.uiLogger?.info('Вебкамера отключена');
      return;
    }

    try {
      this._webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.videoLocal.srcObject = this._webcamStream;
      this.videoLocal.classList.add('active');
      this.store.set('isWebcamActive', true);
      document.getElementById('webcam-btn')?.classList.add('active');
      window.uiLogger?.success('Вебкамера подключена');
    } catch (e) {
      window.uiLogger?.error('Вебкамера: ' + e.message);
    }
  }

  /**
   * Запросить одиночный JPEG с ESP32 и отрисовать на videoFeed canvas.
   * ESP32 отдаёт image/jpeg по GET /photo.
   */
  async takePhoto() {
    try {
      const url = this.store.getApiUrl(this.store.PHOTO_API || '/photo');
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);

      // Рисуем на видео-canvas (тот же элемент, что и стрим)
      const canvas = this.videoFeed;
      const ctx = canvas.getContext('2d');

      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width  = bitmap.width;
        canvas.height = bitmap.height;
      }

      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      // Показываем canvas если был скрыт
      canvas.classList.remove('hidden');

      window.uiLogger?.success('Фото получено');
    } catch (e) {
      window.uiLogger?.error('Фото: ' + e.message);
    }
  }

  toggleLayer(idx)  { this.store.toggleLayer(idx); this._syncLayerTiles(); }
  soloLayer(idx)    { this.store.soloLayer(idx);   this._syncLayerTiles(); }

  // ── Внутренние ────────────────────────────────────────

  _getActiveVideo() {
    if (this.videoLocal && this.videoLocal.classList.contains('active')) {
      return this.videoLocal;
    }
    return this.videoFeed;
  }

  _initProcessors() {
    this.store.processors = {
      cv:     { enabled: false, instance: null },
      motion: { enabled: false, instance: null },
    };
  }

  _initLayers() {
    const CV_NAMES     = ['Gray', 'Edges', 'Lines', 'Horizon', 'Grid', 'Walls'];
    const MOTION_NAMES = ['Mask', 'Contours', 'BB', 'POI'];

    const layers = [];

    CV_NAMES.forEach((name, i) => {
      layers.push({ processorId: 'cv', localIndex: i, enabled: i >= 3, name });
    });

    MOTION_NAMES.forEach((name, i) => {
      layers.push({ processorId: 'motion', localIndex: i, enabled: i !== 1, name });
    });

    this.store.layers = layers;
    this.store.applySavedLayerEnabled();
    this._syncLayerTiles();
  }

  _onProcessorChanged() {
    const procs = this.store.processors;
    const anyOn = procs.cv.enabled || procs.motion.enabled;

    if (anyOn && !this.compositor.isRunning()) this.compositor.start();
    if (!anyOn && this.compositor.isRunning())  this.compositor.stop();

    document.getElementById('cv-btn')?.classList.toggle('active', procs.cv.enabled);
    document.getElementById('motion-btn')?.classList.toggle('active', procs.motion.enabled);

    const scenePanel  = document.getElementById('scene-settings-section');
    const motionPanel = document.getElementById('motion-settings-section');
    if (scenePanel)  scenePanel.style.display  = procs.cv.enabled     ? '' : 'none';
    if (motionPanel) motionPanel.style.display  = procs.motion.enabled ? '' : 'none';
  }

  _onMotionData(data) {
    const pEl = document.getElementById('osd-motion-percent');
    const rEl = document.getElementById('osd-motion-regions');
    const wEl = document.getElementById('osd-motion-widget');
    if (pEl) pEl.textContent = (data.motionPercent || 0).toFixed(1) + '%';
    if (rEl) rEl.textContent = data.regions ? data.regions.length : 0;
    if (wEl) wEl.style.display = this.store.processors.motion.enabled ? '' : 'none';
  }

  _syncLayerTiles() {
    this.store.layers.forEach((layer, i) => {
      const tile = document.querySelector(`.layer-tile[data-layer-idx="${i}"]`);
      if (!tile) return;
      tile.classList.toggle('active', layer.enabled);
      tile.classList.toggle('off', !layer.enabled);
    });
  }

  _setBtnLoading(id, on) {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('loading', on);
  }

  // ── Config Sync (State -> Processor) ──────────────────

  _subscribeConfigs() {
    const CV_KEYS = [
      'sceneCannyLow', 'sceneCannyHigh',
      'sceneHoughThreshold', 'sceneHoughMinLength', 'sceneHoughMaxGap',
      'sceneHorizonMaxAngle', 'sceneWallAngleTolerance',
      'sceneSmoothFrames', 'sceneProcessInterval',
    ];

    const MOTION_KEYS = [
      'motionThreshold', 'motionMinArea', 'motionDilate', 'motionBlur',
      'poiMinFrames', 'poiMatchRadius', 'poiPersistence',
      'poiMinSize', 'poiMaxSize', 'poiMaxZones',
      'poiNoiseThreshold', 'poiEmaPosition', 'poiEmaSize',
    ];

    this.store.subscribe(CV_KEYS, () => {
      const inst = this.store.processors.cv?.instance;
      if (inst) {
        if (inst.updateConfig) inst.updateConfig(this._cvConfig());
        else Object.assign(inst.config, this._cvConfig());
      }
    });

    this.store.subscribe(MOTION_KEYS, () => {
      const inst = this.store.processors.motion?.instance;
      if (inst) Object.assign(inst.config, this._motionConfig());
    });
  }

  _cvConfig() {
    const s = this.store;
    return {
      cannyLow: s.sceneCannyLow,
      cannyHigh: s.sceneCannyHigh,
      houghThreshold: s.sceneHoughThreshold,
      houghMinLength: s.sceneHoughMinLength,
      houghMaxGap: s.sceneHoughMaxGap,
      horizonMaxAngle: s.sceneHorizonMaxAngle,
      wallAngleTolerance: s.sceneWallAngleTolerance,
      clusterAngleTolerance: s.sceneClusterAngleTolerance,
      minClusterSegments: s.sceneMinClusterSegments,
      smoothFrames: s.sceneSmoothFrames,
      processInterval: s.sceneProcessInterval,
      colors: s.colors || window.AppDefaults.colors,
    };
  }

  _motionConfig() {
    const s = this.store;
    return {
      threshold: s.motionThreshold,
      minContourArea: s.motionMinArea,
      dilateIterations: s.motionDilate,
      blurSize: s.motionBlur,
      poiMinFrames: s.poiMinFrames,
      poiMatchRadius: s.poiMatchRadius,
      poiPersistence: s.poiPersistence,
      poiMinSize: s.poiMinSize,
      poiMaxSize: s.poiMaxSize,
      poiMaxZones: s.poiMaxZones,
      poiNoiseThreshold: s.poiNoiseThreshold,
      poiEmaPosition: s.poiEmaPosition,
      poiEmaSize: s.poiEmaSize,
    };
  }
}

window.SceneService = SceneService;

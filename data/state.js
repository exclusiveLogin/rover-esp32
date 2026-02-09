/**
 * ============================================================
 * 🧩 AppState — единый Store (SSOT)
 * ============================================================
 *
 * Копирует дефолты из AppDefaults (config.js), добавляет:
 *   - Pub/Sub:     subscribe(fn), _notify()
 *   - Мутации:     set(key, value), toggleLayer(idx), soloLayer(idx)
 *   - Утилиты:     getStreamUrl(), getApiBase(), getApiUrl()
 *   - Persistence: save(), load(), reset(), hasUnsavedChanges()
 *
 * Все мутации — только через методы. Подписчики уведомляются автоматически.
 *
 * ============================================================
 */

(function () {
  'use strict';

  // ── Ключи, которые персистятся в localStorage ────────────
  const PERSIST_KEYS = [
    // Сетевые
    'ESP32_HOST', 'VIDEO_HOST', 'STREAM_PORT', 'STREAM_PATH',
    'USE_PROXY', 'EXTERNAL_STREAM_URL',
    // Control
    'expoX', 'expoY',
    'outputMinX', 'outputMaxX', 'outputMinY', 'outputMaxY',
    'deadzone', 'joystickScale',
    // Motion params
    'motionThreshold', 'motionMinArea', 'motionDilate', 'motionBlur',
    // POI params
    'poiMinFrames', 'poiMatchRadius', 'poiPersistence', 'poiMinSize', 'poiMaxSize', 'poiMaxZones', 'poiNoiseThreshold',
    'poiEmaPosition', 'poiEmaSize',
    // UI flags
    'baseLayer', 'motionDesaturate', 'motionOsd',
  ];

  const LS_KEY = 'AppState';

  // ── Создаём стор из дефолтов ─────────────────────────────
  const store = Object.assign({}, window.AppDefaults, {

    // ── Runtime (заполняется в script.js) ────────────────
    processors: null,
    layers: [],

    // ── Pub/Sub ──────────────────────────────────────────
    _subs: [],

    subscribe(fn) {
      this._subs.push(fn);
    },

    _notify() {
      for (let i = 0; i < this._subs.length; i++) {
        this._subs[i]();
      }
    },

    // ── Мутации (единственный способ менять стейт) ───────
    /** Установить свойство стейта и уведомить подписчиков */
    set(key, value) {
      if (this[key] === value) return;
      this[key] = value;
      this._notify();
    },

    /** Toggle видимости слоя */
    toggleLayer(idx) {
      if (idx < 0 || idx >= this.layers.length) return;
      this.layers[idx].enabled = !this.layers[idx].enabled;
      this._notify();
    },

    /** Solo — включить один слой, выключить остальные */
    soloLayer(idx) {
      this.layers.forEach(function (l) { l.enabled = false; });
      if (idx >= 0 && idx < this.layers.length) this.layers[idx].enabled = true;
      this._notify();
    },

    // ── Утилиты ──────────────────────────────────────────

    /** Полный URL стрима (с учётом proxy) */
    getStreamUrl() {
      if (this.USE_PROXY && this.EXTERNAL_STREAM_URL) {
        return '/proxy/stream?url=' + encodeURIComponent(this.EXTERNAL_STREAM_URL);
      }
      var videoHost = this.VIDEO_HOST || this.ESP32_HOST;
      var streamPath = this.STREAM_PATH || '/stream';
      return 'http://' + videoHost + ':' + this.STREAM_PORT + streamPath;
    },

    /** Базовый URL API */
    getApiBase() {
      var port = this.HTTP_PORT === 80 ? '' : ':' + this.HTTP_PORT;
      return 'http://' + this.ESP32_HOST + port;
    },

    /** Полный URL для API endpoint */
    getApiUrl(endpoint) {
      return this.getApiBase() + endpoint;
    },

    // ── Persistence ──────────────────────────────────────

    /** Сохранить мутабельный стейт в localStorage */
    save() {
      var data = {};
      for (var i = 0; i < PERSIST_KEYS.length; i++) {
        data[PERSIST_KEYS[i]] = this[PERSIST_KEYS[i]];
      }
      // Слои — отдельный массив enabled-флагов
      data._layerEnabled = this.layers.map(function (l) { return l.enabled; });
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      console.log('✅ Настройки сохранены');
    },

    /** Загрузить из localStorage (мержит поверх дефолтов) */
    load() {
      var raw = localStorage.getItem(LS_KEY);
      // Обратная совместимость: старый формат AppConfig
      if (!raw) raw = localStorage.getItem('AppConfig');
      if (!raw) return;
      try {
        var data = JSON.parse(raw);
        // Плоские ключи
        for (var i = 0; i < PERSIST_KEYS.length; i++) {
          var k = PERSIST_KEYS[i];
          if (data[k] !== undefined) this[k] = data[k];
        }
        // Обратная совместимость: старый вложенный формат CONTROL/JOYSTICK
        if (data.CONTROL && typeof data.CONTROL === 'object') {
          var c = data.CONTROL;
          if (c.expoX !== undefined) this.expoX = c.expoX;
          if (c.expoY !== undefined) this.expoY = c.expoY;
          if (c.outputMinX !== undefined) this.outputMinX = c.outputMinX;
          if (c.outputMaxX !== undefined) this.outputMaxX = c.outputMaxX;
          if (c.outputMinY !== undefined) this.outputMinY = c.outputMinY;
          if (c.outputMaxY !== undefined) this.outputMaxY = c.outputMaxY;
          if (c.deadzone !== undefined) this.deadzone = c.deadzone;
        }
        if (data.JOYSTICK && typeof data.JOYSTICK === 'object') {
          if (data.JOYSTICK.scale !== undefined) this.joystickScale = data.JOYSTICK.scale;
        }
        // Обратная совместимость: COMPOSITOR
        if (data.COMPOSITOR && typeof data.COMPOSITOR === 'object') {
          var comp = data.COMPOSITOR;
          if (comp.baseLayer !== undefined) this.baseLayer = !!comp.baseLayer;
          if (comp.motionDesaturate !== undefined) this.motionDesaturate = !!comp.motionDesaturate;
          if (comp.motionOsd !== undefined) this.motionOsd = !!comp.motionOsd;
          if (comp.layerEnabled) this._savedLayerEnabled = comp.layerEnabled;
        }
        // Новый формат: _layerEnabled
        if (data._layerEnabled && Array.isArray(data._layerEnabled)) {
          this._savedLayerEnabled = data._layerEnabled;
        }
        console.log('📦 Настройки загружены из localStorage');
      } catch (e) {
        console.warn('⚠️ Ошибка загрузки настроек:', e);
      }
    },

    /** Сбросить к дефолтным значениям */
    reset() {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem('AppConfig');
      console.log('🗑️ Настройки сброшены. Перезагрузите страницу.');
    },

    /** Применить сохранённые enabled-флаги слоёв (вызывать после initLayers) */
    applySavedLayerEnabled() {
      if (!this._savedLayerEnabled || !Array.isArray(this._savedLayerEnabled)) return;
      if (this._savedLayerEnabled.length !== this.layers.length) return;
      for (var i = 0; i < this.layers.length; i++) {
        this.layers[i].enabled = !!this._savedLayerEnabled[i];
      }
      delete this._savedLayerEnabled;
      this._notify();
    },

    /** Есть ли несохранённые изменения относительно localStorage */
    hasUnsavedChanges() {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) raw = localStorage.getItem('AppConfig');
      if (!raw) return true;
      try {
        var saved = JSON.parse(raw);

        // Сравниваем плоские ключи
        for (var i = 0; i < PERSIST_KEYS.length; i++) {
          var k = PERSIST_KEYS[i];
          var savedVal = saved[k];
          // Обратная совместимость: читаем из старого вложенного формата
          if (savedVal === undefined && saved.CONTROL) savedVal = saved.CONTROL[k];
          if (savedVal === undefined && saved.JOYSTICK && k === 'joystickScale') savedVal = saved.JOYSTICK.scale;
          if (this[k] !== savedVal && savedVal !== undefined) return true;
        }

        // Сравниваем слои (только если уже проинициализированы)
        if (this.layers.length > 0) {
          var currentEnabled = this.layers.map(function (l) { return l.enabled; });
          var savedEnabled = saved._layerEnabled;
          // Обратная совместимость
          if (!savedEnabled && saved.COMPOSITOR) savedEnabled = saved.COMPOSITOR.layerEnabled;
          if (!savedEnabled) return true;
          if (currentEnabled.length !== savedEnabled.length) return true;
          for (var j = 0; j < currentEnabled.length; j++) {
            if (currentEnabled[j] !== savedEnabled[j]) return true;
          }
        }

        return false;
      } catch (e) {
        return true;
      }
    },
  });

  window.AppState = store;

  // Автозагрузка
  store.load();
})();

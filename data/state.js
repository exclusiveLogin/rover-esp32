/**
 * ============================================================
 * AppState — Единый Store (Single Source of Truth)
 * ============================================================
 *
 * Центральное хранилище всего состояния приложения.
 *
 * Инициализация:
 *   1. Копирует дефолты из AppDefaults (config.js)
 *   2. Загружает сохранённые настройки из localStorage
 *   3. Экспортирует как window.AppState
 *
 * Функциональность:
 *   - Pub/Sub:       subscribe(key, fn), set(key, val), setMany({...})
 *   - Антирекурсия:  если подписчик меняет стейт во время notify,
 *                    изменения ставятся в очередь и обрабатываются после
 *   - Персистентность: save() / load() / reset() через localStorage
 *   - Миграция:       автоматически мигрирует старый вложенный конфиг
 *                    в новый плоский формат
 *
 * Правило безопасности подписок:
 *   Подписчик НЕ должен писать в ключи, на которые подписан.
 *   Это гарантирует отсутствие бесконечной рекурсии.
 *   Пример: ControlService подписан на controlX/Y, но пишет в controlError.
 *
 * ============================================================
 */

(function () {
  'use strict';

  // ── Ключи, которые сохраняются в localStorage ─────────────
  // Остальные ключи (controlX, controlY и т.д.) — runtime-only
  const PERSIST_KEYS = [
    // Сетевые
    'ESP32_HOST', 'VIDEO_HOST', 'STREAM_PORT', 'STREAM_PATH',
    'USE_PROXY', 'EXTERNAL_STREAM_URL',
    
    // Control
    'expoX', 'expoY',
    'outputMinX', 'outputMaxX', 'outputMinY', 'outputMaxY',
    'deadzone', 'joystickScale', 'joystickMode',
    'servoPanSpeed',
    
    // Motion params
    'motionEnabled', 'motionThreshold', 'motionMinArea', 'motionDilate', 'motionBlur',
    
    // POI params
    'poiMinFrames', 'poiMatchRadius', 'poiPersistence', 
    'poiMinSize', 'poiMaxSize', 'poiMaxZones', 'poiNoiseThreshold',
    'poiEmaPosition', 'poiEmaSize',
    
    // Scene / CV params
    'sceneEnabled', 'sceneProcessInterval',
    'sceneCannyLow', 'sceneCannyHigh',
    'sceneHoughThreshold', 'sceneHoughMinLength', 'sceneHoughMaxGap',
    'sceneHorizonMaxAngle', 'sceneWallAngleTolerance',
    'sceneClusterAngleTolerance', 'sceneMinClusterSegments', 'sceneSmoothFrames',
    
    // UI / OSD flags
    'baseLayer', 'motionDesaturate', 'motionOsd',
    'osdEnabled', 'osdIntervalSec'
  ];

  const LS_KEY = 'AppState_v2';

  // ── Создаём store из дефолтов ─────────────────────────────
  const store = Object.assign({}, window.AppDefaults, {

    // Runtime state (не персистится, живёт только в сессии)
    processors: null,  // Инстансы CV/Motion процессоров
    layers: [],        // Слои для Compositor

    // ── Pub/Sub ─────────────────────────────────────────────
    _subs: new Map(),          // key → Set<callback>
    _globalSubs: new Set(),    // подписчики на ВСЕ изменения
    _isNotifying: false,       // флаг: сейчас внутри notify (защита от рекурсии)
    _pendingKeys: new Set(),   // ключи, изменённые во время notify (очередь)

    /**
     * Подписка на изменения.
     *
     * Варианты вызова:
     *   subscribe('key', fn)            — один ключ
     *   subscribe(['key1', 'key2'], fn) — несколько ключей
     *   subscribe(fn)                   — глобальная (все изменения)
     */
    subscribe(keyOrFn, fn) {
      if (typeof keyOrFn === 'function') {
        this._globalSubs.add(keyOrFn);
        return;
      }
      if (!fn) return;

      const keys = Array.isArray(keyOrFn) ? keyOrFn : [keyOrFn];
      keys.forEach(key => {
        if (!this._subs.has(key)) {
          this._subs.set(key, new Set());
        }
        this._subs.get(key).add(fn);
      });
    },

    /**
     * Отписать функцию от всех ключей.
     */
    unsubscribe(fn) {
      this._globalSubs.delete(fn);
      this._subs.forEach(set => set.delete(fn));
    },

    /**
     * Уведомить подписчиков об изменении ключей.
     *
     * Защита от рекурсии:
     *   Если подписчик вызывает set() во время notify,
     *   изменённые ключи добавляются в _pendingKeys
     *   и обрабатываются ПОСЛЕ текущего цикла notify.
     */
    _notify(changedKeys) {
      if (changedKeys.length === 0) return;

      if (this._isNotifying) {
        changedKeys.forEach(k => this._pendingKeys.add(k));
        return;
      }

      this._isNotifying = true;

      try {
        // Собираем уникальный набор подписчиков для изменённых ключей
        const listenersToCall = new Set(this._globalSubs);
        changedKeys.forEach(key => {
          const keySubs = this._subs.get(key);
          if (keySubs) keySubs.forEach(fn => listenersToCall.add(fn));
        });

        // Вызываем каждого подписчика, передавая store как аргумент
        listenersToCall.forEach(fn => {
          try {
            fn(this);
          } catch (e) {
            console.error('AppState subscriber error:', e);
          }
        });

      } finally {
        this._isNotifying = false;

        // Обработка отложенных изменений (из вызовов set() внутри подписчиков)
        if (this._pendingKeys.size > 0) {
          const nextKeys = Array.from(this._pendingKeys);
          this._pendingKeys.clear();
          this._notify(nextKeys);
        }
      }
    },

    // ── Мутации ─────────────────────────────────────────────

    /**
     * Установить одно значение.
     * Distinct: если значение не изменилось — notify не вызывается.
     */
    set(key, value) {
      if (this[key] === value) return;
      this[key] = value;
      this._notify([key]);
    },

    /**
     * Атомарное обновление нескольких ключей.
     * Подписчики вызываются ОДИН раз со списком всех изменённых ключей.
     */
    setMany(updates) {
      const changed = [];
      for (const key in updates) {
        if (this[key] !== updates[key]) {
          this[key] = updates[key];
          changed.push(key);
        }
      }
      if (changed.length > 0) {
        this._notify(changed);
      }
    },

    /** Переключить boolean-значение */
    toggle(key) {
      this.set(key, !this[key]);
    },

    // ── Управление слоями (Compositor) ──────────────────────

    toggleLayer(idx) {
      if (!this.layers[idx]) return;
      this.layers[idx].enabled = !this.layers[idx].enabled;
      this._notify(['layers']);
    },

    soloLayer(idx) {
      this.layers.forEach(l => l.enabled = false);
      if (this.layers[idx]) this.layers[idx].enabled = true;
      this._notify(['layers']);
    },

    // ── URL-билдеры ─────────────────────────────────────────

    /**
     * URL видеострима.
     * При USE_PROXY=true — через dev-server proxy (обход CORS).
     * Иначе — напрямую к ESP32/IP Webcam.
     */
    getStreamUrl() {
      if (this.USE_PROXY && this.EXTERNAL_STREAM_URL) {
        return '/proxy/stream?url=' + encodeURIComponent(this.EXTERNAL_STREAM_URL);
      }
      const videoHost = this.VIDEO_HOST || this.ESP32_HOST;
      const streamPath = this.STREAM_PATH || '/stream';
      return 'http://' + videoHost + ':' + this.STREAM_PORT + streamPath;
    },

    /** Базовый URL API: http://host[:port] */
    getApiBase() {
      const port = this.HTTP_PORT === 80 ? '' : ':' + this.HTTP_PORT;
      return 'http://' + this.ESP32_HOST + port;
    },

    /** Полный URL эндпоинта: base + endpoint */
    getApiUrl(endpoint) {
      return this.getApiBase() + endpoint;
    },

    // ── Персистентность (localStorage) ──────────────────────

    /**
     * Сохранить текущие настройки в localStorage.
     * Сохраняются только ключи из PERSIST_KEYS + состояние слоёв.
     */
    save() {
      const data = {};
      PERSIST_KEYS.forEach(k => {
        data[k] = this[k];
      });

      if (this.layers.length > 0) {
        data._layerEnabled = this.layers.map(l => l.enabled);
      }

      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
        console.log('Настройки сохранены (v2)');
        if (window.showSaveStatus) window.showSaveStatus(true);
      } catch (e) {
        console.error('Ошибка сохранения:', e);
        if (window.showSaveStatus) window.showSaveStatus(false);
      }
    },

    /**
     * Загрузить настройки из localStorage.
     * Если нет v2-формата — пробуем мигрировать со старого.
     */
    load() {
      let raw = localStorage.getItem(LS_KEY);

      if (!raw) {
        console.log('Миграция со старого конфига...');
        this._migrateFromOldConfig();
        return;
      }

      try {
        const data = JSON.parse(raw);

        PERSIST_KEYS.forEach(k => {
          if (data[k] !== undefined) {
            this[k] = data[k];
          }
        });

        // Слои восстанавливаются отложенно (после инициализации Compositor)
        if (data._layerEnabled && Array.isArray(data._layerEnabled)) {
          this._savedLayerEnabled = data._layerEnabled;
        }

        console.log('Настройки загружены (v2)');
      } catch (e) {
        console.warn('Ошибка загрузки настроек:', e);
      }
    },

    /** Применить сохранённые enabled-флаги слоёв (вызывается из SceneService) */
    applySavedLayerEnabled() {
      if (!this._savedLayerEnabled || !Array.isArray(this._savedLayerEnabled)) return;

      if (this._savedLayerEnabled.length === this.layers.length) {
        this.layers.forEach((l, i) => {
          l.enabled = !!this._savedLayerEnabled[i];
        });
        this._notify(['layers']);
      }
      delete this._savedLayerEnabled;
    },

    /** Сбросить все настройки и перезагрузить страницу */
    reset() {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem('AppState');
      localStorage.removeItem('AppConfig');
      console.log('Настройки сброшены. Перезагрузка...');
      setTimeout(() => location.reload(), 500);
    },

    /**
     * Миграция старого вложенного формата (AppState/AppConfig)
     * в новый плоский (AppState_v2).
     *
     * Старый формат: { CV: { cannyLow: 50, ... }, OSD: { enabled: true, ... } }
     * Новый формат:  { sceneCannyLow: 50, osdEnabled: true, ... }
     */
    _migrateFromOldConfig() {
      const oldRaw = localStorage.getItem('AppState') || localStorage.getItem('AppConfig');
      if (!oldRaw) return;

      try {
        const oldData = JSON.parse(oldRaw);
        const updates = {};

        PERSIST_KEYS.forEach(k => {
          if (oldData[k] !== undefined) updates[k] = oldData[k];
        });

        // Flatten вложенных объектов
        if (oldData.CV) {
          if (oldData.CV.cannyLow !== undefined) updates.sceneCannyLow = oldData.CV.cannyLow;
          if (oldData.CV.cannyHigh !== undefined) updates.sceneCannyHigh = oldData.CV.cannyHigh;
          if (oldData.CV.enabled !== undefined) updates.sceneEnabled = oldData.CV.enabled;
        }
        if (oldData.OSD) {
          if (oldData.OSD.pollIntervalSec !== undefined) updates.osdIntervalSec = oldData.OSD.pollIntervalSec;
          if (oldData.OSD.enabled !== undefined) updates.osdEnabled = oldData.OSD.enabled;
        }

        this.setMany(updates);
        console.log('Миграция завершена. Сохраняем в новый формат.');
        this.save();

      } catch (e) {
        console.error('Migration failed:', e);
      }
    },

    /** Есть ли несохранённые изменения? Сравниваем с localStorage. */
    hasUnsavedChanges() {
       const raw = localStorage.getItem(LS_KEY);
       if (!raw) return true;
       try {
         const saved = JSON.parse(raw);
         for (const k of PERSIST_KEYS) {
           if (this[k] !== saved[k]) return true;
         }
         return false;
       } catch(e) { return true; }
    }

  });

  window.AppState = store;

  // Загружаем сохранённые настройки при старте
  store.load();

})();

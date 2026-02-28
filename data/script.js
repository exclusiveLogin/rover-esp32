/**
 * ============================================================
 * 🧠 script.js — Pure Wiring (Главный скрипт)
 * ============================================================
 * 
 * Инициализирует сервисы, связывает UI и AppState.
 * НЕ содержит бизнес-логики (она в сервисах).
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ── Logger Init ──────────────────────────────────────────
  const logContainer = document.getElementById('app-log');
  window.uiLogger = {
    log(msg, type='info') {
      if (!logContainer) return;
      const row = document.createElement('div');
      row.className = `log-entry ${type}`;
      const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
      row.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg">${msg}</span>`;
      logContainer.prepend(row);
      if (logContainer.children.length > 50) logContainer.lastElementChild.remove();
    },
    info(msg) { this.log(msg, 'info'); },
    warn(msg) { this.log(msg, 'warn'); },
    error(msg) { this.log(msg, 'error'); },
    success(msg) { this.log(msg, 'success'); }
  };
  
  document.getElementById('clear-log')?.addEventListener('click', () => {
    if (logContainer) logContainer.innerHTML = '';
  });

  window.uiLogger.info('🚀 FoxOnline initializing...');
  
  const store = window.AppState;
  const binder = new window.StateBinder(store);
  
  // ── 1. Init Services ───────────────────────────────────────
  
  // Control & Sticks
  const control = new window.ControlService(store);
  const sticks = new window.StickService(store);
  
  // OSD
  const osd = new window.OSDController(store, {
    rssiVal: document.getElementById('osd-rssi'),
    heapVal: document.getElementById('osd-heap'),
    uptimeVal: document.getElementById('osd-uptime'),
    overlay: document.getElementById('osd-overlay'),

    ipVal: document.getElementById('osd-ip'),
    psramVal: document.getElementById('osd-psram'),
    cpuVal: document.getElementById('osd-cpu'),
    clientsVal: document.getElementById('osd-clients'),
    ledVal: document.getElementById('osd-led'),

    motorFL: document.getElementById('osd-fl'),
    motorFR: document.getElementById('osd-fr'),
    motorRL: document.getElementById('osd-rl'),
    motorRR: document.getElementById('osd-rr'),

    infoIp: document.getElementById('info-ip'),
    infoRssi: document.getElementById('info-rssi'),
    infoUptime: document.getElementById('info-uptime'),
    infoHeap: document.getElementById('info-heap'),
    infoCpu: document.getElementById('info-cpu'),
    infoClients: document.getElementById('info-clients'),
  });
  
  // Expo Graph
  const graph = new window.ExpoGraph('expo-graph', store);
  
  // ── 2. UI Binding (Declarative) ────────────────────────────
  
  // Connection Status (Top Bar)
  const connStatus = document.getElementById('connection-status');
  const connText = connStatus.querySelector('.text');
  store.subscribe(['isOnline', 'controlError'], (s) => {
    if (s.isOnline) {
      connStatus.className = 'status connected';
      connText.textContent = 'Подключено';
    } else {
      connStatus.className = 'status error';
      connText.textContent = 'Нет связи';
    }
    
    if (s.controlError) {
      window.uiLogger.warn('Ошибка связи с контроллером');
    }
  });
  
  // Settings: Control Mode
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.set('joystickMode', btn.dataset.mode);
      window.uiLogger.info(`Режим: ${btn.dataset.mode}`);
    });
  });
  
  store.subscribe('joystickMode', (s) => {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === s.joystickMode);
    });
    const overlay = document.getElementById('joysticks-overlay');
    if (overlay) {
      overlay.classList.toggle('single-mode', s.joystickMode === 'single');
    }
  });
  
  // Settings: Sliders & Toggles
  binder.slider('joystick-scale-slider', 'joystickScale', 'joystick-scale-value');
  binder.slider('servo-speed-slider', 'servoPanSpeed', 'servo-speed-value');
  
  binder.slider('expo-slider-x', 'expoX', 'expo-value-x');
  binder.slider('expo-slider-y', 'expoY', 'expo-value-y');
  
  binder.slider('output-min-x-slider', 'outputMinX', 'output-min-x-value');
  binder.slider('output-max-x-slider', 'outputMaxX', 'output-max-x-value');
  binder.slider('output-min-y-slider', 'outputMinY', 'output-min-y-value');
  binder.slider('output-max-y-slider', 'outputMaxY', 'output-max-y-value');
  
  binder.toggle('osd-toggle', 'osdEnabled');
  binder.slider('osd-interval-slider', 'osdIntervalSec', 'osd-interval-value');
  
  // Settings: Scene (CV)
  binder.slider('scene-canny-low', 'sceneCannyLow', 'scene-canny-low-val');
  binder.slider('scene-canny-high', 'sceneCannyHigh', 'scene-canny-high-val');
  binder.slider('scene-hough-thresh', 'sceneHoughThreshold', 'scene-hough-thresh-val');
  binder.slider('scene-hough-minlen', 'sceneHoughMinLength', 'scene-hough-minlen-val');
  binder.slider('scene-hough-maxgap', 'sceneHoughMaxGap', 'scene-hough-maxgap-val');
  binder.slider('scene-horizon-angle', 'sceneHorizonMaxAngle', 'scene-horizon-angle-val');
  binder.slider('scene-wall-tol', 'sceneWallAngleTolerance', 'scene-wall-tol-val');
  binder.slider('scene-cluster-tol', 'sceneClusterAngleTolerance', 'scene-cluster-tol-val');
  binder.slider('scene-min-cluster', 'sceneMinClusterSegments', 'scene-min-cluster-val');
  binder.slider('scene-smooth', 'sceneSmoothFrames', 'scene-smooth-val');
  binder.slider('scene-interval', 'sceneProcessInterval', 'scene-interval-val');
  
  // Settings: Motion
  binder.slider('motion-threshold-slider', 'motionThreshold', 'motion-threshold-value');
  binder.slider('motion-minarea-slider', 'motionMinArea', 'motion-minarea-value');
  binder.slider('motion-blur-slider', 'motionBlur', 'motion-blur-value');
  binder.slider('motion-dilate-slider', 'motionDilate', 'motion-dilate-value');
  binder.toggle('motion-osd-toggle', 'motionOsd');
  binder.toggle('motion-desaturate-toggle', 'motionDesaturate');
  
  // POI
  binder.slider('poi-minframes-slider', 'poiMinFrames', 'poi-minframes-value');
  binder.slider('poi-matchradius-slider', 'poiMatchRadius', 'poi-matchradius-value');
  binder.slider('poi-persistence-slider', 'poiPersistence', 'poi-persistence-value');
  binder.slider('poi-minsize-slider', 'poiMinSize', 'poi-minsize-value');
  binder.slider('poi-maxsize-slider', 'poiMaxSize', 'poi-maxsize-value');
  binder.slider('poi-maxzones-slider', 'poiMaxZones', 'poi-maxzones-value');
  binder.slider('poi-noisethreshold-slider', 'poiNoiseThreshold', 'poi-noisethreshold-value');
  binder.slider('poi-emaposition-slider', 'poiEmaPosition', 'poi-emaposition-value');
  binder.slider('poi-emasize-slider', 'poiEmaSize', 'poi-emasize-value');

  // Save button
  const saveBtn = document.getElementById('settings-save-btn');
  const saveStatus = document.getElementById('settings-save-status');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveBtn.disabled = true;
      store.save();
      window.uiLogger.success('Настройки сохранены');
      setTimeout(() => saveBtn.disabled = false, 500);
    });
  }
  
  // UI Helper: Show save status
  window.showSaveStatus = (success) => {
    if (!saveStatus) return;
    saveStatus.textContent = success ? 'Сохранено' : 'Ошибка';
    saveStatus.className = 'save-settings-status visible ' + (success ? 'success' : 'error');
    setTimeout(() => {
      saveStatus.classList.remove('visible');
    }, 2000);
  };
  
  // ── 3. Scene Service (CV, Motion, Compositor, Layers) ──────
  const img = document.getElementById('video-feed');

  const scene = new SceneService(store, {
    videoFeed: img,
    videoLocal: document.getElementById('video-local'),
    overlayCanvas: document.getElementById('compositor-overlay'),
    videoContainer: document.querySelector('.video-container'),
  });

  // Кнопки процессоров
  document.getElementById('cv-btn').addEventListener('click', () => scene.toggleCV());
  document.getElementById('motion-btn').addEventListener('click', () => scene.toggleMotion());
  document.getElementById('base-layer-btn').addEventListener('click', () => scene.toggleBaseLayer());
  document.getElementById('webcam-btn').addEventListener('click', () => scene.toggleWebcam());
  document.getElementById('photo-btn').addEventListener('click', () => scene.takePhoto());

  // Слои — делегация кликов
  document.querySelectorAll('.layer-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.layer-eye-btn')) return;
      scene.toggleLayer(parseInt(tile.dataset.layerIdx));
    });
  });
  document.querySelectorAll('.layer-eye-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      scene.soloLayer(parseInt(btn.dataset.layerIdx));
    });
  });

  // ── 4. Stream & LED ────────────────────────────────────────
  const streamToggle = document.getElementById('stream-toggle');
  const stream = new StreamService(store, img);

  store.subscribe('isStreaming', (s) => {
    if (s.isStreaming) {
      stream.start();
      img.classList.remove('hidden');
      streamToggle.classList.add('active');
      streamToggle.querySelector('.icon').textContent = '⏹';
    } else {
      stream.stop();
      img.classList.add('hidden');
      streamToggle.classList.remove('active');
      streamToggle.querySelector('.icon').textContent = '▶';
    }
  });

  streamToggle.addEventListener('click', () => store.toggle('isStreaming'));

  document.getElementById('led-btn').addEventListener('click', async () => {
    try {
      await fetch(store.getApiUrl('/led/toggle'), { method: 'POST' });
      document.getElementById('led-btn').classList.toggle('active');
      window.uiLogger.info('LED переключен');
    } catch (e) { window.uiLogger.error('LED: ' + e.message); }
  });

  // ── 5. Servo PAN ───────────────────────────────────────────
  const servoSlider = document.getElementById('servo-pan-slider');
  const servoValue  = document.getElementById('servo-pan-value');
  const sendServo = RoverMath.debounce((val) => {
    fetch(store.getApiUrl('/api/servo'), {
      method: 'POST', body: new URLSearchParams({ angle: val })
    }).catch(e => window.uiLogger?.error('Servo: ' + e.message));
  }, 100);

  servoSlider?.addEventListener('input', () => {
    servoValue.textContent = servoSlider.value + '°';
    sendServo(servoSlider.value);
  });

  // ── 6. Motor Buttons (Drive API) ──────────────────────────
  document.querySelectorAll('.motor-control').forEach(ctrl => {
    const motor = ctrl.dataset.motor;
    ctrl.querySelectorAll('.btn-motor').forEach(btn => {
      btn.addEventListener('click', () => {
        fetch(store.getApiUrl('/api/drive'), {
          method: 'POST', body: new URLSearchParams({ motor, action: btn.dataset.action })
        }).catch(e => window.uiLogger?.error('Drive: ' + e.message));
      });
    });
  });

  document.getElementById('stop-all')?.addEventListener('click', () => {
    fetch(store.getApiUrl('/api/drive'), {
      method: 'POST', body: new URLSearchParams({ action: 'stop' })
    }).catch(e => window.uiLogger?.error('Stop: ' + e.message));
  });

  // ── 7. Joysticks (Touch Handling) ──────────────────────────
  
  class SimpleJoystick {
    constructor(areaId, stickId, side) {
      this.area = document.getElementById(areaId);
      this.stick = document.getElementById(stickId);
      this.side = side;
      this.rect = null;
      this.active = false;
      this.touchId = null;
      
      // Output elements
      this.uiVal = document.getElementById(side === 'left' ? 'joy-y' : 'joy-x');
      this.uiExpo = document.getElementById(side === 'left' ? 'expo-y' : 'expo-x');
      
      if (!this.area || !this.stick) return;
      
      const start = (e) => this.start(e);
      const move = (e) => this.move(e);
      const end = (e) => this.end(e);
      
      this.area.addEventListener('touchstart', start, { passive: false });
      this.area.addEventListener('touchmove', move, { passive: false });
      this.area.addEventListener('touchend', end);
      this.area.addEventListener('touchcancel', end);
      
      this.area.addEventListener('mousedown', start);
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', end);
    }
    
    start(e) {
      if (this.active) return;
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.touchId = e.changedTouches ? touch.identifier : 'mouse';
      this.active = true;
      this.rect = this.area.getBoundingClientRect();
      this.stick.classList.add('active');
      this.update(touch.clientX, touch.clientY);
      if (e.cancelable && e.type !== 'mousedown') e.preventDefault();
    }
    
    move(e) {
      if (!this.active) return;
      let clientX, clientY;
      
      if (e.changedTouches) {
        const t = Array.from(e.changedTouches).find(t => t.identifier === this.touchId);
        if (!t) return;
        clientX = t.clientX;
        clientY = t.clientY;
      } else {
        if (this.touchId !== 'mouse') return;
        clientX = e.clientX;
        clientY = e.clientY;
      }
      
      if (e.cancelable) e.preventDefault();
      this.update(clientX, clientY);
    }
    
    end(e) {
      if (!this.active) return;
      if (e.changedTouches) {
        const t = Array.from(e.changedTouches).find(t => t.identifier === this.touchId);
        if (!t) return;
      } else {
        if (this.touchId !== 'mouse') return;
      }
      
      this.active = false;
      this.touchId = null;
      this.stick.classList.remove('active');
      this.stick.style.transform = `translate(-50%, -50%)`;
      sticks.release(this.side);
    }
    
    update(cx, cy) {
      const radius = this.rect.width / 2;
      const centerX = this.rect.left + radius;
      const centerY = this.rect.top + radius;
      
      let dx = cx - centerX;
      let dy = cy - centerY;
      
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }
      
      const normX = dx / radius;
      const normY = dy / radius;
      
      this.stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      
      // Invert Y: Up (-1 screen) -> 1 (logical forward)
      sticks.move(this.side, normX, -normY);
    }
  }
  
  // Инит джойстиков
  new SimpleJoystick('joystick-left', 'stick-left', 'left');
  new SimpleJoystick('joystick-right', 'stick-right', 'right');
  
  // Визуализация значений
  store.subscribe(['rawControlX', 'rawControlY', 'controlX', 'controlY'], (s) => {
    const joyY = document.getElementById('joy-y');
    const expoY = document.getElementById('expo-y');
    if (joyY) joyY.textContent = Math.round((s.rawControlY || 0) * 100);
    if (expoY) expoY.textContent = '→' + (s.controlY || 0);
    
    const joyX = document.getElementById('joy-x');
    const expoX = document.getElementById('expo-x');
    if (joyX) joyX.textContent = Math.round((s.rawControlX || 0) * 100);
    if (expoX) expoX.textContent = '→' + (s.controlX || 0);
    
    const act = document.getElementById('joy-active');
    if (act) act.style.color = s.controlActive ? '#FF6A00' : '#555';
  });
  
  // ── 8. Finish Init ─────────────────────────────────────────
  
  const loader = document.getElementById('video-overlay');
  if (loader) {
    loader.classList.remove('visible');
  }
  
  window.uiLogger.success('Система готова');
});

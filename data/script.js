/**
 * ESP32-CAM Rover Client
 */
(function() {
  'use strict';

  // === Элементы DOM ===
  const videoFeed = document.getElementById('video-feed');
  const videoLocal = document.getElementById('video-local');
  const videoOverlay = document.getElementById('video-overlay');
  const streamToggle = document.getElementById('stream-toggle');
  const webcamBtn = document.getElementById('webcam-btn');
  const photoBtn = document.getElementById('photo-btn');
  const ledBtn = document.getElementById('led-btn');
  const connectionStatus = document.getElementById('connection-status');
  const streamUrlDisplay = document.getElementById('stream-url');
  const streamStatusDisplay = document.getElementById('stream-status');

  // === Конфигурация (из AppConfig) ===
  const streamUrl = window.AppConfig.getStreamUrl();

  // === Состояние ===
  let isStreaming = false;
  let isWebcamActive = false;
  let webcamStream = null;
  let ledState = false;
  let reconnectTimer = null;

  // === Инициализация ===
  function init() {
    streamUrlDisplay.textContent = streamUrl;
    
    // События кнопок
    streamToggle.addEventListener('click', toggleStream);
    webcamBtn.addEventListener('click', toggleWebcam);
    photoBtn.addEventListener('click', takePhoto);
    ledBtn.addEventListener('click', toggleLed);

    // События видео
    videoFeed.addEventListener('load', onStreamLoad);
    videoFeed.addEventListener('error', onStreamError);

    // Загрузка состояния LED
    fetchLedState();

    // Автостарт стрима
    startStream();
  }

  // === СТРИМ ===
  function startStream() {
    if (isStreaming) return;
    
    showOverlay('Подключение к стриму...');
    // CORS: установить ДО src для cross-origin доступа (нужно для OpenCV.js)
    videoFeed.crossOrigin = 'anonymous';
    // Добавляем timestamp чтобы избежать кэширования при переподключении
    videoFeed.src = streamUrl + '?t=' + Date.now();
    isStreaming = true;
    updateStreamUI();
  }

  function stopStream() {
    if (!isStreaming) return;
    
    // Останавливаем загрузку
    videoFeed.src = '';
    isStreaming = false;
    clearReconnectTimer();
    showOverlay('Стрим остановлен');
    updateStreamUI();
  }

  function toggleStream() {
    isStreaming ? stopStream() : startStream();
  }

  function onStreamLoad() {
    hideOverlay();
    setConnectionStatus('connected', 'Подключено');
    streamStatusDisplay.textContent = 'Активен';
    clearReconnectTimer();
  }

  function onStreamError() {
    if (!isStreaming) return;
    
    setConnectionStatus('error', 'Ошибка соединения');
    streamStatusDisplay.textContent = 'Переподключение...';
    showOverlay('Потеря соединения...');
    
    // Автопереподключение
    scheduleReconnect();
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      if (isStreaming) {
        videoFeed.crossOrigin = 'anonymous';
        videoFeed.src = streamUrl + '?t=' + Date.now();
      }
    }, window.AppConfig.UI.reconnectDelay);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // === ВЕБКА (getUserMedia) ===
  // Локальный источник видео — CORS не нужен!
  
  async function startWebcam() {
    if (isWebcamActive) return;
    
    // Останавливаем MJPEG стрим если активен
    if (isStreaming) stopStream();
    
    showOverlay('Запрос доступа к камере...');
    
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',  // Задняя камера на телефоне
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
      
      videoLocal.srcObject = webcamStream;
      videoLocal.classList.add('active');
      videoFeed.classList.add('hidden');
      
      isWebcamActive = true;
      hideOverlay();
      setConnectionStatus('connected', 'Вебка');
      streamStatusDisplay.textContent = 'Вебка активна';
      streamUrlDisplay.textContent = 'getUserMedia (локально)';
      
      webcamBtn.classList.add('active');
      streamToggle.classList.remove('active');
      
      console.log('🎥 Вебка запущена');
      
    } catch (err) {
      console.error('Webcam error:', err);
      showOverlay('Ошибка доступа к камере');
      setConnectionStatus('error', err.message);
    }
  }
  
  function stopWebcam() {
    if (!isWebcamActive) return;
    
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      webcamStream = null;
    }
    
    videoLocal.srcObject = null;
    videoLocal.classList.remove('active');
    videoFeed.classList.remove('hidden');
    
    isWebcamActive = false;
    webcamBtn.classList.remove('active');
    streamStatusDisplay.textContent = 'Остановлен';
    streamUrlDisplay.textContent = streamUrl;
    
    console.log('🎥 Вебка остановлена');
  }
  
  function toggleWebcam() {
    isWebcamActive ? stopWebcam() : startWebcam();
  }
  
  /**
   * Получить текущий активный видео-элемент (для CV)
   */
  function getActiveVideoElement() {
    if (isWebcamActive) return videoLocal;
    return videoFeed;
  }
  
  // Экспорт для CV
  window.getActiveVideoElement = getActiveVideoElement;

  // === ФОТО ===
  function takePhoto() {
    const photoUrl = window.AppConfig.getApiUrl(window.AppConfig.PHOTO_API) + '?t=' + Date.now();
    
    // Временно останавливаем стрим, показываем фото
    const wasStreaming = isStreaming;
    if (wasStreaming) stopStream();
    
    showOverlay('Получение снимка...');
    videoFeed.crossOrigin = 'anonymous';
    videoFeed.src = photoUrl;
    
    videoFeed.onload = function() {
      hideOverlay();
      streamStatusDisplay.textContent = 'Снимок';
      // Одноразовый обработчик
      videoFeed.onload = onStreamLoad;
    };
  }

  // === LED ===
  function fetchLedState() {
    fetch(window.AppConfig.getApiUrl(window.AppConfig.LED_API))
      .then(r => r.json())
      .then(data => {
        ledState = data.state || false;
        updateLedUI();
      })
      .catch(() => {});
  }

  function toggleLed() {
    fetch(window.AppConfig.getApiUrl(window.AppConfig.LED_API + '/toggle'), { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        ledState = data.state || false;
        updateLedUI();
      })
      .catch(() => {
        // При ошибке пробуем получить актуальное состояние
        fetchLedState();
      });
  }

  function updateLedUI() {
    ledBtn.classList.toggle('active', ledState);
  }

  // === UI Helpers ===
  function showOverlay(message) {
    videoOverlay.querySelector('span').textContent = message;
    videoOverlay.classList.add('visible');
  }

  function hideOverlay() {
    videoOverlay.classList.remove('visible');
  }

  function setConnectionStatus(status, text) {
    connectionStatus.className = 'status ' + status;
    connectionStatus.querySelector('.text').textContent = text;
  }

  function updateStreamUI() {
    if (isStreaming) {
      streamToggle.innerHTML = '<span class="icon">⏸</span> Стоп';
      streamToggle.classList.add('active');
    } else {
      streamToggle.innerHTML = '<span class="icon">▶</span> Стрим';
      streamToggle.classList.remove('active');
      streamStatusDisplay.textContent = 'Остановлен';
    }
  }

  // ============================================================
  // 🚗 DRIVE API
  // ============================================================

  const STEP_VALUE = 25;  // Шаг изменения скорости

  function fetchDriveState() {
    fetch(window.AppConfig.getApiUrl(window.AppConfig.DRIVE_API))
      .then(r => r.json())
      .then(updateDriveUI)
      .catch(err => console.error('Drive API error:', err));
  }

  function sendDriveCommand(action, motor, value = STEP_VALUE) {
    fetch(window.AppConfig.getApiUrl(window.AppConfig.DRIVE_API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, motor, value })
    })
      .then(r => r.json())
      .then(updateDriveUI)
      .catch(err => console.error('Drive API error:', err));
  }

  function updateDriveUI(state) {
    const motors = ['fl', 'fr', 'rl', 'rr'];
    motors.forEach(m => {
      const val = state[m] || 0;
      const percent = (val / 255) * 100;
      
      const valEl = document.getElementById('val-' + m);
      const barEl = document.getElementById('bar-' + m);
      
      if (valEl) valEl.textContent = val;
      if (barEl) barEl.style.width = percent + '%';
    });
  }

  function initDriveControls() {
    // Кнопки +/- для каждого мотора
    document.querySelectorAll('.motor-control').forEach(ctrl => {
      const motor = ctrl.dataset.motor;
      
      ctrl.querySelectorAll('.btn-motor').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          sendDriveCommand(action, motor, STEP_VALUE);
        });
      });
    });

    // STOP ALL
    const stopBtn = document.getElementById('stop-all');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        sendDriveCommand('stop', 'all');
      });
    }

    // Загрузка начального состояния
    fetchDriveState();
  }

  // ============================================================
  // 🎮 DUAL JOYSTICKS — DJI-style (поверх видео)
  // ============================================================
  //
  // Левый джойстик: ГАЗ (только ось Y)
  // Правый джойстик: РУЛЬ (только ось X)
  //
  // Состояние мержится в ControlService.
  //
  // ============================================================

  let controlService = null;

  // Конфиг джойстиков
  const joysticks = {
    left: {
      area: null,
      stick: null,
      radius: 0,
      axis: 'y',       // Управляет осью Y (газ)
      active: false,
      touchId: null,   // ID тача для multitouch
    },
    right: {
      area: null,
      stick: null,
      radius: 0,
      axis: 'x',       // Управляет осью X (руль)
      active: false,
      touchId: null,
    },
  };

  /**
   * Инициализация двойных джойстиков
   */
  function initJoysticks() {
    // Находим элементы
    joysticks.left.area = document.getElementById('joystick-left');
    joysticks.left.stick = document.getElementById('stick-left');
    joysticks.right.area = document.getElementById('joystick-right');
    joysticks.right.stick = document.getElementById('stick-right');

    if (!joysticks.left.area || !joysticks.right.area) {
      console.warn('Joystick elements not found');
      return;
    }

    // Вычисляем радиусы
    calcJoystickRadius('left');
    calcJoystickRadius('right');

    // === Создаём ControlService ===
    controlService = new ControlService(
      window.AppConfig.getApiUrl(window.AppConfig.CONTROL_API),
      window.AppConfig.CONTROL
    );

    // Подписки
    controlService.onMotorsUpdate = (motors) => updateDriveUI(motors);
    controlService.onStateChange = (state) => updateIndicators(state);
    controlService.onError = (err) => showControlError(err.message);

    // Запускаем
    controlService.start();
    console.log('🎮 ControlService started');

    // === Привязка событий для каждого джойстика ===
    setupJoystickEvents('left');
    setupJoystickEvents('right');

    // Пересчёт радиуса при resize
    window.addEventListener('resize', () => {
      calcJoystickRadius('left');
      calcJoystickRadius('right');
    });

    console.log('🎮 Dual joysticks initialized');
  }

  /**
   * Вычисление радиуса джойстика
   */
  function calcJoystickRadius(side) {
    const joy = joysticks[side];
    if (!joy.area) return;
    
    const rect = joy.area.getBoundingClientRect();
    const stickSize = joy.stick ? joy.stick.offsetWidth : 50;
    joy.radius = (rect.width / 2) - (stickSize / 2);
  }

  /**
   * Привязка событий touch/mouse к джойстику
   */
  function setupJoystickEvents(side) {
    const joy = joysticks[side];

    // === Touch (поддержка multitouch) ===
    joy.area.addEventListener('touchstart', (e) => onJoyStart(e, side), { passive: false });
    joy.area.addEventListener('touchmove', (e) => onJoyMove(e, side), { passive: false });
    joy.area.addEventListener('touchend', (e) => onJoyEnd(e, side));
    joy.area.addEventListener('touchcancel', (e) => onJoyEnd(e, side));

    // === Mouse ===
    joy.area.addEventListener('mousedown', (e) => onJoyStart(e, side));
  }

  /**
   * Начало движения
   */
  function onJoyStart(e, side) {
    e.preventDefault();
    const joy = joysticks[side];

    // Для touch сохраняем ID
    if (e.touches) {
      // Находим тач, который начался на этом джойстике
      for (const touch of e.changedTouches) {
        joy.touchId = touch.identifier;
        break;
      }
    }

    joy.active = true;
    joy.stick.classList.add('active');

    // Обновляем позицию (учитываем режим XY или одноосевой)
    if (joy.axis === 'xy') {
      const xy = getJoyValueXY(e, side);
      applyJoyValueXY(side, xy.x, xy.y);
    } else {
      const value = getJoyValue(e, side);
      applyJoyValue(side, value);
    }

    // Mouse события на document
    if (!e.touches) {
      const moveHandler = (ev) => onJoyMove(ev, side);
      const endHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', endHandler);
        onJoyEnd(null, side);
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', endHandler);
    }
  }

  /**
   * Движение
   */
  function onJoyMove(e, side) {
    const joy = joysticks[side];
    if (!joy.active) return;
    e.preventDefault();

    if (joy.axis === 'xy') {
      const xy = getJoyValueXY(e, side);
      applyJoyValueXY(side, xy.x, xy.y);
    } else {
      const value = getJoyValue(e, side);
      applyJoyValue(side, value);
    }
  }

  /**
   * Конец движения
   */
  function onJoyEnd(e, side) {
    const joy = joysticks[side];
    
    // Для touch проверяем что это наш тач
    if (e && e.changedTouches) {
      let found = false;
      for (const touch of e.changedTouches) {
        if (touch.identifier === joy.touchId) {
          found = true;
          break;
        }
      }
      if (!found) return;  // Не наш тач
    }

    joy.active = false;
    joy.touchId = null;
    joy.stick.classList.remove('active');

    // Сброс позиции
    if (joy.axis === 'xy') {
      applyJoyValueXY(side, 0, 0);
      controlService.deactivate();
    } else {
      applyJoyValue(side, 0);
      if (joy.axis === 'x') {
        controlService.resetX();
      } else {
        controlService.resetY();
      }
    }
  }

  /**
   * Получение значения из события (одноосевой)
   */
  function getJoyValue(e, side) {
    const joy = joysticks[side];
    const rect = joy.area.getBoundingClientRect();
    
    // Для XY режима используем отдельную функцию
    if (joy.axis === 'xy') {
      return getJoyValueXY(e, side);
    }
    
    const center = joy.axis === 'y' 
      ? rect.top + rect.height / 2
      : rect.left + rect.width / 2;

    // Координата из события
    let pos;
    if (e.touches) {
      for (const touch of e.touches) {
        if (touch.identifier === joy.touchId) {
          pos = joy.axis === 'y' ? touch.clientY : touch.clientX;
          break;
        }
      }
      if (pos === undefined) return 0;
    } else {
      pos = joy.axis === 'y' ? e.clientY : e.clientX;
    }

    // Delta от центра
    let delta = joy.axis === 'y' 
      ? center - pos   // Y: вверх = положительный
      : pos - center;  // X: вправо = положительный

    // Ограничение радиусом
    if (Math.abs(delta) > joy.radius) {
      delta = delta > 0 ? joy.radius : -joy.radius;
    }

    return Math.round((delta / joy.radius) * 255);
  }

  /**
   * Получение XY из события (двухосевой)
   */
  function getJoyValueXY(e, side) {
    const joy = joysticks[side];
    const rect = joy.area.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let clientX, clientY;
    if (e.touches) {
      for (const touch of e.touches) {
        if (touch.identifier === joy.touchId) {
          clientX = touch.clientX;
          clientY = touch.clientY;
          break;
        }
      }
      if (clientX === undefined) return { x: 0, y: 0 };
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    let deltaX = clientX - centerX;
    let deltaY = centerY - clientY;  // Y инвертирован

    // Ограничение радиусом
    const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (dist > joy.radius) {
      const scale = joy.radius / dist;
      deltaX *= scale;
      deltaY *= scale;
    }

    return {
      x: Math.round((deltaX / joy.radius) * 255),
      y: Math.round((deltaY / joy.radius) * 255),
    };
  }

  /**
   * Применение значения к джойстику (одноосевой)
   */
  function applyJoyValue(side, value) {
    const joy = joysticks[side];

    // Визуальное перемещение ручки
    const pixel = (value / 255) * joy.radius;
    if (joy.axis === 'y') {
      joy.stick.style.top = `calc(50% - ${pixel}px)`;
      joy.stick.style.left = '50%';
    } else {
      joy.stick.style.left = `calc(50% + ${pixel}px)`;
      joy.stick.style.top = '50%';
    }

    // Отправка в ControlService
    if (joy.axis === 'x') {
      controlService.setX(value);
    } else {
      controlService.setY(value);
    }
  }

  /**
   * Применение XY значения к джойстику (двухосевой)
   */
  function applyJoyValueXY(side, x, y) {
    const joy = joysticks[side];

    // Визуальное перемещение ручки
    const pixelX = (x / 255) * joy.radius;
    const pixelY = -(y / 255) * joy.radius;  // Y инвертирован для CSS

    joy.stick.style.left = `calc(50% + ${pixelX}px)`;
    joy.stick.style.top = `calc(50% + ${pixelY}px)`;

    // Отправка в ControlService
    controlService.setXY(x, y);
  }

  /**
   * Обновление индикаторов
   */
  function updateIndicators(state) {
    // Сырые значения
    const xEl = document.getElementById('joy-x');
    const yEl = document.getElementById('joy-y');
    // Expo значения
    const expoXEl = document.getElementById('expo-x');
    const expoYEl = document.getElementById('expo-y');
    // Статус
    const activeEl = document.getElementById('joy-active');
    const statusEl = document.getElementById('control-status');

    // Сырые
    if (xEl) xEl.textContent = state.x;
    if (yEl) yEl.textContent = state.y;
    
    // Expo (с стрелкой)
    if (expoXEl) expoXEl.textContent = `→${state.expoX}`;
    if (expoYEl) expoYEl.textContent = `→${state.expoY}`;
    
    if (activeEl) activeEl.textContent = state.active ? '🟢' : '⚪';
    
    // Статус (показываем expo значения)
    if (statusEl) {
      statusEl.classList.remove('error', 'pending');
      
      if (state.error) {
        statusEl.textContent = state.error;
        statusEl.classList.add('error');
      } else if (state.pending) {
        statusEl.textContent = '...';
        statusEl.classList.add('pending');
      } else if (state.active) {
        statusEl.textContent = `${state.expoX},${state.expoY}`;
      } else {
        statusEl.textContent = '';
      }
    }
    
    // Обновляем график с точками
    const points = state.active ? {
      rawX: state.x, rawY: state.y,
      expoX: state.expoX, expoY: state.expoY
    } : null;
    drawExpoGraph(points);
  }

  /**
   * Показать ошибку управления
   */
  function showControlError(message) {
    console.error('🚨 Control error:', message);
    
    const statusEl = document.getElementById('control-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.add('error');
      
      // Автоочистка
      setTimeout(() => {
        if (statusEl.textContent === message) {
          statusEl.textContent = '';
          statusEl.classList.remove('error');
        }
      }, window.AppConfig.UI.errorDisplayTime);
    }
  }

  // ============================================================
  // ⚙️ SETTINGS — Настройки управления
  // ============================================================

  let expoCanvas = null;
  let expoCtx = null;
  let currentExpoX = 0;  // Текущее значение expo X для перерисовки
  let currentExpoY = 0;  // Текущее значение expo Y для перерисовки

  /**
   * Инициализация настроек
   */
  function initSettings() {
    // === Размер стиков (25..175%) ===
    setupJoystickScaleSlider();

    // === Кнопка «Сохранить настройки» ===
    setupSaveSettingsButton();

    // === Переключатель режимов джойстиков ===
    // ВАЖНО: выбираем только кнопки с data-mode (dual/single),
    // а не все .toggle-btn на странице, иначе при клике
    // снимется active со ВСЕХ тогглов (motion, OSD, CV debug).
    document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setJoystickMode(mode);
        
        // UI: снимаем active только с соседних кнопок режима джойстиков
        document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // === Expo sliders (раздельно X / Y) ===
    setupExpoSlider('x');
    setupExpoSlider('y');

    // === Output range sliders (PWM мин./макс.) ===
    setupOutputRangeSliders();

    // === Инициализация canvas для графика ===
    expoCanvas = document.getElementById('expo-graph');
    if (expoCanvas) {
      expoCtx = expoCanvas.getContext('2d');
      drawExpoGraph();
    }

    console.log('⚙️ Settings initialized');
  }

  /**
   * Настройка одного expo-слайдера
   * @param {'x'|'y'} axis
   */
  function setupExpoSlider(axis) {
    const slider = document.getElementById(`expo-slider-${axis}`);
    const valueEl = document.getElementById(`expo-value-${axis}`);
    const labelEl = document.getElementById(`expo-label-${axis}`);
    
    if (!slider) return;

    slider.addEventListener('input', () => {
      const value = parseInt(slider.value);
      const norm = value / 100;

      if (axis === 'x') currentExpoX = norm;
      else currentExpoY = norm;

      // Обновляем inline значение (компактно)
      if (valueEl) valueEl.textContent = value;

      // Обновляем лейбл графика в settings
      if (labelEl) {
        const prefix = axis === 'x' ? 'X: ' : 'Y: ';
        if (value > 0) labelEl.textContent = prefix + value + '% мягк';
        else if (value < 0) labelEl.textContent = prefix + value + '% резк';
        else labelEl.textContent = prefix + '—';
      }

      // Применяем к ControlService
      if (controlService) {
        controlService.setExpo(axis, value);
      }

      // Перерисовываем график
      redrawExpoGraph();
    });
  }

  /**
   * Настройка слайдеров диапазона выхода (PWM мин./макс.) — по осям
   */
  function setupOutputRangeSliders() {
    setupOutputAxis('x');
    setupOutputAxis('y');
  }

  function setupOutputAxis(axis) {
    const minSlider = document.getElementById(`output-min-${axis}-slider`);
    const minVal    = document.getElementById(`output-min-${axis}-value`);
    const maxSlider = document.getElementById(`output-max-${axis}-slider`);
    const maxVal    = document.getElementById(`output-max-${axis}-value`);

    const cfgKey = axis === 'x' ? 'outputMinX' : 'outputMinY';
    const cfgKeyMax = axis === 'x' ? 'outputMaxX' : 'outputMaxY';
    const cfg = window.AppConfig.CONTROL;

    if (minSlider && cfg[cfgKey] !== undefined) {
      minSlider.value = cfg[cfgKey];
      if (minVal) minVal.textContent = cfg[cfgKey];
    }
    if (maxSlider && cfg[cfgKeyMax] !== undefined) {
      maxSlider.value = cfg[cfgKeyMax];
      if (maxVal) maxVal.textContent = cfg[cfgKeyMax];
    }

    if (minSlider) {
      minSlider.addEventListener('input', () => {
        let min = parseInt(minSlider.value);
        const max = maxSlider ? parseInt(maxSlider.value) : 255;
        if (min >= max) { min = max - 5; minSlider.value = min; }
        if (minVal) minVal.textContent = min;
        if (controlService) controlService.setOutputRange(axis, min, max);
      });
    }

    if (maxSlider) {
      maxSlider.addEventListener('input', () => {
        let max = parseInt(maxSlider.value);
        const min = minSlider ? parseInt(minSlider.value) : 0;
        if (max <= min) { max = min + 5; maxSlider.value = max; }
        if (maxVal) maxVal.textContent = max;
        if (controlService) controlService.setOutputRange(axis, min, max);
      });
    }
  }

  /**
   * Слайдер размера стиков (25..175%)
   */
  function setupJoystickScaleSlider() {
    const slider = document.getElementById('joystick-scale-slider');
    const valueEl = document.getElementById('joystick-scale-value');
    if (!slider) return;

    const scale = Math.round(Number(window.AppConfig.JOYSTICK.scale) || 100);
    slider.value = scale;
    if (valueEl) valueEl.textContent = scale + '%';
    applyJoystickScale();

    slider.addEventListener('input', () => {
      const v = parseInt(slider.value);
      window.AppConfig.JOYSTICK.scale = v;
      if (valueEl) valueEl.textContent = v + '%';
      applyJoystickScale();
    });
  }

  /**
   * Применить масштаб стиков к DOM и пересчитать радиус
   */
  function applyJoystickScale() {
    const scale = (Number(window.AppConfig.JOYSTICK.scale) || 100) / 100;
    document.querySelectorAll('.joystick-area').forEach(el => {
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = 'center center';
    });
    calcJoystickRadius('left');
    calcJoystickRadius('right');
  }

  /**
   * Кнопка «Сохранить настройки» — пишем UI в AppConfig и сохраняем в localStorage
   */
  function setupSaveSettingsButton() {
    const btn = document.getElementById('settings-save-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      // Синхронизируем CONTROL из controlService (expo + output range уже там)
      if (controlService) {
        const cfg = controlService.config;
        Object.assign(window.AppConfig.CONTROL, {
          deadzone: cfg.deadzone,
          expoX: cfg.expoX,
          expoY: cfg.expoY,
          outputMinX: cfg.outputMinX,
          outputMaxX: cfg.outputMaxX,
          outputMinY: cfg.outputMinY,
          outputMaxY: cfg.outputMaxY,
        });
      }
      // JOYSTICK.scale уже обновляется слайдером
      window.AppConfig.save();

      btn.textContent = '✓ Сохранено';
      btn.classList.add('saved');
      setTimeout(() => {
        btn.textContent = '💾 Сохранить настройки';
        btn.classList.remove('saved');
      }, 1500);
    });
  }

  /**
   * Перерисовка графика с текущими точками
   */
  function redrawExpoGraph() {
    const state = controlService ? controlService.getState() : null;
    const points = state && state.active ? {
      rawX: state.x, rawY: state.y,
      expoX: state.expoX, expoY: state.expoY
    } : null;
    drawExpoGraph(points);
  }

  /**
   * Переключение режима джойстиков
   */
  function setJoystickMode(mode) {
    const overlay = document.getElementById('joysticks-overlay');
    if (!overlay) return;

    // Находим wrapper'ы
    const leftWrapper = joysticks.left.area?.parentElement;
    const rightWrapper = joysticks.right.area?.parentElement;
    const rightLabel = rightWrapper?.querySelector('.joystick-label');

    if (mode === 'single') {
      // Скрываем левый джойстик, делаем правый полноценным XY
      overlay.classList.add('single-mode');
      leftWrapper?.classList.add('hidden');
      joysticks.right.axis = 'xy';
      
      // Обновляем лейбл
      if (rightLabel) {
        rightLabel.querySelector('.axis-icon').textContent = '🎮';
        rightLabel.querySelector('.axis-name').textContent = 'XY';
      }
    } else {
      // Возвращаем раздельный режим
      overlay.classList.remove('single-mode');
      leftWrapper?.classList.remove('hidden');
      joysticks.left.axis = 'y';
      joysticks.right.axis = 'x';
      
      // Возвращаем лейбл
      if (rightLabel) {
        rightLabel.querySelector('.axis-icon').textContent = '⬅➡';
        rightLabel.querySelector('.axis-name').textContent = 'РУЛЬ';
      }
    }

    // Пересчитываем радиус (размер мог измениться)
    setTimeout(() => {
      calcJoystickRadius('left');
      calcJoystickRadius('right');
    }, 50);

    console.log(`🎮 Joystick mode: ${mode}`);
  }

  /**
   * Отрисовка графика expo с двумя кривыми (X и Y)
   * @param {object} points - Опционально: { rawX, rawY, expoX, expoY } для отрисовки точек
   */
  function drawExpoGraph(points = null) {
    if (!expoCtx || !expoCanvas) return;

    const w = expoCanvas.width;
    const h = expoCanvas.height;
    const padding = 10;
    const graphW = w - 2 * padding;
    const graphH = h - 2 * padding;
    const steps = 50;

    // Очистка
    expoCtx.fillStyle = '#0f0f0f';
    expoCtx.fillRect(0, 0, w, h);

    // Сетка
    expoCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    expoCtx.lineWidth = 1;
    expoCtx.beginPath();
    expoCtx.moveTo(w / 2, padding);
    expoCtx.lineTo(w / 2, h - padding);
    expoCtx.moveTo(padding, h / 2);
    expoCtx.lineTo(w - padding, h / 2);
    expoCtx.stroke();

    // Линейная кривая (эталон)
    expoCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    expoCtx.lineWidth = 1;
    expoCtx.beginPath();
    expoCtx.moveTo(padding, h - padding);
    expoCtx.lineTo(w - padding, padding);
    expoCtx.stroke();

    // --- Рисуем кривую ---
    const drawCurve = (expo, color, dash = []) => {
      expoCtx.strokeStyle = color;
      expoCtx.lineWidth = 2;
      expoCtx.setLineDash(dash);
      expoCtx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const input = i / steps;
        const output = ControlService.calcExpoPoint(input, expo);
        const x = padding + input * graphW;
        const y = h - padding - output * graphH;
        if (i === 0) expoCtx.moveTo(x, y);
        else expoCtx.lineTo(x, y);
      }
      expoCtx.stroke();
      expoCtx.setLineDash([]);
    };

    // Кривая X (оранжевая, сплошная)
    if (currentExpoX !== 0) drawCurve(currentExpoX, '#ff9800');
    // Кривая Y (зелёная, пунктир)
    if (currentExpoY !== 0) drawCurve(currentExpoY, '#4caf50', [4, 3]);

    // === Точки текущих значений ===
    if (points) {
      const maxVal = 255;

      const drawPoint = (rawVal, expoVal, color, label, expo) => {
        const inputNorm = Math.abs(rawVal) / maxVal;
        const outputNorm = Math.abs(expoVal) / maxVal;
        const px = padding + inputNorm * graphW;
        const py = h - padding - outputNorm * graphH;

        expoCtx.beginPath();
        expoCtx.arc(px, py, 5, 0, Math.PI * 2);
        expoCtx.fillStyle = color;
        expoCtx.fill();
        expoCtx.strokeStyle = '#fff';
        expoCtx.lineWidth = 1;
        expoCtx.stroke();

        expoCtx.fillStyle = color;
        expoCtx.font = 'bold 9px sans-serif';
        expoCtx.fillText(label, px + 7, py + 3);
      };

      if (points.rawX !== undefined && points.rawX !== 0) {
        drawPoint(points.rawX, points.expoX, '#ff9800', 'X', currentExpoX);
      }
      if (points.rawY !== undefined && points.rawY !== 0) {
        drawPoint(points.rawY, points.expoY, '#4caf50', 'Y', currentExpoY);
      }
    }

    // Подписи осей
    expoCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    expoCtx.font = '9px sans-serif';
    expoCtx.fillText('IN', w - padding - 12, h - padding + 10);
    expoCtx.fillText('OUT', padding - 2, padding + 10);
  }

  // ============================================================
  // 🧩 APP STATE — единый стейт (SSOT)
  // ============================================================

  const AppState = {
    processors: {
      scene:  { enabled: false, instance: null, count: CVProcessor.LAYER_COUNT },
      motion: { enabled: false, instance: null, count: MotionDetector.LAYER_COUNT }
    },
    layers: [],  // заполняется в initLayers()

    // UI-флаги (инициализируются из AppConfig в initLayers)
    baseLayer: true,          // базовый слой (видео) виден
    motionDesaturate: false,
    motionOsd: true,
  };

  let compositor = null;
  let cvReady = false;

  /** Инициализация массива layers (один раз) */
  function initLayers() {
    const cfg = window.AppConfig;
    const layers = [];

    // Scene: 6 слоёв (localIndex 0..5)
    const sceneLabels = ['Gray', 'Edges', 'Lines', 'Horizon', 'Grid', 'Walls'];
    const sceneDefaults = [false, false, false,
      cfg.CV.showHorizon !== false,
      cfg.CV.showGrid !== false,
      cfg.CV.showWalls !== false
    ];
    for (let i = 0; i < AppState.processors.scene.count; i++) {
      layers.push({
        processorId: 'scene',
        localIndex: i,
        enabled: sceneDefaults[i],
        label: sceneLabels[i]
      });
    }

    // Motion: 3 слоя (localIndex 0..2)
    const motionLabels = ['Mask', 'Contours', 'BB'];
    const motionDefaults = [
      cfg.MOTION.showPixels !== false,
      cfg.MOTION.showContours === true,
      cfg.MOTION.showBoxes !== false
    ];
    for (let i = 0; i < AppState.processors.motion.count; i++) {
      layers.push({
        processorId: 'motion',
        localIndex: i,
        enabled: motionDefaults[i],
        label: motionLabels[i]
      });
    }

    AppState.layers = layers;

    // UI-флаги из конфига
    AppState.baseLayer = cfg.BASE_LAYER ? cfg.BASE_LAYER.visible !== false : true;
    AppState.motionDesaturate = cfg.MOTION.showDesaturate === true;
    AppState.motionOsd = cfg.MOTION.showOSD !== false;
  }

  // ============================================================
  // 👁️ OpenCV.js — загрузка
  // ============================================================

  async function checkAndSetCVReady() {
    if (cvReady) return;
    try {
      if (typeof cv === 'undefined') return;
      if (cv instanceof Promise || typeof cv === 'function') {
        cv = await cv;
      }
      if (!cv.Mat) {
        const checkInterval = setInterval(() => {
          if (typeof cv !== 'undefined' && cv.Mat) {
            clearInterval(checkInterval);
            setCVReady();
          }
        }, 1000);
        return;
      }
      setCVReady();
    } catch (e) {
      console.warn('⏳ OpenCV.js not ready yet:', e.message);
    }
  }

  function setCVReady() {
    if (cvReady) return;
    cvReady = true;

    const cvBtn = document.getElementById('cv-btn');
    const motionBtn = document.getElementById('motion-btn');
    if (cvBtn) cvBtn.classList.remove('loading');
    if (motionBtn) motionBtn.classList.remove('loading');

    console.log('✅ OpenCV.js loaded');
  }

  // ============================================================
  // 🖼️ BASE LAYER — видимость базового видеослоя
  // ============================================================

  function initBaseLayer() {
    const btn = document.getElementById('base-layer-btn');
    if (!btn) return;

    // Начальное состояние из AppState
    applyBaseLayer();
    btn.classList.toggle('active', AppState.baseLayer);

    btn.addEventListener('click', toggleBaseLayer);
    console.log('🖼️ Base layer initialized');
  }

  function toggleBaseLayer() {
    AppState.baseLayer = !AppState.baseLayer;
    applyBaseLayer();

    const btn = document.getElementById('base-layer-btn');
    if (btn) btn.classList.toggle('active', AppState.baseLayer);

    console.log(`🖼️ Base layer: ${AppState.baseLayer ? 'visible' : 'hidden'}`);
  }

  /** Применить состояние baseLayer к DOM */
  function applyBaseLayer() {
    const container = document.querySelector('.video-container');
    if (!container) return;
    container.classList.toggle('base-hidden', !AppState.baseLayer);
  }

  // ============================================================
  // 👁️ SCENE (CVProcessor) — init + toggle
  // ============================================================

  function initScene() {
    const cvBtn = document.getElementById('cv-btn');
    if (!cvBtn) return;

    cvBtn.addEventListener('click', toggleScene);
    cvBtn.classList.add('loading');
    cvBtn.title = 'OpenCV.js загружается...';

    checkAndSetCVReady();
    window.addEventListener('opencv-ready', () => checkAndSetCVReady());

    // Привязка слайдеров Scene
    initSceneSliders();

    console.log('👁️ Scene module initialized (waiting for OpenCV.js)');
  }

  function initSceneSliders() {
    const sliders = [
      { id: 'scene-canny-low',     valId: 'scene-canny-low-val',     key: 'cannyLow' },
      { id: 'scene-canny-high',    valId: 'scene-canny-high-val',    key: 'cannyHigh' },
      { id: 'scene-hough-thresh',  valId: 'scene-hough-thresh-val',  key: 'houghThreshold' },
      { id: 'scene-hough-minlen',  valId: 'scene-hough-minlen-val',  key: 'houghMinLength' },
      { id: 'scene-hough-maxgap',  valId: 'scene-hough-maxgap-val',  key: 'houghMaxGap' },
      { id: 'scene-horizon-angle', valId: 'scene-horizon-angle-val', key: 'horizonMaxAngle' },
      { id: 'scene-wall-tol',      valId: 'scene-wall-tol-val',      key: 'wallAngleTolerance' },
      { id: 'scene-smooth',        valId: 'scene-smooth-val',        key: 'smoothFrames' },
      { id: 'scene-interval',      valId: 'scene-interval-val',      key: 'processInterval' },
    ];

    for (const s of sliders) {
      const slider = document.getElementById(s.id);
      const valEl = document.getElementById(s.valId);
      if (!slider) continue;

      // Установить начальные значения из конфига
      const cfgVal = window.AppConfig.CV[s.key];
      if (cfgVal !== undefined) {
        slider.value = cfgVal;
        if (valEl) valEl.textContent = cfgVal;
      }

      slider.addEventListener('input', () => {
        const val = parseInt(slider.value);
        if (valEl) valEl.textContent = val;
        const proc = AppState.processors.scene.instance;
        if (proc) proc.updateConfig({ [s.key]: val });
      });
    }
  }

  function toggleScene() {
    const cvBtn = document.getElementById('cv-btn');
    const settingsSection = document.getElementById('scene-settings-section');

    if (!cvReady) {
      console.warn('OpenCV.js not ready yet');
      if (cvBtn) cvBtn.title = 'OpenCV.js ещё загружается...';
      return;
    }

    const proc = AppState.processors.scene;
    const activeVideo = getActiveVideoElement();

    // Пересоздаём процессор если источник изменился
    if (proc.instance && proc.instance.video !== activeVideo) {
      proc.instance.stop();
      proc.instance = null;
    }

    if (!proc.instance) {
      proc.instance = new CVProcessor(activeVideo, {
        ...window.AppConfig.CV,
        onError: (err) => console.error('Scene error:', err)
      });
    }

    // Toggle
    if (proc.enabled) {
      proc.instance.stop();
      proc.enabled = false;
    } else {
      proc.instance.start();
      proc.enabled = true;
    }

    if (cvBtn) {
      cvBtn.classList.toggle('active', proc.enabled);
      cvBtn.title = proc.enabled ? 'Scene включён' : 'Scene выключён';
    }
    if (settingsSection) {
      settingsSection.style.display = proc.enabled ? 'block' : 'none';
    }

    // Запуск/остановка композитора
    ensureCompositor();

    console.log(`👁️ Scene ${proc.enabled ? 'started' : 'stopped'}`);
  }

  // ============================================================
  // 🔴 MOTION (MotionDetector) — init + toggle
  // ============================================================

  function initMotion() {
    const motionBtn = document.getElementById('motion-btn');
    if (!motionBtn) return;

    motionBtn.addEventListener('click', toggleMotion);

    if (!cvReady) {
      motionBtn.classList.add('loading');
      motionBtn.title = 'OpenCV.js загружается...';
    }

    initMotionSettings();
    console.log('🔴 Motion module initialized');
  }

  function initMotionSettings() {
    // Десатурация
    const desatToggle = document.getElementById('motion-desaturate-toggle');
    if (desatToggle) {
      // Начальное состояние из AppState (SSOT)
      desatToggle.classList.toggle('active', AppState.motionDesaturate);
      desatToggle.textContent = AppState.motionDesaturate ? 'ON' : 'OFF';

      desatToggle.addEventListener('click', () => {
        AppState.motionDesaturate = !AppState.motionDesaturate;
        desatToggle.classList.toggle('active', AppState.motionDesaturate);
        desatToggle.textContent = AppState.motionDesaturate ? 'ON' : 'OFF';
        applyDesaturation(AppState.motionDesaturate);
      });
    }

    // OSD Motion виджет
    const osdToggle = document.getElementById('motion-osd-toggle');
    if (osdToggle) {
      // Начальное состояние из AppState (SSOT)
      osdToggle.classList.toggle('active', AppState.motionOsd);
      osdToggle.textContent = AppState.motionOsd ? 'ON' : 'OFF';

      osdToggle.addEventListener('click', () => {
        AppState.motionOsd = !AppState.motionOsd;
        osdToggle.classList.toggle('active', AppState.motionOsd);
        osdToggle.textContent = AppState.motionOsd ? 'ON' : 'OFF';
        const widget = document.getElementById('osd-motion-widget');
        const proc = AppState.processors.motion;
        if (widget) widget.style.display = AppState.motionOsd && proc.enabled ? '' : 'none';
      });
    }

    // Слайдеры Motion
    const motionSliders = [
      { id: 'motion-threshold-slider', valId: 'motion-threshold-value', method: 'setThreshold' },
      { id: 'motion-minarea-slider',   valId: 'motion-minarea-value',   method: 'setMinArea' },
      { id: 'motion-blur-slider',      valId: 'motion-blur-value',      method: 'setBlurSize' },
      { id: 'motion-dilate-slider',    valId: 'motion-dilate-value',    method: 'setDilateIterations' },
    ];

    for (const s of motionSliders) {
      const slider = document.getElementById(s.id);
      const valEl = document.getElementById(s.valId);
      if (!slider) continue;

      slider.addEventListener('input', () => {
        const val = parseInt(slider.value);
        if (valEl) valEl.textContent = val;
        const proc = AppState.processors.motion.instance;
        if (proc && typeof proc[s.method] === 'function') {
          proc[s.method](val);
        }
      });
    }
  }

  function toggleMotion() {
    const motionBtn = document.getElementById('motion-btn');
    const settingsSection = document.getElementById('motion-settings-section');

    if (!cvReady) {
      console.warn('OpenCV.js not ready yet');
      if (motionBtn) motionBtn.title = 'OpenCV.js ещё загружается...';
      return;
    }

    const proc = AppState.processors.motion;
    const activeVideo = getActiveVideoElement();

    // Пересоздаём процессор если источник изменился
    if (proc.instance && proc.instance.video !== activeVideo) {
      proc.instance.stop();
      proc.instance = null;
    }

    if (!proc.instance) {
      proc.instance = new MotionDetector(activeVideo, {
        ...window.AppConfig.MOTION,
        onMotion: (result) => updateMotionOSD(result),
        onError: (err) => console.error('Motion error:', err)
      });
    }

    // Toggle
    if (proc.enabled) {
      proc.instance.stop();
      proc.enabled = false;
    } else {
      proc.instance.start();
      proc.enabled = true;
    }

    if (motionBtn) {
      motionBtn.classList.toggle('active', proc.enabled);
      motionBtn.title = proc.enabled ? 'Motion включён' : 'Motion выключён';
    }
    if (settingsSection) {
      settingsSection.style.display = proc.enabled ? 'block' : 'none';
    }

    // OSD виджет
    const osdWidget = document.getElementById('osd-motion-widget');
    if (osdWidget) {
      osdWidget.style.display = (proc.enabled && AppState.motionOsd) ? '' : 'none';
    }

    // Десатурация
    if (!proc.enabled && AppState.motionDesaturate) {
      applyDesaturation(false);
    } else if (proc.enabled && AppState.motionDesaturate) {
      applyDesaturation(true);
    }

    ensureCompositor();

    console.log(`🔴 Motion ${proc.enabled ? 'started' : 'stopped'}`);
  }

  function applyDesaturation(enabled) {
    const filter = enabled ? 'grayscale(0.8) brightness(1.2)' : '';
    videoFeed.style.filter = filter;
    videoLocal.style.filter = filter;
  }

  function updateMotionOSD(result) {
    if (!AppState.motionOsd) return;
    const percentEl = document.getElementById('osd-motion-percent');
    const regionsEl = document.getElementById('osd-motion-regions');
    if (percentEl) percentEl.textContent = result.motionPercent.toFixed(1) + '%';
    if (regionsEl) regionsEl.textContent = result.regionCount;
  }

  // ============================================================
  // 🎬 COMPOSITOR — управление
  // ============================================================

  /** Запуск/остановка композитора в зависимости от включённых процессоров */
  function ensureCompositor() {
    const anyEnabled = Object.values(AppState.processors).some(p => p.enabled);

    if (anyEnabled && !compositor) {
      const canvas = document.getElementById('compositor-overlay');
      if (!canvas) return;
      compositor = new Compositor(canvas, AppState);
      compositor.start();
    } else if (anyEnabled && compositor && !compositor.isRunning()) {
      compositor.start();
    } else if (!anyEnabled && compositor) {
      compositor.stop();
    }

    // Обновляем tile UI при каждом изменении
    updateLayerTileUI();
  }

  // ============================================================
  // 🎛️ LAYER TILES — клик = toggle, глазик = solo
  // ============================================================

  function initLayerTiles() {
    // Клик по плитке = toggle enabled
    document.querySelectorAll('.layer-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        // Не реагировать на клик по глазику
        if (e.target.closest('.layer-eye-btn')) return;

        const idx = parseInt(tile.dataset.layerIdx);
        if (isNaN(idx) || idx >= AppState.layers.length) return;

        AppState.layers[idx].enabled = !AppState.layers[idx].enabled;
        updateLayerTileUI();
      });
    });

    // Клик по глазику = solo
    document.querySelectorAll('.layer-eye-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.layerIdx);
        if (isNaN(idx) || idx >= AppState.layers.length) return;

        // Solo: всем false, этому true
        AppState.layers.forEach(l => l.enabled = false);
        AppState.layers[idx].enabled = true;
        updateLayerTileUI();
      });
    });
  }

  /** Обновление визуального состояния плиток (active/solo/off) */
  function updateLayerTileUI() {
    const layers = AppState.layers;
    const enabledCount = layers.filter(l => l.enabled).length;
    const isSolo = enabledCount === 1;

    const cfg = window.AppConfig.LAYERS || {};
    const colorActive = cfg.borderActive || '#4CAF50';
    const colorSolo   = cfg.borderSolo   || '#FFC107';
    const colorOff    = cfg.borderOff    || 'rgba(255,255,255,0.15)';

    for (let i = 0; i < layers.length; i++) {
      const tile = document.querySelector(`.layer-tile[data-layer-idx="${i}"]`);
      if (!tile) continue;

      const entry = layers[i];
      tile.classList.remove('active', 'solo', 'off');

      if (entry.enabled && isSolo) {
        tile.classList.add('solo');
        tile.style.borderColor = colorSolo;
      } else if (entry.enabled) {
        tile.classList.add('active');
        tile.style.borderColor = colorActive;
      } else {
        tile.classList.add('off');
        tile.style.borderColor = colorOff;
      }
    }
  }

  // ============================================================
  // 📊 OSD — On-Screen Display (телеметрия поверх видео)
  // ============================================================
  //
  // Виджеты отображаются в 4-х углах видео (DJI FPV-style).
  // Данные запрашиваются polling'ом из /api/status.
  // Тогглер и интервал настраиваются в панели настроек.
  //
  // ============================================================

  let osdEnabled = true;
  let osdPollTimer = null;
  let osdIntervalMs = 5000;

  /**
   * Инициализация OSD: тогглер, слайдер интервала, старт polling'а
   */
  function initOSD() {
    const toggle = document.getElementById('osd-toggle');
    const slider = document.getElementById('osd-interval-slider');
    const valueEl = document.getElementById('osd-interval-value');
    const overlay = document.getElementById('osd-overlay');

    // Читаем конфиг
    osdEnabled = window.AppConfig.OSD ? window.AppConfig.OSD.enabled : true;
    osdIntervalMs = window.AppConfig.OSD ? window.AppConfig.OSD.pollIntervalSec * 1000 : 5000;

    // Тогглер ON/OFF
    if (toggle) {
      toggle.textContent = osdEnabled ? 'ON' : 'OFF';
      toggle.classList.toggle('active', osdEnabled);

      toggle.addEventListener('click', () => {
        osdEnabled = !osdEnabled;
        toggle.textContent = osdEnabled ? 'ON' : 'OFF';
        toggle.classList.toggle('active', osdEnabled);

        if (overlay) overlay.classList.toggle('hidden', !osdEnabled);

        if (osdEnabled) {
          osdStartPolling();
          osdFetchStatus(); // немедленный запрос при включении
        } else {
          osdStopPolling();
        }

        console.log(`📊 OSD: ${osdEnabled ? 'ON' : 'OFF'}`);
      });
    }

    // Ползунок интервала (1-10 сек)
    if (slider) {
      slider.value = osdIntervalMs / 1000;
      if (valueEl) valueEl.textContent = (osdIntervalMs / 1000) + ' сек';

      slider.addEventListener('input', () => {
        const sec = parseInt(slider.value);
        osdIntervalMs = sec * 1000;
        if (valueEl) valueEl.textContent = sec + ' сек';

        // Перезапуск polling'а с новым интервалом
        if (osdEnabled) {
          osdStopPolling();
          osdStartPolling();
        }
      });
    }

    // Начальное состояние overlay
    if (overlay && !osdEnabled) overlay.classList.add('hidden');

    // Запуск polling'а если включён
    if (osdEnabled) {
      osdStartPolling();
      osdFetchStatus();
    }

    console.log('📊 OSD initialized (interval: ' + (osdIntervalMs / 1000) + 's)');
  }

  /**
   * Запуск periodic polling
   */
  function osdStartPolling() {
    osdStopPolling();
    osdPollTimer = setInterval(osdFetchStatus, osdIntervalMs);
  }

  /**
   * Остановка polling
   */
  function osdStopPolling() {
    if (osdPollTimer) {
      clearInterval(osdPollTimer);
      osdPollTimer = null;
    }
  }

  /**
   * Запрос /api/status и обновление OSD-виджетов
   */
  function osdFetchStatus() {
    if (!osdEnabled) return;

    const url = window.AppConfig.getApiUrl(
      window.AppConfig.STATUS_API || '/api/status'
    );

    fetch(url)
      .then(r => r.json())
      .then(data => updateOSD(data))
      .catch(err => {
        console.warn('📊 OSD fetch error:', err.message);
      });
  }

  /**
   * Обновление DOM-элементов OSD из JSON-данных
   * @param {object} data - Ответ от /api/status
   */
  function updateOSD(data) {
    // --- Верхний левый: WiFi / RSSI ---
    const rssiEl = document.getElementById('osd-rssi');
    const ipEl = document.getElementById('osd-ip');

    if (rssiEl && data.rssi !== undefined) {
      rssiEl.textContent = data.rssi;
      // Цветовая индикация
      rssiEl.className = '';
      if (data.rssi > -60) rssiEl.className = 'osd-rssi-good';
      else if (data.rssi > -75) rssiEl.className = 'osd-rssi-mid';
      else rssiEl.className = 'osd-rssi-bad';
    }
    if (ipEl) ipEl.textContent = data.ip || '—';

    // --- Верхний правый: Uptime + память ---
    const uptimeEl = document.getElementById('osd-uptime');
    const heapEl = document.getElementById('osd-heap');
    const psramEl = document.getElementById('osd-psram');

    if (uptimeEl && data.uptime !== undefined) {
      uptimeEl.textContent = formatUptime(data.uptime);
    }
    if (heapEl && data.heap !== undefined) {
      const heapKB = (data.heap / 1024).toFixed(1);
      heapEl.textContent = heapKB + ' KB';
      heapEl.className = data.heap < 20480 ? 'osd-heap-low' : '';
    }
    if (psramEl && data.psram !== undefined) {
      const psramMB = (data.psram / (1024 * 1024)).toFixed(1);
      psramEl.textContent = psramMB + ' MB';
    }

    // --- Нижний левый: Моторы ---
    const flEl = document.getElementById('osd-fl');
    const frEl = document.getElementById('osd-fr');
    const rlEl = document.getElementById('osd-rl');
    const rrEl = document.getElementById('osd-rr');

    if (data.motors) {
      if (flEl) flEl.textContent = data.motors.fl;
      if (frEl) frEl.textContent = data.motors.fr;
      if (rlEl) rlEl.textContent = data.motors.rl;
      if (rrEl) rrEl.textContent = data.motors.rr;
    }

    // --- Нижний правый: Clients + LED + CPU ---
    const clientsEl = document.getElementById('osd-clients');
    const ledEl = document.getElementById('osd-led');
    const cpuEl = document.getElementById('osd-cpu');

    if (clientsEl) clientsEl.textContent = data.stream_clients !== undefined ? data.stream_clients : '—';
    if (ledEl) ledEl.textContent = data.led ? 'ON' : 'OFF';
    if (cpuEl) cpuEl.textContent = data.cpu_mhz || '—';
  }

  /**
   * Форматирование uptime (мс → ЧЧ:ММ:СС)
   * @param {number} ms - Миллисекунды
   * @returns {string} Форматированное время
   */
  function formatUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  // === Запуск ===
  document.addEventListener('DOMContentLoaded', () => {
    init();
    initDriveControls();
    initJoysticks();
    initSettings();
    initLayers();         // SSOT: формируем массив layers + UI-флаги
    initBaseLayer();      // Base layer (видео) toggle
    initScene();          // Scene (бывший CV)
    initMotion();         // Motion
    initLayerTiles();     // Плитки слоёв (toggle + solo)
    updateLayerTileUI();  // Начальное состояние плиток
    initOSD();
  });
})();

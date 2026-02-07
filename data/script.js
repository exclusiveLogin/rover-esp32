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
  // 👁️ COMPUTER VISION (OpenCV.js)
  // ============================================================

  let cvProcessor = null;
  let cvReady = false;

  /**
   * Проверка и установка cvReady
   * Вызывается при DOMContentLoaded (если cv уже в кэше)
   * и по событию opencv-ready (если загрузился позже).
   * Безопасно вызывать многократно — сработает один раз.
   */
  async function checkAndSetCVReady() {
    if (cvReady) return;  // уже готов

    try {
      if (typeof cv === 'undefined') return;

      // OpenCV.js 4.5+ WASM: cv — это Promise, нужно await
      if (cv instanceof Promise || typeof cv === 'function') {
        cv = await cv;
      }

      if (!cv.Mat) {
        // WASM ещё инициализируется — ждём через polling
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

  /**
   * Финальная установка cvReady = true + обновление UI
   */
  function setCVReady() {
    if (cvReady) return;
    cvReady = true;

    const cvBtn = document.getElementById('cv-btn');
    const motionBtn = document.getElementById('motion-btn');
    const debugSection = document.getElementById('cv-debug-section');

    if (cvBtn) {
      cvBtn.classList.remove('loading');
    }
    if (motionBtn) {
      motionBtn.classList.remove('loading');
    }
    if (debugSection) {
      debugSection.style.display = 'block';
    }

    console.log('✅ OpenCV.js loaded');
  }

  /**
   * Инициализация CV
   */
  function initCV() {
    const cvBtn = document.getElementById('cv-btn');
    const cvOverlay = document.getElementById('cv-overlay');
    
    if (!cvBtn || !cvOverlay) {
      console.warn('CV elements not found');
      return;
    }

    // Кнопка CV
    cvBtn.addEventListener('click', toggleCV);
    
    // Пометим кнопку как "загружается"
    cvBtn.classList.add('loading');
    cvBtn.title = 'OpenCV.js загружается...';

    // Проверяем OpenCV: может быть уже загружен из кэша
    // (onload события могло прийти ДО DOMContentLoaded)
    checkAndSetCVReady();

    // Слушаем событие на случай если ещё не загружен
    window.addEventListener('opencv-ready', () => checkAndSetCVReady());
    
    // Инициализация CV Debug panel
    initCVDebug();

    console.log('👁️ CV module initialized (waiting for OpenCV.js)');
  }
  
  /**
   * Инициализация CV Debug панели
   */
  function initCVDebug() {
    const debugToggle = document.getElementById('cv-debug-toggle');
    const debugGrid = document.getElementById('cv-debug-grid');
    
    if (!debugToggle || !debugGrid) return;
    
    debugToggle.addEventListener('click', () => {
      const isActive = debugToggle.dataset.active === 'true';
      const newState = !isActive;
      
      // Обновляем UI
      debugToggle.dataset.active = newState;
      debugToggle.textContent = newState ? 'ON' : 'OFF';
      debugGrid.style.display = newState ? 'grid' : 'none';
      
      // Применяем к CVProcessor
      if (cvProcessor) {
        cvProcessor.setDebug(newState);
        
        // При первом включении устанавливаем debug canvases
        if (newState && !cvProcessor._debugCanvases.gray) {
          cvProcessor.setDebugCanvases({
            gray: document.getElementById('cv-debug-gray'),
            edges: document.getElementById('cv-debug-edges'),
            lines: document.getElementById('cv-debug-lines')
          });
        }
      }
      
      console.log(`👁️ CV Debug: ${newState ? 'ON' : 'OFF'}`);
    });
  }

  /**
   * Включение/выключение CV
   */
  function toggleCV() {
    const cvBtn = document.getElementById('cv-btn');
    const cvOverlay = document.getElementById('cv-overlay');
    
    if (!cvReady) {
      console.warn('OpenCV.js not ready yet');
      cvBtn.title = 'OpenCV.js ещё загружается...';
      return;
    }

    // Получаем текущий активный видео-элемент
    const activeVideo = getActiveVideoElement();

    // Пересоздаём процессор если источник изменился
    if (cvProcessor && cvProcessor.video !== activeVideo) {
      cvProcessor.stop();
      cvProcessor = null;
    }

    if (!cvProcessor) {
      // Создаём процессор с текущим источником
      cvProcessor = new CVProcessor(activeVideo, cvOverlay, {
        ...window.AppConfig.CV,
        onProcess: (result) => {
          // Можно добавить обработку результатов
        },
        onError: (err) => {
          console.error('CV error:', err);
        }
      });
      
      // Применяем текущее состояние debug
      const debugToggle = document.getElementById('cv-debug-toggle');
      if (debugToggle && debugToggle.dataset.active === 'true') {
        cvProcessor.setDebug(true);
        cvProcessor.setDebugCanvases({
          gray: document.getElementById('cv-debug-gray'),
          edges: document.getElementById('cv-debug-edges'),
          lines: document.getElementById('cv-debug-lines')
        });
      }
    }

    // Toggle
    const isRunning = cvProcessor.toggle();
    cvBtn.classList.toggle('active', isRunning);
    cvBtn.title = isRunning ? 'CV включён' : 'CV выключён';
    
    console.log(`👁️ CV ${isRunning ? 'started' : 'stopped'} (source: ${isWebcamActive ? 'webcam' : 'stream'})`);
  }

  // ============================================================
  // 🔴 MOTION DETECTION (OpenCV.js)
  // ============================================================

  let motionDetector = null;
  let motionOsdEnabled = true;
  let motionDesaturateEnabled = false;

  /**
   * Инициализация Motion Detection
   */
  function initMotion() {
    const motionBtn = document.getElementById('motion-btn');
    if (!motionBtn) return;

    // Кнопка Motion
    motionBtn.addEventListener('click', toggleMotion);

    // Пометим кнопку как "загружается" (ждёт OpenCV)
    // setCVReady() снимет loading когда OpenCV будет готов
    if (!cvReady) {
      motionBtn.classList.add('loading');
      motionBtn.title = 'OpenCV.js загружается...';
    }

    // Настройки Motion Detection
    initMotionSettings();

    console.log('🔴 Motion module initialized');
  }

  /**
   * Инициализация настроек Motion Detection
   */
  function initMotionSettings() {
    // Тоггл: Пиксели
    const pixelsToggle = document.getElementById('motion-pixels-toggle');
    if (pixelsToggle) {
      pixelsToggle.addEventListener('click', () => {
        const isActive = pixelsToggle.classList.contains('active');
        pixelsToggle.classList.toggle('active', !isActive);
        pixelsToggle.textContent = isActive ? 'OFF' : 'ON';
        if (motionDetector) motionDetector.setLayer('pixels', !isActive);
      });
    }

    // Тоггл: BB рамки
    const boxesToggle = document.getElementById('motion-boxes-toggle');
    if (boxesToggle) {
      boxesToggle.addEventListener('click', () => {
        const isActive = boxesToggle.classList.contains('active');
        boxesToggle.classList.toggle('active', !isActive);
        boxesToggle.textContent = isActive ? 'OFF' : 'ON';
        if (motionDetector) motionDetector.setLayer('boxes', !isActive);
      });
    }

    // Тоггл: Контуры (силуэты)
    const contoursToggle = document.getElementById('motion-contours-toggle');
    if (contoursToggle) {
      contoursToggle.addEventListener('click', () => {
        const isActive = contoursToggle.classList.contains('active');
        contoursToggle.classList.toggle('active', !isActive);
        contoursToggle.textContent = isActive ? 'OFF' : 'ON';
        if (motionDetector) motionDetector.setLayer('contours', !isActive);
      });
    }

    // Тоггл: Десатурация (CSS filter на видео)
    const desatToggle = document.getElementById('motion-desaturate-toggle');
    if (desatToggle) {
      desatToggle.addEventListener('click', () => {
        motionDesaturateEnabled = !motionDesaturateEnabled;
        desatToggle.classList.toggle('active', motionDesaturateEnabled);
        desatToggle.textContent = motionDesaturateEnabled ? 'ON' : 'OFF';
        applyDesaturation(motionDesaturateEnabled);
      });
    }

    // Тоггл: OSD Motion виджет
    const osdToggle = document.getElementById('motion-osd-toggle');
    if (osdToggle) {
      osdToggle.addEventListener('click', () => {
        motionOsdEnabled = !motionOsdEnabled;
        osdToggle.classList.toggle('active', motionOsdEnabled);
        osdToggle.textContent = motionOsdEnabled ? 'ON' : 'OFF';
        const widget = document.getElementById('osd-motion-widget');
        if (widget) widget.style.display = motionOsdEnabled && motionDetector?.isRunning() ? '' : 'none';
      });
    }

    // Слайдер: Порог
    const threshSlider = document.getElementById('motion-threshold-slider');
    const threshValue = document.getElementById('motion-threshold-value');
    if (threshSlider) {
      threshSlider.addEventListener('input', () => {
        const val = parseInt(threshSlider.value);
        if (threshValue) threshValue.textContent = val;
        if (motionDetector) motionDetector.setThreshold(val);
      });
    }

    // Слайдер: Мин. область
    const areaSlider = document.getElementById('motion-minarea-slider');
    const areaValue = document.getElementById('motion-minarea-value');
    if (areaSlider) {
      areaSlider.addEventListener('input', () => {
        const val = parseInt(areaSlider.value);
        if (areaValue) areaValue.textContent = val;
        if (motionDetector) motionDetector.setMinArea(val);
      });
    }

    // Слайдер: Сглаживание (blurSize)
    const blurSlider = document.getElementById('motion-blur-slider');
    const blurValue = document.getElementById('motion-blur-value');
    if (blurSlider) {
      blurSlider.addEventListener('input', () => {
        const val = parseInt(blurSlider.value);
        if (blurValue) blurValue.textContent = val;
        if (motionDetector) motionDetector.setBlurSize(val);
      });
    }

    // Слайдер: Расширение (dilateIterations)
    const dilateSlider = document.getElementById('motion-dilate-slider');
    const dilateValue = document.getElementById('motion-dilate-value');
    if (dilateSlider) {
      dilateSlider.addEventListener('input', () => {
        const val = parseInt(dilateSlider.value);
        if (dilateValue) dilateValue.textContent = val;
        if (motionDetector) motionDetector.setDilateIterations(val);
      });
    }
  }

  /**
   * Включение/выключение Motion Detection
   */
  function toggleMotion() {
    const motionBtn = document.getElementById('motion-btn');
    const motionOverlay = document.getElementById('motion-overlay');
    const settingsSection = document.getElementById('motion-settings-section');

    if (!cvReady) {
      console.warn('OpenCV.js not ready yet');
      if (motionBtn) motionBtn.title = 'OpenCV.js ещё загружается...';
      return;
    }

    // Получаем текущий активный видео-элемент
    const activeVideo = getActiveVideoElement();

    // Пересоздаём детектор если источник изменился
    if (motionDetector && motionDetector.video !== activeVideo) {
      motionDetector.stop();
      motionDetector = null;
    }

    if (!motionDetector) {
      motionDetector = new MotionDetector(activeVideo, motionOverlay, {
        ...window.AppConfig.MOTION,
        onMotion: (result) => {
          updateMotionOSD(result);
        },
        onError: (err) => {
          console.error('Motion error:', err);
        }
      });
    }

    // Toggle
    const isRunning = motionDetector.toggle();
    if (motionBtn) {
      motionBtn.classList.toggle('active', isRunning);
      motionBtn.title = isRunning ? 'Motion Detection включён' : 'Motion Detection выключён';
    }

    // Показ/скрытие настроек
    if (settingsSection) {
      settingsSection.style.display = isRunning ? 'block' : 'none';
    }

    // OSD виджет
    const osdWidget = document.getElementById('osd-motion-widget');
    if (osdWidget) {
      osdWidget.style.display = (isRunning && motionOsdEnabled) ? '' : 'none';
    }

    // Десатурация: снимаем при выключении
    if (!isRunning && motionDesaturateEnabled) {
      applyDesaturation(false);
    } else if (isRunning && motionDesaturateEnabled) {
      applyDesaturation(true);
    }

    console.log(`🔴 Motion ${isRunning ? 'started' : 'stopped'} (source: ${isWebcamActive ? 'webcam' : 'stream'})`);
  }

  /**
   * Применить/убрать десатурацию на видео-элементе (CSS filter)
   */
  function applyDesaturation(enabled) {
    const filter = enabled ? 'grayscale(0.8) brightness(1.2)' : '';
    videoFeed.style.filter = filter;
    videoLocal.style.filter = filter;
  }

  /**
   * Обновление OSD виджета Motion
   */
  function updateMotionOSD(result) {
    if (!motionOsdEnabled) return;

    const percentEl = document.getElementById('osd-motion-percent');
    const regionsEl = document.getElementById('osd-motion-regions');

    if (percentEl) percentEl.textContent = result.motionPercent.toFixed(1) + '%';
    if (regionsEl) regionsEl.textContent = result.regionCount;
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
    initCV();
    initMotion();
    initOSD();
  });
})();

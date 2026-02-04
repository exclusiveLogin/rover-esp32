/**
 * ESP32-CAM Rover Client
 */
(function() {
  'use strict';

  // === Элементы DOM ===
  const videoFeed = document.getElementById('video-feed');
  const videoOverlay = document.getElementById('video-overlay');
  const streamToggle = document.getElementById('stream-toggle');
  const photoBtn = document.getElementById('photo-btn');
  const ledBtn = document.getElementById('led-btn');
  const connectionStatus = document.getElementById('connection-status');
  const streamUrlDisplay = document.getElementById('stream-url');
  const streamStatusDisplay = document.getElementById('stream-status');

  // === Конфигурация ===
  const STREAM_PORT = 81;
  const RECONNECT_DELAY = 3000;
  const streamUrl = `http://${location.hostname}:${STREAM_PORT}/stream`;

  // === Состояние ===
  let isStreaming = false;
  let ledState = false;
  let reconnectTimer = null;

  // === Инициализация ===
  function init() {
    streamUrlDisplay.textContent = streamUrl;
    
    // События кнопок
    streamToggle.addEventListener('click', toggleStream);
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
        videoFeed.src = streamUrl + '?t=' + Date.now();
      }
    }, RECONNECT_DELAY);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // === ФОТО ===
  function takePhoto() {
    const photoUrl = '/photo?t=' + Date.now();
    
    // Временно останавливаем стрим, показываем фото
    const wasStreaming = isStreaming;
    if (wasStreaming) stopStream();
    
    showOverlay('Получение снимка...');
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
    fetch('/led')
      .then(r => r.json())
      .then(data => {
        ledState = data.state || false;
        updateLedUI();
      })
      .catch(() => {});
  }

  function toggleLed() {
    fetch('/led/toggle', { method: 'POST' })
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

  const DRIVE_API = '/api/drive';
  const STEP_VALUE = 25;  // Шаг изменения скорости

  function fetchDriveState() {
    fetch(DRIVE_API)
      .then(r => r.json())
      .then(updateDriveUI)
      .catch(err => console.error('Drive API error:', err));
  }

  function sendDriveCommand(action, motor, value = STEP_VALUE) {
    fetch(DRIVE_API, {
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
    controlService = new ControlService('/api/control');

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
    const xEl = document.getElementById('joy-x');
    const yEl = document.getElementById('joy-y');
    const activeEl = document.getElementById('joy-active');
    const statusEl = document.getElementById('control-status');

    if (xEl) xEl.textContent = state.x;
    if (yEl) yEl.textContent = state.y;
    if (activeEl) activeEl.textContent = state.active ? '🟢' : '⚪';
    
    // Статус
    if (statusEl) {
      statusEl.classList.remove('error', 'pending');
      
      if (state.error) {
        statusEl.textContent = state.error;
        statusEl.classList.add('error');
      } else if (state.pending) {
        statusEl.textContent = '...';
        statusEl.classList.add('pending');
      } else if (state.active) {
        statusEl.textContent = `${state.x},${state.y}`;
      } else {
        statusEl.textContent = '';
      }
    }
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
      
      // Автоочистка через 3 сек
      setTimeout(() => {
        if (statusEl.textContent === message) {
          statusEl.textContent = '';
          statusEl.classList.remove('error');
        }
      }, 3000);
    }
  }

  // ============================================================
  // ⚙️ SETTINGS — Настройки управления
  // ============================================================

  let expoCanvas = null;
  let expoCtx = null;

  /**
   * Инициализация настроек
   */
  function initSettings() {
    // === Переключатель режимов ===
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setJoystickMode(mode);
        
        // UI
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // === Expo slider ===
    const slider = document.getElementById('expo-slider');
    const valueEl = document.getElementById('expo-value');
    const labelEl = document.getElementById('expo-label');
    
    if (slider) {
      slider.addEventListener('input', () => {
        const value = parseInt(slider.value);
        
        // Обновляем UI
        if (valueEl) valueEl.textContent = `${value}%`;
        if (labelEl) {
          if (value > 0) {
            labelEl.textContent = 'Мягкий центр';
          } else if (value < 0) {
            labelEl.textContent = 'Резкий центр';
          } else {
            labelEl.textContent = '—';
          }
        }
        
        // Применяем к ControlService
        if (controlService) {
          controlService.setExpo(value);
        }
        
        // Перерисовываем график
        drawExpoGraph(value / 100);
      });
    }

    // === Инициализация canvas для графика ===
    expoCanvas = document.getElementById('expo-graph');
    if (expoCanvas) {
      expoCtx = expoCanvas.getContext('2d');
      drawExpoGraph(0);
    }

    console.log('⚙️ Settings initialized');
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
   * Отрисовка графика expo кривой
   */
  function drawExpoGraph(expo) {
    if (!expoCtx || !expoCanvas) return;

    const w = expoCanvas.width;
    const h = expoCanvas.height;
    const padding = 10;

    // Очистка
    expoCtx.fillStyle = '#0f0f0f';
    expoCtx.fillRect(0, 0, w, h);

    // Сетка
    expoCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    expoCtx.lineWidth = 1;
    expoCtx.beginPath();
    // Вертикальная линия (центр)
    expoCtx.moveTo(w / 2, padding);
    expoCtx.lineTo(w / 2, h - padding);
    // Горизонтальная линия (центр)
    expoCtx.moveTo(padding, h / 2);
    expoCtx.lineTo(w - padding, h / 2);
    expoCtx.stroke();

    // Линейная кривая (эталон)
    expoCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    expoCtx.lineWidth = 1;
    expoCtx.beginPath();
    expoCtx.moveTo(padding, h - padding);
    expoCtx.lineTo(w - padding, padding);
    expoCtx.stroke();

    // Expo кривая
    expoCtx.strokeStyle = '#4a9eff';
    expoCtx.lineWidth = 2;
    expoCtx.beginPath();

    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const input = i / steps;  // 0..1
      const output = ControlService.calcExpoPoint(input, expo);
      
      const x = padding + input * (w - 2 * padding);
      const y = h - padding - output * (h - 2 * padding);
      
      if (i === 0) {
        expoCtx.moveTo(x, y);
      } else {
        expoCtx.lineTo(x, y);
      }
    }
    expoCtx.stroke();

    // Подписи осей
    expoCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    expoCtx.font = '9px sans-serif';
    expoCtx.fillText('IN', w - padding - 12, h - padding + 10);
    expoCtx.fillText('OUT', padding - 2, padding + 10);
  }

  // === Запуск ===
  document.addEventListener('DOMContentLoaded', () => {
    init();
    initDriveControls();
    initJoysticks();
    initSettings();
  });
})();

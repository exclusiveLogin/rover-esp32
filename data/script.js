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
  // 🎮 JOYSTICK (Виртуальный стик с автовозвратом)
  // ============================================================
  //
  // Поддерживает touch и mouse.
  // При отпускании — автовозврат в центр и отправка stop.
  // Отправляет данные на /api/control с type: "xy".
  //
  // ============================================================

  const CONTROL_API = '/api/control';
  const JOYSTICK_SEND_INTERVAL = 50;  // Интервал отправки (мс)

  let joystickActive = false;      // Активен ли джойстик
  let joystickX = 0;               // Текущая позиция X (-255..+255)
  let joystickY = 0;               // Текущая позиция Y (-255..+255)
  let joystickSendTimer = null;    // Таймер отправки
  let joystickArea = null;         // DOM элемент области
  let joystickStick = null;        // DOM элемент ручки
  let joystickRadius = 0;          // Радиус зоны движения

  // === SwitchMap паттерн: отмена предыдущих запросов ===
  // AbortController для отмены предыдущего fetch при новом запросе
  let controlAbortController = null;
  // Счётчик запросов для защиты от race condition
  let controlRequestId = 0;

  /**
   * Инициализация джойстика
   */
  function initJoystick() {
    joystickArea = document.getElementById('joystick-area');
    joystickStick = document.getElementById('joystick-stick');
    
    if (!joystickArea || !joystickStick) {
      console.warn('Joystick elements not found');
      return;
    }

    // Вычисляем радиус зоны (половина ширины минус радиус ручки)
    const areaRect = joystickArea.getBoundingClientRect();
    const stickSize = 70;  // Размер ручки из CSS
    joystickRadius = (areaRect.width / 2) - (stickSize / 2);

    // === Mouse события ===
    joystickArea.addEventListener('mousedown', onJoystickStart);
    document.addEventListener('mousemove', onJoystickMove);
    document.addEventListener('mouseup', onJoystickEnd);

    // === Touch события ===
    joystickArea.addEventListener('touchstart', onJoystickStart, { passive: false });
    document.addEventListener('touchmove', onJoystickMove, { passive: false });
    document.addEventListener('touchend', onJoystickEnd);
    document.addEventListener('touchcancel', onJoystickEnd);

    // === Кнопки направлений ===
    document.querySelectorAll('.dir-btn').forEach(btn => {
      const dir = btn.dataset.dir;
      
      // При нажатии — отправляем команду направления
      btn.addEventListener('mousedown', () => sendDirectionCommand(dir));
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        sendDirectionCommand(dir);
      });
      
      // При отпускании — стоп (кроме кнопки stop)
      if (dir !== 'stop') {
        btn.addEventListener('mouseup', () => sendDirectionCommand('stop'));
        btn.addEventListener('mouseleave', () => sendDirectionCommand('stop'));
        btn.addEventListener('touchend', () => sendDirectionCommand('stop'));
      }
    });

    console.log('🎮 Joystick initialized, radius:', joystickRadius);
  }

  /**
   * Начало движения джойстика
   */
  function onJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
    joystickStick.classList.add('active');
    
    // Обновляем позицию сразу
    updateJoystickPosition(e);
    
    // Запускаем периодическую отправку
    startJoystickSending();
  }

  /**
   * Движение джойстика
   */
  function onJoystickMove(e) {
    if (!joystickActive) return;
    e.preventDefault();
    updateJoystickPosition(e);
  }

  /**
   * Конец движения — автовозврат в центр
   */
  function onJoystickEnd(e) {
    if (!joystickActive) return;
    
    joystickActive = false;
    joystickStick.classList.remove('active');
    
    // Останавливаем отправку
    stopJoystickSending();
    
    // Возвращаем в центр
    joystickX = 0;
    joystickY = 0;
    updateJoystickUI();
    
    // Отправляем stop
    sendControlXY(0, 0);
  }

  /**
   * Обновление позиции джойстика по событию
   */
  function updateJoystickPosition(e) {
    const rect = joystickArea.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Получаем координаты (touch или mouse)
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Смещение от центра
    let deltaX = clientX - centerX;
    let deltaY = centerY - clientY;  // Инвертируем Y (вверх = положительный)

    // Ограничиваем радиусом
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance > joystickRadius) {
      const scale = joystickRadius / distance;
      deltaX *= scale;
      deltaY *= scale;
    }

    // Нормализуем в диапазон -255..+255
    joystickX = Math.round((deltaX / joystickRadius) * 255);
    joystickY = Math.round((deltaY / joystickRadius) * 255);

    updateJoystickUI();
  }

  /**
   * Обновление визуального положения ручки
   */
  function updateJoystickUI() {
    // Позиция ручки (пиксели от центра)
    const pixelX = (joystickX / 255) * joystickRadius;
    const pixelY = -(joystickY / 255) * joystickRadius;  // Инвертируем обратно для CSS

    joystickStick.style.left = `calc(50% + ${pixelX}px)`;
    joystickStick.style.top = `calc(50% + ${pixelY}px)`;

    // Обновляем индикаторы
    const xEl = document.getElementById('joy-x');
    const yEl = document.getElementById('joy-y');
    const activeEl = document.getElementById('joy-active');

    if (xEl) xEl.textContent = joystickX;
    if (yEl) yEl.textContent = joystickY;
    if (activeEl) activeEl.textContent = joystickActive ? '🟢' : '⚪';
  }

  /**
   * Запуск периодической отправки данных джойстика
   */
  function startJoystickSending() {
    stopJoystickSending();  // На всякий случай
    
    // Отправляем сразу
    sendControlXY(joystickX, joystickY);
    
    // Запускаем интервал
    joystickSendTimer = setInterval(() => {
      if (joystickActive) {
        sendControlXY(joystickX, joystickY);
      }
    }, JOYSTICK_SEND_INTERVAL);
  }

  /**
   * Остановка отправки
   * Также отменяет pending запросы
   */
  function stopJoystickSending() {
    if (joystickSendTimer) {
      clearInterval(joystickSendTimer);
      joystickSendTimer = null;
    }
    
    // Отменяем pending запрос если есть
    if (controlAbortController) {
      controlAbortController.abort();
      controlAbortController = null;
    }
  }

  /**
   * Отправка X/Y координат на /api/control
   * 
   * Реализует паттерн switchMap:
   * - Отменяет предыдущий запрос через AbortController
   * - Игнорирует ответы от устаревших запросов через requestId
   */
  function sendControlXY(x, y) {
    // === SwitchMap: отменяем предыдущий запрос ===
    if (controlAbortController) {
      controlAbortController.abort();
    }
    controlAbortController = new AbortController();
    
    // Увеличиваем счётчик запросов
    const thisRequestId = ++controlRequestId;

    fetch(CONTROL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'xy', x: x, y: y }),
      signal: controlAbortController.signal  // Привязываем AbortController
    })
    .then(r => r.json())
    .then(data => {
      // === Проверка: это ответ от актуального запроса? ===
      // Если пришёл ответ от старого запроса — игнорируем
      if (thisRequestId !== controlRequestId) {
        return;  // Устаревший ответ, пропускаем
      }
      
      // Обновляем UI моторов из ответа
      if (data.motors) {
        updateDriveUI(data.motors);
      }
    })
    .catch(err => {
      // Игнорируем ошибки отмены (AbortError)
      if (err.name === 'AbortError') return;
      console.error('Control API error:', err);
    });
  }

  /**
   * Отправка команды направления
   * Также с switchMap паттерном
   */
  function sendDirectionCommand(direction) {
    const speed = 200;  // Скорость по умолчанию
    
    // === SwitchMap: отменяем предыдущий запрос ===
    if (controlAbortController) {
      controlAbortController.abort();
    }
    controlAbortController = new AbortController();
    
    const thisRequestId = ++controlRequestId;
    
    fetch(CONTROL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        type: direction === 'stop' ? 'stop' : 'direction',
        direction: direction,
        speed: speed
      }),
      signal: controlAbortController.signal
    })
    .then(r => r.json())
    .then(data => {
      // Проверка актуальности ответа
      if (thisRequestId !== controlRequestId) return;
      
      if (data.motors) {
        updateDriveUI(data.motors);
      }
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error('Control API error:', err);
    });
  }

  // === Запуск ===
  document.addEventListener('DOMContentLoaded', () => {
    init();
    initDriveControls();
    initJoystick();
  });
})();

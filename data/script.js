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

  // === Запуск ===
  document.addEventListener('DOMContentLoaded', () => {
    init();
    initDriveControls();
  });
})();

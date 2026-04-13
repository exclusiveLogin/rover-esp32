# rover-esp32 — ESP32-CAM Rover с компьютерным зрением

Веб-управляемый робот на базе ESP32-CAM с интегрированным компьютерным зрением (OpenCV.js), моторами L298N, сервоприводом SG90 для панорамирования. Полный стек: C++ firmware + JavaScript Web UI + обработка изображений в реальном времени.

## Возможности

- **Видеостриминг** — камера ESP32-CAM с передачей кадров в браузер
- **Компьютерное зрение** — OpenCV.js: детекция движения, фильтрация, слой обработки изображений
- **Многослойный композитор** — система слоёв: видеопоток → CV-обработка → UI-overlay
- **Дистанционное управление** — управление моторами и сервоприводом через Web-панель
- **PlatformIO** — профессиональная сборка firmware

## Аппаратная часть

| Компонент | Назначение |
|----------|-----------|
| ESP32-CAM (AI-Thinker) | Микроконтроллер + камера OV2640 |
| L298N | Драйвер моторов (2 DC мотора) |
| SG90 | Сервопривод для панорамирования камеры |
| 18650 Li-ion | Автономное питание |

## Архитектура

```
rover-esp32/
├── src/                         # C++ Firmware (PlatformIO)
│   ├── camera.cpp               # Инициализация и управление камерой
│   ├── drive.cpp                # Управление моторами (L298N)
│   ├── servo.cpp                # Управление сервоприводом (SG90)
│   ├── webserver.cpp            # HTTP-сервер для Web UI и API
│   └── control.cpp              # Логика обработки команд
├── data/                        # Web UI (SPIFFS)
│   ├── compositor.js            # Многослойный композитор изображений
│   ├── cv-processor.js          # OpenCV.js обёртка — фильтры, обработка кадров
│   ├── motion-detector.js       # Детектор движения на основе разницы кадров
│   ├── state.js                 # Управление состоянием приложения
│   └── opencv.js                # OpenCV.js library
├── docs/
│   ├── HARDWARE.md              # Схема подключения, пины, питание
│   ├── OPENCV-GUIDE.md          # Гайд по OpenCV-интеграции
│   ├── COMPOSITOR-AND-LAYERS.md # Документация слоёв
│   └── MOTION-DETECTOR-GUIDE.md # Настройка детектора движения
└── platformio.ini               # Конфигурация PlatformIO
```

## Стек технологий

| Слой | Технологии |
|------|-----------|
| Firmware | C++, ESP-IDF / Arduino framework, PlatformIO |
| Web UI | Vanilla JavaScript, HTML5 Canvas |
| Computer Vision | OpenCV.js (WebAssembly) |
| Протокол | HTTP REST API + MJPEG стриминг |
| Хранение | SPIFFS (SPI Flash File System) |

## Документация

- [HARDWARE.md](docs/HARDWARE.md) — архитектура, подключение L298N, SG90, питание
- [OPENCV-GUIDE.md](docs/OPENCV-GUIDE.md) — интеграция OpenCV.js, пайплайн обработки
- [COMPOSITOR-AND-LAYERS.md](docs/COMPOSITOR-AND-LAYERS.md) — система слоёв композитора
- [MOTION-DETECTOR-GUIDE.md](docs/MOTION-DETECTOR-GUIDE.md) — настройка детекции движения

## Быстрый старт

```bash
# Сборка и прошивка (PlatformIO)
pio run --target upload

# Загрузка Web UI на SPIFFS
pio run --target uploadfs
```

После прошивки ESP32 создаёт Wi-Fi точку доступа или подключается к заданной сети. Web UI доступен в браузере по IP контроллера.

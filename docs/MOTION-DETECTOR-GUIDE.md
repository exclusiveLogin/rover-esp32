# 🔴 Motion Detector — Детекция движения в браузере

Модуль обнаружения движения на видеопотоке с помощью OpenCV.js.

> **См. также:** [CV Processor Guide](OPENCV-GUIDE.md) — детекция горизонта, сетки, стен

---

## 📚 Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Архитектура](#архитектура)
3. [Алгоритм детекции](#алгоритм-детекции)
4. [API Reference](#api-reference)
5. [Конфигурация](#конфигурация)
6. [Визуализация](#визуализация)
7. [Оптимизация](#оптимизация)

---

## Быстрый старт

### Требования

OpenCV.js (~11MB) загружается с CDN. Дополнительной установки не требуется.

### Подключение

```html
<!-- 1. OpenCV.js -->
<script async src="https://cdn.jsdelivr.net/gh/exclusiveLogin/rover-esp32@main/opencv.js"></script>

<!-- 2. Motion Detector -->
<script src="/motion-detector.js"></script>
```

### Использование

```javascript
// Создание детектора
const detector = new MotionDetector(
  document.getElementById('video'),           // <video> или <img>
  document.getElementById('motion-overlay'),  // <canvas> для отрисовки
  AppConfig.MOTION                            // опции из config.js
);

// Запуск (async!)
await detector.start();

// Остановка
detector.stop();

// Переключение
detector.toggle();

// Управление слоями
detector.setLayer('pixels', true);   // красная маска пикселей
detector.setLayer('boxes', false);   // BB рамки

// Настройка параметров
detector.setThreshold(30);           // порог детекции
detector.setMinArea(1000);           // мин. площадь контура
```

---

## Архитектура

### Canvas слои

Motion Detector и CV Processor работают на **независимых canvas-элементах**, что позволяет включать их одновременно:

```
┌─────────────────────────────────────────────────┐
│                  Video Container                 │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────┐ z:1   │
│  │  <img> / <video>                     │       │
│  │  (MJPEG stream / webcam)             │       │
│  │  CSS filter: grayscale при десатурации│       │
│  └──────────────────────────────────────┘       │
│                                                  │
│  ┌──────────────────────────────────────┐ z:3   │
│  │  #motion-overlay <canvas>            │       │
│  │  Красные пиксели + BB рамки          │       │
│  └──────────────────────────────────────┘       │
│                                                  │
│  ┌──────────────────────────────────────┐ z:5   │
│  │  #cv-overlay <canvas>                │       │
│  │  Горизонт + сетка + стены            │       │
│  └──────────────────────────────────────┘       │
│                                                  │
│  ┌──────────────────────────────────────┐ z:8   │
│  │  OSD Overlay                          │       │
│  └──────────────────────────────────────┘       │
│                                                  │
│  ┌──────────────────────────────────────┐ z:10  │
│  │  Joysticks Overlay                    │       │
│  └──────────────────────────────────────┘       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Разделение ответственности

```
┌─────────────────────────────────────────────────┐
│  MotionDetector (класс)                          │
│                                                  │
│  Владеет:                                        │
│    • Детекция движения (absdiff, threshold...)  │
│    • Рендер пикселей (showPixels)               │
│    • Рендер BB рамок (showBoxes)                │
│    • Canvas #motion-overlay                      │
│    • Callback onMotion(result)                   │
│                                                  │
│  НЕ владеет:                                    │
│    • Десатурация (CSS filter)                    │
│    • OSD виджет                                  │
│    • Кнопки UI                                   │
└─────────────────────────────────────────────────┘
                    │
                    │ onMotion({ motionPercent, regions, ... })
                    ▼
┌─────────────────────────────────────────────────┐
│  script.js (оркестратор)                         │
│                                                  │
│  Владеет:                                        │
│    • Десатурация: CSS filter на <img>/<video>    │
│    • OSD виджет: обновление DOM                  │
│    • Кнопка Motion: toggle, active state         │
│    • Панель настроек: привязка тогглов/слайдеров│
└─────────────────────────────────────────────────┘
```

### Внутренний стейт класса

```javascript
// Приватный стейт (не доступен снаружи)
this._prevGray = null;       // Предыдущий кадр (grayscale, cv.Mat)
this._currentGray = null;    // Текущий кадр (grayscale, cv.Mat)
this._mask = null;           // Бинарная маска движения (CV_8UC1)
this._regions = [];          // Текущие BB регионы
this._motionPercent = 0;     // Процент пикселей с движением
this._centerOfMass = null;   // Центр масс движения
```

---

## Алгоритм детекции

### Пайплайн обработки кадра

```
_processFrame()                     ← оркестратор одного кадра
  │
  ├── _captureFrame()               ← захват кадра → this._currentGray
  │
  ├── _computeDiffMask()            ← absdiff + blur + threshold + morphology
  │                                    → this._mask, this._motionPercent
  │
  ├── _findRegions()                ← findContours + boundingRect + filter
  │     (SKIP if showBoxes=false)      → this._regions, this._centerOfMass
  │
  ├── _render()                     ← рисуем на ПРОЗРАЧНЫЙ canvas
  │     ├── _renderPixelMask()         если showPixels
  │     └── _renderBoundingBoxes()     если showBoxes
  │
  ├── onMotion(result)              ← callback с метаданными
  │
  └── prevGray = currentGray        ← обновление стейта
```

### Детекция движения (_computeDiffMask)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  prevGray          currentGray                   │
│      │                  │                        │
│      +--- absdiff() ---+                        │
│              │                                   │
│              ▼                                   │
│      GaussianBlur                                │
│      (убирает шум сенсора камеры,               │
│       чтобы не детектить тепловой шум)           │
│              │                                   │
│              ▼                                   │
│      Threshold (порог ~25)                       │
│      (пиксели с разницей > порог → белые,       │
│       остальные → чёрные)                        │
│              │                                   │
│              ▼                                   │
│      Dilate (расширение, 2 итерации)             │
│      (соединяет близкие области движения)        │
│              │                                   │
│              ▼                                   │
│      Erode (сужение, 1 итерация)                 │
│      (убирает мелкий шум после dilate)           │
│              │                                   │
│              ▼                                   │
│      Binary Mask (CV_8UC1)                       │
│      → this._mask                                │
│              │                                   │
│              ▼                                   │
│      countNonZero / totalPixels × 100%           │
│      → this._motionPercent                       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Поиск регионов (_findRegions)

```
this._mask
    │
    ▼
findContours (RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
    │
    ▼
Для каждого контура:
    ├── contourArea() ≥ minContourArea? → boundingRect()
    │                                     → push to this._regions
    │
    └── area < minContourArea → пропускаем (шум)

Центр масс = взвешенное среднее центров BB по площади
```

---

## API Reference

### Конструктор

```javascript
new MotionDetector(videoElement, overlayCanvas, options)
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `videoElement` | `HTMLVideoElement \| HTMLImageElement` | Источник видео |
| `overlayCanvas` | `HTMLCanvasElement` | Canvas для отрисовки (отдельный от CV) |
| `options` | `Object` | Настройки (см. [Конфигурация](#конфигурация)) |

### Методы управления

| Метод | Возврат | Описание |
|-------|---------|----------|
| `start()` | `Promise<boolean>` | Запуск обработки (ждёт OpenCV) |
| `stop()` | `void` | Остановка обработки |
| `toggle()` | `boolean` | Переключение вкл/выкл |
| `isRunning()` | `boolean` | Проверка состояния |

### Методы настройки слоёв

| Метод | Возврат | Описание |
|-------|---------|----------|
| `setLayer(name, enabled)` | `void` | Установить слой ('pixels', 'boxes', 'contours') |
| `toggleLayer(name)` | `boolean` | Переключить слой |

### Методы настройки параметров

| Метод | Возврат | Описание |
|-------|---------|----------|
| `setThreshold(value)` | `void` | Порог детекции (0-255) |
| `setMinArea(value)` | `void` | Мин. площадь контура (px²) |
| `updateConfig(options)` | `void` | Обновить любые настройки |

### Callbacks

| Callback | Сигнатура | Описание |
|----------|-----------|----------|
| `onMotion` | `(result) => void` | Вызывается после каждого кадра |
| `onError` | `(message) => void` | Вызывается при ошибке |

### Результат (onMotion callback)

```javascript
{
  motionPercent: 12.5,          // Процент пикселей с движением (0-100)
  regionCount: 3,               // Количество обнаруженных регионов
  regions: [                     // Массив bounding rect-ов
    { x: 10, y: 20, width: 50, height: 40 },
    { x: 200, y: 100, width: 80, height: 60 },
  ],
  centerOfMass: { x: 105, y: 60 },  // Центр масс (null если нет движения)
  timestamp: 1699123456789       // Время обработки (ms)
}
```

**Важно:** координаты в `regions` и `centerOfMass` — в координатах обработки (processWidth × processHeight), НЕ в координатах дисплея. Для рендера на canvas масштабирование применяется автоматически.

---

## Конфигурация

Настройки в `config.js` → `AppConfig.MOTION`:

```javascript
MOTION: {
  // ─────────────────────────────────────
  // 📐 Разрешение обработки
  // ─────────────────────────────────────
  processWidth: 320,        // Ширина (px)
  processHeight: 240,       // Высота (px)
  processInterval: 100,     // Интервал (мс) = 10 FPS

  // ─────────────────────────────────────
  // 🔍 Параметры детекции
  // ─────────────────────────────────────
  threshold: 25,            // Порог бинаризации (0-255)
  minContourArea: 500,      // Мин. площадь контура (px²)
  dilateIterations: 2,      // Итераций dilate
  blurSize: 5,              // Размер GaussianBlur ядра

  // ─────────────────────────────────────
  // 👁️ Слои визуализации
  // ─────────────────────────────────────
  showPixels: true,         // Красная маска пикселей
  showBoxes: true,          // Зелёные BB рамки
  showContours: false,      // Контуры (силуэты) объектов
  showDesaturate: false,    // Десатурация (CSS, script.js)
  showOSD: true,            // OSD виджет (script.js)
}
```

### Что делают параметры

| Параметр | Диапазон | Влияние |
|----------|----------|---------|
| `threshold` | 0-255 | Чувствительность. Ниже = больше шума, выше = только сильное движение |
| `minContourArea` | 0-∞ | Фильтр мелких областей. Выше = только крупные объекты |
| `dilateIterations` | 0-10 | Объединение близких областей. Больше = объединяются |
| `blurSize` | 3-15 (нечёт) | Подавление шума сенсора. Больше = меньше шума, но размытие |

### Рекомендации по настройке

```
Сцена                      threshold   minContourArea   blurSize
─────────────────────────  ─────────   ──────────────   ────────
Внутри, хорошее освещение    20-30         500             5
Улица, яркий свет            30-50        1000             7
Слабое освещение             15-25         300             5
Камера с сильным шумом       30-60        1000             9
```

---

## Визуализация

### 5 независимых слоёв

Каждый слой включается/выключается отдельным тогглом в панели настроек:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  Слой         Кто рисует      Тоггл              │
│  ───────────  ──────────────  ────────           │
│  Пиксели      MotionDetector  showPixels         │
│  BB рамки     MotionDetector  showBoxes          │
│  Контуры      MotionDetector  showContours       │
│  Десатурация   script.js       showDesaturate     │
│  OSD виджет   script.js       showOSD            │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Пиксели (showPixels)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│         ██████                                   │
│        ████████   ← красные полупрозрачные       │
│       ██████████     пиксели на прозрачном       │
│        ████████      canvas                      │
│         ██████                                   │
│                          ███                     │
│                         █████                    │
│                          ███                     │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Контуры (showContours)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│         ╭──╮                                     │
│        ╭╯  ╰╮   ← cyan линия повторяет          │
│       ╭╯    ╰╮     реальную форму объекта        │
│       ╰╮    ╭╯     (замкнутый контур)            │
│        ╰╮  ╭╯                                    │
│         ╰──╯             ╭──╮                    │
│                         ╭╯  ╰╮                   │
│                         ╰────╯                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

- Контур = граница связной области движения
- CHAIN_APPROX_SIMPLE сжимает точки до вершин (углов)
- Рисуется через Canvas2D `lineTo()` + `closePath()`
- Можно комбинировать с BB рамками и/или пиксельной маской

### Bounding Boxes (showBoxes)

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  3200px²                                         │
│  ┌────────────┐                                  │
│  │            │  ← зелёная рамка                 │
│  │   MOTION   │     с подписью площади           │
│  │            │                                  │
│  └────────────┘          800px²                  │
│                          ┌────┐                  │
│                          │    │                  │
│                          └────┘                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Десатурация (showDesaturate)

Десатурация реализована через CSS filter на видео-элементе:

```css
/* Включено */
#video-feed { filter: grayscale(0.8) brightness(1.2); }

/* Выключено */
#video-feed { filter: none; }
```

Преимущества:
- GPU-ускоренный, нулевая нагрузка на CPU
- Не затрагивает canvas — пиксели и BB рисуются поверх
- MotionDetector не знает про десатурацию (чистое разделение)

---

## Оптимизация

### Разрешение

| Разрешение | FPS* | Точность | Рекомендация |
|------------|------|----------|--------------|
| 160×120 | ~50 | Низкая | Ультра-слабые устройства |
| 320×240 | ~25 | Средняя | **Рекомендуется** |
| 640×480 | ~10 | Высокая | Мощные устройства |

*FPS зависит от устройства и включённых слоёв

### Производительность слоёв

| Операция | Стоимость | Можно отключить |
|----------|-----------|-----------------|
| absdiff + threshold | Низкая | Нет (ядро алгоритма) |
| Morphology (dilate/erode) | Низкая | Нет |
| countNonZero | Мгновенно | Нет |
| findContours | Средняя | Да (showBoxes=false И showContours=false) |
| Pixel mask render | Средняя | Да (showPixels=false) |
| Contour render | Низкая | Да (showContours=false) |
| BB render | Низкая | Да (showBoxes=false) |

**Совет:** если нужна только информация о % движения (для OSD), отключите `showPixels` и `showBoxes` — останется только вычисление маски без рендера.

### Память

**КРИТИЧНО!** OpenCV.js не имеет garbage collection для `cv.Mat`:

```javascript
// MotionDetector автоматически управляет памятью:
// - _processFrame() удаляет временные Mat после каждого кадра
// - stop() вызывает _cleanup() для освобождения всех Mat
// - _findRegions() клонирует маску перед findContours (т.к. он модифицирует вход)
```

При ручном использовании API всегда вызывайте `stop()` перед удалением экземпляра.

### Throttling

Обработка ограничена `processInterval` (по умолчанию 100ms = 10 FPS):

```javascript
// Увеличить FPS (больше нагрузка)
detector.updateConfig({ processInterval: 50 });  // 20 FPS

// Уменьшить FPS (экономия батареи)
detector.updateConfig({ processInterval: 200 }); // 5 FPS
```

---

## Отладка

### Консоль

```javascript
// Отслеживание результатов
detector.onMotion = (result) => {
  console.log('Motion:', result.motionPercent.toFixed(1) + '%');
  console.log('Regions:', result.regionCount);
};

// Отслеживание ошибок
detector.onError = (msg) => {
  console.error('Motion Error:', msg);
};
```

### Проверка параметров

```javascript
// В консоли браузера
console.log(motionDetector?.config);
console.log(motionDetector?._motionPercent);
console.log(motionDetector?._regions);
```

### Типичные проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| Слишком много шума | threshold слишком низкий | Увеличить threshold до 30-50 |
| Не видит движение | threshold слишком высокий | Уменьшить threshold до 15-20 |
| Много мелких BB | minContourArea маленький | Увеличить до 1000-2000 |
| Медленно работает | Высокое разрешение | Уменьшить processWidth/Height |
| Маска мерцает | Шум камеры | Увеличить blurSize до 7-9 |

---

## Полезные ссылки

- [OpenCV.js Tutorials](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)
- [Background Subtraction](https://docs.opencv.org/4.x/d1/dc5/tutorial_background_subtraction.html)
- [Contour Features](https://docs.opencv.org/4.x/dd/d49/tutorial_py_contour_features.html)
- [Morphological Operations](https://docs.opencv.org/4.x/d9/d61/tutorial_py_morphological_ops.html)
- [CV Processor Guide](OPENCV-GUIDE.md) — детекция горизонта, сетки, стен

# 🔴 Motion Detector — Детекция движения в браузере

Модуль обнаружения движения на видеопотоке с помощью OpenCV.js.

> **См. также:** [CV Processor Guide](OPENCV-GUIDE.md) — детекция горизонта, сетки, стен

---

## 📚 Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Архитектура](#архитектура)
3. [Алгоритм детекции](#алгоритм-детекции)
4. [🎯 POI Tracking](#poi-tracking)
5. [API Reference](#api-reference)
6. [Конфигурация](#конфигурация)
7. [Визуализация](#визуализация)
8. [Оптимизация](#оптимизация)

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

### Композитор и слои

Motion Detector и Scene (CVProcessor) работают через **единый Compositor** — один RAF-цикл и один overlay canvas `#compositor-overlay`:

```
┌─────────────────────────────────────────────────┐
│                  Video Container                 │
├─────────────────────────────────────────────────┤
│  <img>/<video>               z:1  (видео)       │
│  #compositor-overlay         z:5  (все слои)    │
│  OSD Overlay                 z:8  (телеметрия)  │
│  Joysticks Overlay           z:10 (управление)  │
└─────────────────────────────────────────────────┘
```

#### Слои Motion (MotionDetector) — 4 штуки:
| localIndex | Имя | Описание |
|------------|-----|----------|
| 0 | Mask | Красная маска пикселей движения |
| 1 | Contours | Контуры (силуэты) объектов |
| 2 | BB | Bounding boxes (рамки) |
| 3 | **POI** | **HUD прицелов + смещения (POI Tracking)** |

Каждый слой рендерится в **offscreen canvas** и отдаётся через `getLayer(localIndex)`.

### Разделение ответственности

```
┌─────────────────────────────────────────────────┐
│  MotionDetector (класс)                          │
│                                                  │
│  Владеет:                                        │
│    • Детекция движения (absdiff, threshold...)  │
│    • tick(now) — вызывается Compositor'ом        │
│    • getLayer(0..2) — offscreen canvases         │
│    • Callback onMotion(result)                   │
│                                                  │
│  НЕ владеет:                                    │
│    • RAF цикл (владеет Compositor)               │
│    • Десатурация (CSS filter)                    │
│    • OSD виджет                                  │
│    • Кнопки UI                                   │
└─────────────────────────────────────────────────┘
                    │
                    │ onMotion({ motionPercent, regions, ... })
                    ▼
┌─────────────────────────────────────────────────┐
│  script.js (AppState + оркестратор)              │
│                                                  │
│  Владеет:                                        │
│    • AppState.layers (SSOT) — toggle/solo        │
│    • Compositor — единый RAF + overlay canvas    │
│    • Десатурация: CSS filter на <img>/<video>    │
│    • OSD виджет: обновление DOM                  │
│    • Плитки-превью + глазик (toggle/solo)        │
│    • Панель настроек: привязка слайдеров         │
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
  │                                    → this._regions, this._centerOfMass
  │
  ├── _updatePoiTrackers()          ← POI Tracking: корреляция + накопление
  │                                    → this._poiTrackers, this._poiResults
  │
  ├── _renderLayerCanvases()        ← рисуем в offscreen canvases (4 слоя)
  │     ├── _renderPixelMaskTo()       Layer 0: Mask
  │     ├── _renderContoursTo()        Layer 1: Contours
  │     ├── _renderBBTo()              Layer 2: BB
  │     └── _renderPoiTo()             Layer 3: POI HUD
  │
  ├── onMotion(result)              ← callback с метаданными + POI
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

## 🎯 POI Tracking

**POI (Point of Interest)** — модуль темпорального трекинга устойчивых движущихся объектов с HUD-прицелом для последующего центрирования камеры.

### Задача

- Отличить **стабильное движение** (человек, животное) от **шума** (листва, тряска камеры)
- Накопить **достоверность** объекта по времени (кол-во кадров устойчивого движения)
- Отобразить **прицел + смещение** для системы управления подвесом камеры

### Алгоритм (SORT-подобный трекинг)

```
┌────────────────────────────────────────────────────────────────┐
│  _updatePoiTrackers() — вызывается после _findRegions()        │
│                                                                 │
│  Входные данные:                                                │
│    • this._regions[]       ← текущие BB из детекции движения   │
│    • this._motionPercent   ← процент движущихся пикселей       │
│                                                                 │
│  Шаг 1: Проверка шумового режима                                │
│    if (motionPercent > poiNoiseThreshold):                     │
│      _poiNoiseMode = true   → пропуск рендера зон              │
│                                                                 │
│  Шаг 2: Матчинг текущих регионов с трекерами                    │
│    for region in _regions:                                      │
│      nearestTracker = findNearest(_poiTrackers, region.center) │
│      if (distance < poiMatchRadius):                            │
│        ✅ MATCH — обновляем трекер с EMA-сглаживанием:          │
│          tracker.cx = 0.7 × tracker.cx + 0.3 × region.cx       │  ← для матчинга
│          tracker.cy = 0.7 × tracker.cy + 0.3 × region.cy       │  ← стабильные
│          tracker.width  = 0.8 × old + 0.2 × new                │
│          tracker.height = 0.8 × old + 0.2 × new                │
│          tracker.rawCx = region.cx       ← актуальные (для отрисовки)
│          tracker.rawCy = region.cy       ← без лага!
│          tracker.rawWidth = region.width
│          tracker.rawHeight = region.height
│          tracker.frameCount++                                   │
│          tracker.age = 0     ← сброс aging                      │
│      else:                                                      │
│        ➕ NEW — создаём трекер { cx, cy, w, h, frameCount=1 }  │
│                                                                 │
│  Шаг 3: Aging неиспользованных трекеров                          │
│    for tracker not matched:                                     │
│      tracker.age++                                              │
│                                                                 │
│  Шаг 4: Persistence cleanup                                     │
│    _poiTrackers = filter(age <= poiPersistence)                │
│                                                                 │
│  Шаг 5: Фильтрация для рендера                                  │
│    _poiResults = filter(                                        │
│      frameCount >= poiMinFrames                                │
│      AND area in [poiMinSize, poiMaxSize]                      │
│    )                                                            │
│                                                                 │
│  Шаг 6: Ранжирование                                             │
│    sort(_poiResults by frameCount DESC)  ← самые устойчивые    │
│    take top N (poiMaxZones)                                     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### EMA-сглаживание (Exponential Moving Average)

Подавляет джиттер (дрожание) детекции контуров. Коэффициенты **настраиваются через UI** (`poiEmaPosition`, `poiEmaSize`):

```javascript
// α (alpha) = poiEmaPosition / 100  (default: 70% → 0.7)
// Меньше α = быстрее реакция, больше дёрганий
// Больше α = плавнее, медленнее реакция
newCx = α × oldCx + (1-α) × measuredCx

// α для размера (default: 80% → 0.8) — медленнее, т.к. размер BB нестабилен
newWidth = α × oldWidth + (1-α) × measuredWidth
```

**Двойные координаты (dual coordinates):**

Трекер хранит **две пары координат**:
- **`cx, cy, width, height`** — EMA-сглаженные (для алгоритма матчинга, стабильность трекера)
- **`rawCx, rawCy, rawWidth, rawHeight`** — актуальные координаты текущего кадра (для отрисовки прицела)

**Зачем:** EMA создаёт задержку (lag). Прицел, нарисованный по сглаженным координатам, запаздывает за реальным объектом. Используя `raw*` координаты для визуализации, прицел точно попадает в центр BB текущего кадра.

**Рекомендации:**
- Быстрое движение (животные): `poiEmaPosition=60`, `poiEmaSize=70`
- Медленное движение (человек): `poiEmaPosition=70`, `poiEmaSize=80` (default)
- Шумная камера (ESP32-CAM): `poiEmaPosition=80`, `poiEmaSize=85`

### Трекер (структура данных)

```javascript
{
  // EMA-сглаженные координаты (для алгоритма матчинга)
  cx: 160,          // Центр X (process space, px)
  cy: 120,          // Центр Y (process space, px)
  width: 80,        // Ширина BB (px)
  height: 60,       // Высота BB (px)
  
  // Актуальные координаты текущего кадра (для отрисовки прицела без лага)
  rawCx: 162,       // Центр X текущего региона
  rawCy: 118,       // Центр Y текущего региона
  rawWidth: 78,     // Ширина текущего региона
  rawHeight: 62,    // Высота текущего региона
  
  frameCount: 12,   // Кол-во кадров устойчивого движения (достоверность)
  age: 0,           // Кол-во кадров без обнаружения (для fade-out)
  id: 3             // Уникальный ID трекера
}
```

### Визуализация (Layer 3: POI HUD)

#### 1. HUD Crosshair (всегда рисуется)

```
         │
         │
─────────┼─────────  ← тонкая серая линия через весь canvas
         ┃
         ┃           ← утолщённый центральный маркер 16×16px
─────────╋─────────
         ┃
         │
```

#### 2. POI Zones (если не шум)

```
┌─────────────────────────────────────────────────────────┐
│                          │                              │
│                          │                              │
│         ╔═══════╗        │                              │
│         ║   +   ║ ←──────┼── BB прямоугольник (красный)│
│         ║       ║        │   + перекрестие центра      │
│         ╚═══════╝        │                              │
│         X:+15% Y:-8%     │   ← текст смещения от центра│
│            ·  ·  ·  ·  · │ · ·  ← пунктир по осям       │
│            ·             │    ·                         │
│─────────────────────────┼───────────────────────────────│
│                          │                              │
│                        [ NOISE ]  ← текст если шум      │
│                          │                              │
└─────────────────────────────────────────────────────────┘
```

**Цветовая логика (4 режима по состоянию трекинга):**

| Состояние | Цвет | Условие |
|-----------|------|---------|
| **Уверенное трассирование** | 🟢 Зелёный `#00FF00` | `age = 0` И `frameCount ≥ 2×poiMinFrames` |
| **Сомнительный** | 🟠 Оранжевый `#FF8C00` | `age = 0` И `frameCount ≥ poiMinFrames` |
| **Потеря (недавняя)** | 🔴 Красный `#FF3030` | `age > 0` И `age ≤ poiPersistence/2` |
| **Старый (скоро удалится)** | 🔴 Тёмно-красный `#990000` | `age > poiPersistence/2` |

#### 3. Noise Indicator

Если `motionPercent > poiNoiseThreshold` → текст **"NOISE"** в центре canvas. POI зоны не рисуются.

### Параметры POI

| Параметр | Default | Range | Описание |
|----------|---------|-------|----------|
| `poiMinFrames` | 5 | 2..30 | Мин. кадров устойчивости для квалификации POI |
| `poiMatchRadius` | 30 | 5..100 | Макс. расстояние (px) между центрами для сопоставления tracker ↔ region |
| `poiPersistence` | 5 | 0..30 | Кол-во кадров удержания прицела после пропадания движения (fade-out) |
| `poiMinSize` | 500 | 50..5k | Мин. площадь BB (px²) для квалификации (совпадает с `minContourArea`) |
| `poiMaxSize` | 50000 | 1k..50k | Макс. площадь BB (px²) для квалификации |
| `poiMaxZones` | 3 | 1..3 | Макс. кол-во одновременных POI зон |
| `poiNoiseThreshold` | 30 | 10..80 | Порог `motionPercent` (%), выше которого = режим "шум" |
| `poiEmaPosition` | 70 | 50..90 | EMA коэфф. для позиции (% старого значения). Ниже = быстрее реакция |
| `poiEmaSize` | 80 | 50..95 | EMA коэфф. для размера (% старого значения). Выше = плавнее |

### Режимы работы

#### 1. Нормальный режим

```javascript
// motionPercent < poiNoiseThreshold (например, 12% < 30%)
// Локальное движение (кот, человек)

_poiResults = [
  { cx: 120, cy: 80, frameCount: 15, age: 0 },  // Зелёный (15 ≥ 2×5, уверенный)
  { cx: 200, cy: 150, frameCount: 6, age: 0 },  // Оранжевый (6 ≥ 5, сомнительный)
]

→ Рисуем 2 POI зоны с прицелами + смещениями
```

#### 2. Шумовой режим

```javascript
// motionPercent > poiNoiseThreshold (например, 45% > 30%)
// Тряска камеры, ветер, смена сцены

_poiNoiseMode = true

→ Рисуем только текст "NOISE", POI зоны пропускаем
```

#### 3. Persistence (fade-out)

```javascript
// Объект пропал (region больше нет), но трекер ещё держим

tracker.age = 2   // 2 кадра без обнаружения
frameCount = 12   // накопленная достоверность
poiPersistence = 5 (default)

→ age=2 <= 5/2 → Рисуем красным (потеря недавняя)

tracker.age = 4   // 4 кадра без обнаружения

→ age=4 > 5/2 → Рисуем тёмно-красным (старый, скоро удалится)
→ Через poiPersistence кадров (5) → удаляем трекер
```

### Use Case: Центрирование камеры

```javascript
detector.onMotion = (result) => {
  if (result.poiNoiseMode) {
    console.log('Слишком много шума — пропускаем');
    return;
  }

  if (result.poiCount === 0) {
    console.log('Нет устойчивых POI');
    return;
  }

  // Берём самый устойчивый POI (первый в массиве — отсортировано по frameCount)
  const poi = result.pois[0];

  // Используем RAW координаты (актуальные) для точного наведения без лага
  const targetX = poi.rawCx || poi.cx;
  const targetY = poi.rawCy || poi.cy;

  // Смещение от центра canvas в %
  const offsetX = ((targetX - canvasWidth/2) / (canvasWidth/2)) * 100;
  const offsetY = ((targetY - canvasHeight/2) / (canvasHeight/2)) * 100;

  console.log(`POI offset: X=${offsetX.toFixed(1)}%, Y=${offsetY.toFixed(1)}%`);
  
  // Отправляем команду на сервоприводы подвеса камеры
  moveCameraGimbal(offsetX, offsetY);
};
```

### Оптимизация POI

```
Сценарий                     poiMinFrames   poiMatchRadius   poiPersistence
─────────────────────────    ────────────   ──────────────   ──────────────
Быстрое движение (животное)      3              40               3
Медленное движение (человек)     7              25               8
Шумная камера (ESP32-CAM)        10             50               5
Точное наведение                 15             15               2
```

**Совет:** чем больше `poiMinFrames` — тем выше порог устойчивости, но медленнее реакция на новый объект.

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

### Compositor API (новое)

| Метод | Возврат | Описание |
|-------|---------|----------|
| `tick(now)` | `void` | Вызывается Compositor'ом каждый RAF-кадр. Внутри throttle по `processInterval`. |
| `getLayer(localIndex)` | `HTMLCanvasElement \| null` | Возвращает offscreen canvas для слоя 0..3 |
| `MotionDetector.LAYER_COUNT` | `4` | Статическое свойство: число слоёв (Mask, Contours, BB, POI) |

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
| `setBlurSize(value)` | `void` | Размер Gaussian blur ядра (3-15, нечётный) |
| `setDilateIterations(value)` | `void` | Итерации dilate (0-5) |
| **POI Tracking:** | | |
| `setPoiMinFrames(value)` | `void` | Мин. кадров устойчивости (2-30) |
| `setPoiMatchRadius(value)` | `void` | Радиус сопоставления (5-100 px) |
| `setPoiPersistence(value)` | `void` | Кадров удержания после пропадания (0-30) |
| `setPoiMinSize(value)` | `void` | Мін. площадь BB для POI (50-5000 px²) |
| `setPoiMaxSize(value)` | `void` | Макс. площадь BB для POI (1000-50000 px²) |
| `setPoiMaxZones(value)` | `void` | Макс. зон POI (1-3) |
| `setPoiNoiseThreshold(value)` | `void` | Порог шума motionPercent (10-80 %) |
| `setPoiEmaPosition(value)` | `void` | EMA коэфф. позиции (50-90 %) |
| `setPoiEmaSize(value)` | `void` | EMA коэфф. размера (50-95 %) |
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
  
  // ─── POI Tracking ───────────────────────────────────────────
  poiCount: 2,                   // Кол-во устойчивых POI
  pois: [                        // Массив POI (отсортировано по frameCount DESC)
    { 
      cx: 120, cy: 80, width: 60, height: 50,           // EMA-сглаженные (для матчинга)
      rawCx: 118, rawCy: 82, rawWidth: 62, rawHeight: 48, // Актуальные (для отрисовки)
      frameCount: 15, age: 0, id: 1 
    },
    { 
      cx: 200, cy: 150, width: 80, height: 70,
      rawCx: 202, rawCy: 148, rawWidth: 78, rawHeight: 72,
      frameCount: 8, age: 0, id: 2 
    },
  ],
  poiNoiseMode: false,           // true если motionPercent > poiNoiseThreshold
  
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

# 🎬 Compositor & Layers — Единая модель слоёв

Единый RAF-цикл, один overlay canvas, SSOT массив слоёв.

> **См. также:**
> - [Scene (CVProcessor)](OPENCV-GUIDE.md) — горизонт, сетка, стены
> - [Motion Detector](MOTION-DETECTOR-GUIDE.md) — детекция движения

---

## 📚 Содержание

1. [Обзор](#обзор)
2. [AppState (SSOT)](#appstate-ssot)
3. [Compositor](#compositor)
4. [API процессоров](#api-процессоров)
5. [Layer Tiles UI](#layer-tiles-ui)
6. [Добавление нового процессора](#добавление-нового-процессора)

---

## Обзор

### Проблема (до рефактора)

- Два процессора, каждый со своим `requestAnimationFrame` и своим canvas
- Слои управлялись внутри каждого процессора отдельно
- Нет единой точки правды для состояния слоёв

### Решение

```
┌───────────────────────────────────────────────────┐
│  Compositor (один RAF)                             │
│                                                    │
│  tick(now) → каждому процессору                    │
│  getLayer(localIndex) → для enabled слоёв          │
│  drawImage → единый #compositor-overlay canvas     │
│                                                    │
│  AppState.layers = [ ... ]  (SSOT)                 │
└───────────────────────────────────────────────────┘
```

- **Один** `requestAnimationFrame` цикл (в Compositor)
- **Один** физический canvas `#compositor-overlay` поверх видео
- **Один** массив `layers` — единственный источник правды

---

## AppState (SSOT)

```javascript
const AppState = {
  processors: {
    scene:  { enabled: false, instance: null, count: 6 },
    motion: { enabled: false, instance: null, count: 3 }
  },
  layers: [
    // Scene (localIndex 0..5)
    { processorId: 'scene', localIndex: 0, enabled: false, label: 'Gray' },
    { processorId: 'scene', localIndex: 1, enabled: false, label: 'Edges' },
    { processorId: 'scene', localIndex: 2, enabled: false, label: 'Lines' },
    { processorId: 'scene', localIndex: 3, enabled: true,  label: 'Horizon' },
    { processorId: 'scene', localIndex: 4, enabled: true,  label: 'Grid' },
    { processorId: 'scene', localIndex: 5, enabled: true,  label: 'Walls' },
    // Motion (localIndex 0..2)
    { processorId: 'motion', localIndex: 0, enabled: true,  label: 'Mask' },
    { processorId: 'motion', localIndex: 1, enabled: false, label: 'Contours' },
    { processorId: 'motion', localIndex: 2, enabled: true,  label: 'BB' },
  ]
};
```

### Правила

- **Порядок** элементов в `layers` = порядок отрисовки (первый рисуется первым)
- **enabled** — единственное поле, которое меняется при тогглах
- **Глобальный номер** слоя = индекс в массиве `layers[i]`
- **Solo** = хелпер: `layers.forEach(l => l.enabled = false); layers[i].enabled = true`
- Нет отдельного `drawOrder`, `globalIndex` или `soloChannel`

---

## Compositor

Файл: `data/compositor.js`

```javascript
const compositor = new Compositor(canvasElement, AppState);
compositor.start();
compositor.stop();
```

### Цикл (каждый RAF-кадр)

1. `_syncSize()` — размеры canvas = размеры видео
2. `tick(now)` — для каждого enabled процессора
3. `_clear()` — очистка canvas
4. Итерация по `layers`:
   - Если `entry.enabled === true` и процессор enabled:
   - `processors[entry.processorId].instance.getLayer(entry.localIndex)`
   - `ctx.drawImage(layer, 0, 0, w, h)`
5. `_updatePreviews()` — обновление превью-плиток в панели настроек

---

## API процессоров

Каждый процессор (CVProcessor, MotionDetector) реализует:

| Метод | Описание |
|-------|----------|
| `tick(now)` | Вызывается каждый RAF. Внутри — throttle по `processInterval`. При срабатывании: захват кадра, анализ, запись в offscreen canvases. |
| `getLayer(localIndex)` | Возвращает `HTMLCanvasElement` (offscreen) для слоя `localIndex`. Или `null`. |
| `static LAYER_COUNT` | Число слоёв этого процессора. |

### CVProcessor — 6 слоёв

| localIndex | Имя | Содержимое |
|------------|-----|------------|
| 0 | Grayscale | Серое изображение |
| 1 | Edges | Canny edge detection |
| 2 | Lines | Hough lines (раскрашенные по типу) |
| 3 | Horizon | Линия горизонта + сегменты кластера |
| 4 | Grid | Перспективная сетка пола |
| 5 | Walls | Вертикальные линии (стены) |

### MotionDetector — 3 слоя

| localIndex | Имя | Содержимое |
|------------|-----|------------|
| 0 | Mask | Красная маска пикселей движения |
| 1 | Contours | Контуры (силуэты) объектов |
| 2 | BB | Bounding boxes (рамки) |

---

## Layer Tiles UI

Каждый слой в панели настроек = **плитка-превью** (мини-canvas) + **кнопка-глазик**.

### Действия

| Действие | Результат |
|----------|-----------|
| Клик по плитке | Toggle: `layers[i].enabled = !layers[i].enabled` |
| Клик по глазику | Solo: всем `enabled = false`, этому `true` |

### Цвета рамок (из `AppConfig.LAYERS`)

| Состояние | Цвет по умолчанию | Определение |
|-----------|-------------------|-------------|
| Active | `#4CAF50` (зелёный) | `enabled === true` |
| Solo | `#FFC107` (жёлтый) | Ровно 1 слой enabled |
| Off | `rgba(255,255,255,0.15)` | `enabled === false` |

Solo-состояние вычисляется: если ровно 1 слой enabled — его рамка solo-цвет. Отдельного поля `isSolo` нет.

---

## Добавление нового процессора

1. Создать класс с `tick(now)` + `getLayer(localIndex)` + `static LAYER_COUNT`
2. Зарегистрировать в `AppState.processors`:
   ```javascript
   AppState.processors.newProc = { enabled: false, instance: null, count: NewProc.LAYER_COUNT };
   ```
3. Добавить записи в `AppState.layers` (по `count` штук с `processorId` и `localIndex`)
4. Добавить разметку плиток в `index.html` (с `data-layer-idx`)
5. Добавить маршрут в `webserver.cpp`
6. Compositor подхватит новые слои автоматически

---

## Файлы

| Файл | Ответственность |
|------|-----------------|
| `data/compositor.js` | Класс Compositor: один RAF, один canvas, обход layers |
| `data/cv-processor.js` | Scene: tick + getLayer(0..5), без своего RAF |
| `data/motion-detector.js` | Motion: tick + getLayer(0..2), без своего RAF |
| `data/script.js` | AppState, создание Compositor, toggle/solo, UI wiring |
| `data/config.js` | `LAYERS` секция (цвета рамок) |
| `data/index.html` | Один `#compositor-overlay`, плитки слоёв, слайдеры |
| `src/webserver.cpp` | Маршрут `/compositor.js` |

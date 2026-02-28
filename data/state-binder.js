/**
 * ============================================================
 * StateBinder — Декларативная двусторонняя привязка DOM ↔ AppState
 * ============================================================
 *
 * Упрощает связывание UI-контролов с AppState до одной строки:
 *   binder.slider('my-slider', 'expoX', 'expo-x-label');
 *   binder.toggle('my-checkbox', 'motionEnabled');
 *   binder.text('my-input', 'ESP32_HOST');
 *   binder.radio('drive-mode', 'joystickMode');
 *
 * Каждый метод делает три вещи:
 *   1. Init — устанавливает начальное значение из стейта
 *   2. DOM → State — слушает события input/change/click
 *   3. State → DOM — подписывается на store.subscribe()
 *
 * Защита от циклов:
 *   При обновлении State → DOM проверяем document.activeElement —
 *   если элемент в фокусе (пользователь тянет слайдер),
 *   не перезаписываем значение (иначе слайдер дёргается).
 *
 * ============================================================
 */

class StateBinder {
  constructor(store) {
    this.store = store;
    this.bindings = new Map();  // key → Set<elementId>
    this.elements = new Map();  // elementId → HTMLElement (кэш)
  }

  /**
   * Получить элемент по ID с кэшированием.
   * Повторные обращения не ходят в DOM.
   */
  _el(id) {
    if (this.elements.has(id)) return this.elements.get(id);
    const el = document.getElementById(id);
    if (el) this.elements.set(id, el);
    return el;
  }

  /**
   * Привязать слайдер (input[type=range]).
   *
   * @param {string} id      — ID элемента <input>
   * @param {string} key     — ключ в AppState
   * @param {string} labelId — ID элемента для отображения текущего значения
   */
  slider(id, key, labelId = null) {
    const el = this._el(id);
    if (!el) return;

    el.value = this.store[key] || 0;
    if (labelId) {
      const lbl = this._el(labelId);
      if (lbl) lbl.textContent = el.value;
    }

    // DOM → State: при перетаскивании слайдера
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      this.store.set(key, val);
      if (labelId) {
        const lbl = this._el(labelId);
        if (lbl) lbl.textContent = val;
      }
    });

    // State → DOM: при программном изменении стейта
    this.store.subscribe(key, (state) => {
      // Не обновляем, если пользователь сейчас тянет этот слайдер
      if (document.activeElement === el) return;

      const newVal = state[key];
      if (el.value != newVal) {
        el.value = newVal;
        if (labelId) {
          const lbl = this._el(labelId);
          if (lbl) lbl.textContent = newVal;
        }
      }
    });
  },

  /**
   * Привязать чекбокс или кнопку-тоггл (boolean).
   *
   * Для checkbox: читает/пишет el.checked.
   * Для кнопки: toggle CSS-класс 'active'.
   */
  toggle(id, key) {
    const el = this._el(id);
    if (!el) return;

    const isCheckbox = el.type === 'checkbox';
    const val = !!this.store[key];

    if (isCheckbox) el.checked = val;
    else el.classList.toggle('active', val);

    el.addEventListener('click', (e) => {
      const newVal = isCheckbox ? el.checked : !this.store[key];
      this.store.set(key, newVal);
    });

    this.store.subscribe(key, (state) => {
      const newVal = !!state[key];
      if (isCheckbox) el.checked = newVal;
      else el.classList.toggle('active', newVal);
    });
  },

  /**
   * Привязать текстовое поле (input/textarea) или span/div.
   *
   * Для input/textarea: двусторонняя привязка (change → state, state → value).
   * Для span/div: только отображение (state → textContent).
   */
  text(id, key) {
    const el = this._el(id);
    if (!el) return;

    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const val = this.store[key] !== undefined ? this.store[key] : '';

    if (isInput) el.value = val;
    else el.textContent = val;

    if (isInput) {
      el.addEventListener('change', () => {
        this.store.set(key, el.value);
      });
    }

    this.store.subscribe(key, (state) => {
      if (isInput && document.activeElement === el) return;
      const newVal = state[key] !== undefined ? state[key] : '';
      if (isInput) el.value = newVal;
      else el.textContent = newVal;
    });
  },

  /**
   * Привязать группу радио-кнопок (input[type=radio] с общим name).
   *
   * Выбранная радио-кнопка = значение ключа в стейте.
   */
  radio(name, key) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    if (!radios.length) return;

    const currentVal = this.store[key];
    radios.forEach(r => {
      if (r.value === currentVal) r.checked = true;

      r.addEventListener('change', () => {
        if (r.checked) this.store.set(key, r.value);
      });
    });

    this.store.subscribe(key, (state) => {
      const newVal = state[key];
      radios.forEach(r => {
        if (r.value === newVal) r.checked = true;
      });
    });
  },

  /**
   * Привязать действие к кнопке (без привязки к стейту).
   */
  button(id, onClick) {
    const el = this._el(id);
    if (el) el.addEventListener('click', onClick);
  },

  /**
   * Привязать CSS-класс к значению ключа.
   *
   * Пример: classMap('status-icon', 'connectionState', {
   *   'online': 'status-green',
   *   'offline': 'status-red'
   * })
   */
  classMap(id, key, map) {
    const el = this._el(id);
    if (!el) return;

    this.store.subscribe(key, (state) => {
      const val = state[key];
      Object.values(map).forEach(cls => el.classList.remove(cls));
      if (map[val]) el.classList.add(map[val]);
    });

    const initialVal = this.store[key];
    if (map[initialVal]) el.classList.add(map[initialVal]);
  }
}

window.StateBinder = StateBinder;

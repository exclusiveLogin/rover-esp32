/**
 * ============================================================
 * 🎮 control.cpp — Модуль живого управления с Watchdog
 * ============================================================
 *
 * Отвечает за "живое" (real-time) управление ровером от джойстиков.
 *
 * Ключевая функция — Watchdog:
 *   Если команда не приходит в течение CONTROL_TIMEOUT_MS (2 сек),
 *   моторы автоматически останавливаются. Это предотвращает
 *   неуправляемое движение при потере связи.
 *
 * Режимы управления:
 *   1. По направлению (controlSetMovement) — forward, backward, left, right
 *   2. По осям X/Y (controlSetXY) — от джойстика, с skid-steer микшированием
 *
 * Skid-steer микширование (танковое управление):
 *   leftSpeed  = Y + X    (Y = газ, X = поворот)
 *   rightSpeed = Y - X
 *   При превышении 255 — нормализация с сохранением пропорций.
 *
 * Зависимости:
 *   - drive.h  — driveSetSpeed(), driveStop() для управления моторами
 *   - config.h — CONTROL_TIMEOUT_MS, CONTROL_DEADZONE
 *
 * ============================================================
 */

#include "control.h"
#include "drive.h"
#include "config.h"

// --- Внутреннее состояние управления ---
static ControlState state = {
    .direction = CTRL_STOP,
    .speed = 0,
    .lastCommandMs = 0,
    .active = false
};

// ============================================================
// Инициализация
// ============================================================

/**
 * @brief Инициализация модуля управления
 * Сбрасывает состояние и выводит конфигурацию watchdog в Serial.
 * Вызывать в setup() после driveInit().
 */
void controlInit() {
    // Сброс состояния
    state.direction = CTRL_STOP;
    state.speed = 0;
    state.lastCommandMs = 0;
    state.active = false;
    
    Serial.println("✅ Control модуль инициализирован");
    Serial.printf("   ⏱️ Watchdog таймаут: %d мс\n", CONTROL_TIMEOUT_MS);
}

// ============================================================
// Watchdog Update — вызывать в loop()
// ============================================================

/**
 * @brief Проверка watchdog-таймаута
 *
 * Если управление активно и прошло более CONTROL_TIMEOUT_MS мс
 * с последней команды — принудительная остановка моторов.
 * Вызывать в loop() каждый цикл.
 */
void controlUpdate() {
    // Если управление не активно — ничего не делаем
    if (!state.active) return;
    
    // Проверяем таймаут
    unsigned long now = millis();
    unsigned long elapsed = now - state.lastCommandMs;
    
    if (elapsed >= CONTROL_TIMEOUT_MS) {
        // Таймаут! Останавливаем моторы
        Serial.printf("⏱️ Watchdog: таймаут %lu мс, остановка моторов\n", elapsed);
        controlStop();
    }
}

// ============================================================
// Установка движения по направлению
// ============================================================

/**
 * @brief Установить направление и скорость движения
 * Сбрасывает watchdog-таймер. Транслирует команду в drive-модуль.
 * @param direction Направление из enum ControlDirection
 * @param speed     Скорость 0-255
 */
void controlSetMovement(ControlDirection direction, uint8_t speed) {
    // Обновляем состояние
    state.direction = direction;
    state.speed = speed;
    state.lastCommandMs = millis();  // Сброс watchdog
    state.active = (direction != CTRL_STOP);
    
    // Применяем к моторам через drive модуль
    switch (direction) {
        case CTRL_STOP:
            driveStop();
            break;
            
        case CTRL_FORWARD:
            // Вперёд: FL + FR активны
            driveForward(speed);
            break;
            
        case CTRL_BACKWARD:
            // Назад: RL + RR активны
            driveBackward(speed);
            break;
            
        case CTRL_LEFT:
            // Поворот влево: только правая сторона
            driveTurnLeft(speed);
            break;
            
        case CTRL_RIGHT:
            // Поворот вправо: только левая сторона
            driveTurnRight(speed);
            break;
            
        case CTRL_ROTATE_LEFT:
            // Разворот влево: правая вперёд, левая назад
            driveRotateLeft(speed);
            break;
            
        case CTRL_ROTATE_RIGHT:
            // Разворот вправо: левая вперёд, правая назад
            driveRotateRight(speed);
            break;
    }
}

// ============================================================
// Установка движения по осям X/Y (для джойстика)
// ============================================================
//
// Микширование осей для танкового (skid-steer) управления:
//   Y — газ/тормоз (вперёд/назад)
//   X — поворот (лево/право)
//
// Формула микширования:
//   leftSpeed  = Y + X
//   rightSpeed = Y - X
//
// ============================================================

/**
 * @brief Установить движение по осям X/Y (для джойстика)
 *
 * Применяет skid-steer (танковое) микширование:
 *   leftSpeed  = Y + X
 *   rightSpeed = Y - X
 *
 * Положительные значения → вперёд (FL/FR), отрицательные → назад (RL/RR).
 * Мёртвая зона: если |X| и |Y| < CONTROL_DEADZONE — остановка.
 *
 * @param x Ось X: -255 (лево) .. +255 (право)
 * @param y Ось Y: -255 (назад) .. +255 (вперёд)
 */
void controlSetXY(int16_t x, int16_t y) {
    // Обновляем watchdog
    state.lastCommandMs = millis();
    
    // Ограничиваем входные значения
    x = constrain(x, -255, 255);
    y = constrain(y, -255, 255);
    
    // Мёртвая зона (deadzone) — игнорируем малые отклонения
    if (abs(x) < CONTROL_DEADZONE && abs(y) < CONTROL_DEADZONE) {
        // Джойстик в центре — остановка
        controlStop();
        return;
    }
    
    // Активируем управление
    state.active = true;
    
    // --- Микширование для skid-steer ---
    // Стандарт: left = Y+X, right = Y-X (X>0 → вправо)
    // При MOTOR_INVERT поворот зеркалится → меняем знак X между сторонами
    int16_t leftSpeed  = y - x;
    int16_t rightSpeed = y + x;
    
    // Нормализация: если значения выходят за 255, масштабируем
    // Важно: сохраняем знак при нормализации!
    int16_t maxVal = max(abs(leftSpeed), abs(rightSpeed));
    if (maxVal > 255) {
        // Используем float для точного деления, затем округляем
        float scale = 255.0f / maxVal;
        leftSpeed  = (int16_t)(leftSpeed * scale);
        rightSpeed = (int16_t)(rightSpeed * scale);
    }
    
    // --- Программная инверсия сторон (config.h) ---
    // Применяется ПОСЛЕ микшера, чтобы не ломать tankToXY ↔ XY преобразование
    #if MOTOR_INVERT_LEFT
    leftSpeed = -leftSpeed;
    #endif
    #if MOTOR_INVERT_RIGHT
    rightSpeed = -rightSpeed;
    #endif
    
    // --- Применяем к моторам ---
    // Положительные значения — вперёд (FL, FR)
    // Отрицательные значения — назад (RL, RR)
    
    // Левая сторона (FL для вперёд, RL для назад)
    if (leftSpeed >= 0) {
        driveSetSpeed(MOTOR_FL, (uint8_t)leftSpeed);
        driveSetSpeed(MOTOR_RL, 0);
    } else {
        driveSetSpeed(MOTOR_FL, 0);
        driveSetSpeed(MOTOR_RL, (uint8_t)(-leftSpeed));
    }
    
    // Правая сторона (FR для вперёд, RR для назад)
    if (rightSpeed >= 0) {
        driveSetSpeed(MOTOR_FR, (uint8_t)rightSpeed);
        driveSetSpeed(MOTOR_RR, 0);
    } else {
        driveSetSpeed(MOTOR_FR, 0);
        driveSetSpeed(MOTOR_RR, (uint8_t)(-rightSpeed));
    }
    
    // Отладка (раскомментировать для проверки)
    Serial.printf("XY: x=%d y=%d | L=%d R=%d | FL=%d FR=%d RL=%d RR=%d\n",
        x, y, leftSpeed, rightSpeed,
        driveGetSpeed(MOTOR_FL), driveGetSpeed(MOTOR_FR),
        driveGetSpeed(MOTOR_RL), driveGetSpeed(MOTOR_RR));
    
    // Определяем направление по финальным скоростям (после инверсии)
    int16_t effectiveY = (leftSpeed + rightSpeed) / 2;
    int16_t effectiveX = (leftSpeed - rightSpeed) / 2;
    if (abs(effectiveY) > abs(effectiveX)) {
        state.direction = (effectiveY > 0) ? CTRL_FORWARD : CTRL_BACKWARD;
    } else {
        state.direction = (effectiveX > 0) ? CTRL_RIGHT : CTRL_LEFT;
    }
    state.speed = (uint8_t)max(abs(leftSpeed), abs(rightSpeed));
}

// ============================================================
// Принудительная остановка
// ============================================================

/**
 * @brief Немедленная остановка всех моторов
 * Деактивирует управление (active=false), вызывает driveStop().
 */
void controlStop() {
    state.direction = CTRL_STOP;
    state.speed = 0;
    state.active = false;
    
    // Останавливаем все моторы
    driveStop();
}

// ============================================================
// Геттеры состояния
// ============================================================

const ControlState& controlGetState() {
    return state;
}

bool controlIsActive() {
    return state.active;
}

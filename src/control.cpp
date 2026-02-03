#include "control.h"
#include "drive.h"
#include "config.h"

// ============================================================
// 🎮 Модуль управления — реализация
// ============================================================

// --- Внутреннее состояние ---
static ControlState state = {
    .direction = CTRL_STOP,
    .speed = 0,
    .lastCommandMs = 0,
    .active = false
};

// ============================================================
// Инициализация
// ============================================================

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

void controlSetXY(int16_t x, int16_t y) {
    // Обновляем watchdog
    state.lastCommandMs = millis();
    
    // Ограничиваем входные значения
    x = constrain(x, -255, 255);
    y = constrain(y, -255, 255);
    
    // Мёртвая зона (deadzone) — игнорируем малые отклонения
    const int16_t DEADZONE = 20;
    if (abs(x) < DEADZONE && abs(y) < DEADZONE) {
        // Джойстик в центре — остановка
        controlStop();
        return;
    }
    
    // Активируем управление
    state.active = true;
    
    // --- Микширование для skid-steer ---
    // leftSpeed  = Y + X  (положительный X поворачивает вправо → левая сторона быстрее)
    // rightSpeed = Y - X
    int16_t leftSpeed  = y + x;
    int16_t rightSpeed = y - x;
    
    // Нормализация: если значения выходят за 255, масштабируем
    int16_t maxVal = max(abs(leftSpeed), abs(rightSpeed));
    if (maxVal > 255) {
        leftSpeed  = leftSpeed  * 255 / maxVal;
        rightSpeed = rightSpeed * 255 / maxVal;
    }
    
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
    
    // Сохраняем примерное направление для отладки
    if (abs(y) > abs(x)) {
        state.direction = (y > 0) ? CTRL_FORWARD : CTRL_BACKWARD;
    } else {
        state.direction = (x > 0) ? CTRL_RIGHT : CTRL_LEFT;
    }
    state.speed = (uint8_t)max(abs(leftSpeed), abs(rightSpeed));
}

// ============================================================
// Принудительная остановка
// ============================================================

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

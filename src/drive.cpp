#include "drive.h"
#include "config.h"

// ============================================================
// 🚗 Управление движением — реализация
// ============================================================

// Пины и каналы LEDC
static const uint8_t pwmPins[MOTOR_COUNT] = {
    PWM_PIN_FL, PWM_PIN_FR, PWM_PIN_RL, PWM_PIN_RR
};
static const uint8_t pwmChannels[MOTOR_COUNT] = {
    PWM_CH_FL, PWM_CH_FR, PWM_CH_RL, PWM_CH_RR
};

// Текущее состояние
static DriveState state = {{0, 0, 0, 0}};

// Демо переменные
static uint8_t demoStep = 0;
static unsigned long demoLastMs = 0;

// --- Внутренняя функция: применить PWM ---
static void applyPwm(Motor motor) {
    if (motor >= MOTOR_COUNT) return;
    ledcWrite(pwmChannels[motor], state.speed[motor]);
}

// --- Инициализация ---
void driveInit() {
    for (uint8_t i = 0; i < MOTOR_COUNT; i++) {
        ledcSetup(pwmChannels[i], PWM_FREQ, PWM_RESOLUTION);
        ledcAttachPin(pwmPins[i], pwmChannels[i]);
        ledcWrite(pwmChannels[i], 0);
        state.speed[i] = 0;
    }
    demoLastMs = millis();
}

// --- Получение состояния ---
const DriveState& driveGetState() {
    return state;
}

uint8_t driveGetSpeed(Motor motor) {
    if (motor >= MOTOR_COUNT) return 0;
    return state.speed[motor];
}

// --- Установка скорости ---
void driveSetSpeed(Motor motor, uint8_t speed) {
    if (motor >= MOTOR_COUNT) return;
    state.speed[motor] = (speed > PWM_MAX_DUTY) ? PWM_MAX_DUTY : speed;
    applyPwm(motor);
}

// --- Инкремент ---
void driveIncrement(Motor motor, uint8_t step) {
    if (motor >= MOTOR_COUNT) return;
    uint16_t newSpeed = state.speed[motor] + step;
    driveSetSpeed(motor, (newSpeed > PWM_MAX_DUTY) ? PWM_MAX_DUTY : newSpeed);
}

// --- Декремент ---
void driveDecrement(Motor motor, uint8_t step) {
    if (motor >= MOTOR_COUNT) return;
    int16_t newSpeed = (int16_t)state.speed[motor] - step;
    driveSetSpeed(motor, (newSpeed < 0) ? 0 : newSpeed);
}

// --- Стоп ---
void driveStop() {
    for (uint8_t i = 0; i < MOTOR_COUNT; i++) {
        driveSetSpeed((Motor)i, 0);
    }
}

// --- Вперёд: FL + FR ---
void driveForward(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, speed);
    driveSetSpeed(MOTOR_FR, speed);
    driveSetSpeed(MOTOR_RL, 0);
    driveSetSpeed(MOTOR_RR, 0);
}

// --- Назад: RL + RR ---
void driveBackward(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, 0);
    driveSetSpeed(MOTOR_FR, 0);
    driveSetSpeed(MOTOR_RL, speed);
    driveSetSpeed(MOTOR_RR, speed);
}

// --- Поворот влево: правая сторона вперёд ---
void driveTurnLeft(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, 0);
    driveSetSpeed(MOTOR_FR, speed);
    driveSetSpeed(MOTOR_RL, 0);
    driveSetSpeed(MOTOR_RR, 0);
}

// --- Поворот вправо: левая сторона вперёд ---
void driveTurnRight(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, speed);
    driveSetSpeed(MOTOR_FR, 0);
    driveSetSpeed(MOTOR_RL, 0);
    driveSetSpeed(MOTOR_RR, 0);
}

// --- Разворот влево: правая вперёд, левая назад ---
void driveRotateLeft(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, 0);
    driveSetSpeed(MOTOR_FR, speed);
    driveSetSpeed(MOTOR_RL, speed);
    driveSetSpeed(MOTOR_RR, 0);
}

// --- Разворот вправо: левая вперёд, правая назад ---
void driveRotateRight(uint8_t speed) {
    driveSetSpeed(MOTOR_FL, speed);
    driveSetSpeed(MOTOR_FR, 0);
    driveSetSpeed(MOTOR_RL, 0);
    driveSetSpeed(MOTOR_RR, speed);
}

// --- Демо режим: тестовые паттерны ---
void driveDemoUpdate() {
    unsigned long now = millis();
    if (now - demoLastMs < DEMO_STEP_MS) return;
    demoLastMs = now;

    demoStep = (demoStep + 1) % 16;
    driveStop();  // Сначала всё выключаем
    
    switch (demoStep) {
        // === Одиночные моторы ===
        case 0:
            Serial.println("🔴 [1/16] FL only");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);
            break;
        case 1:
            Serial.println("🟠 [2/16] FR only");
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);
            break;
        case 2:
            Serial.println("🟡 [3/16] RL only");
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            break;
        case 3:
            Serial.println("🟢 [4/16] RR only");
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            break;

        // === Парные: левая/правая сторона ===
        case 4:
            Serial.println("⬅️ [5/16] LEFT side (FL + RL)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            break;
        case 5:
            Serial.println("➡️ [6/16] RIGHT side (FR + RR)");
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            break;

        // === Парные: перед/зад ===
        case 6:
            Serial.println("⬆️ [7/16] FRONT (FL + FR)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);
            break;
        case 7:
            Serial.println("⬇️ [8/16] REAR (RL + RR)");
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            break;

        // === Диагонали ===
        case 8:
            Serial.println("↗️ [9/16] DIAG 1 (FL + RR)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            break;
        case 9:
            Serial.println("↖️ [10/16] DIAG 2 (FR + RL)");
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            break;

        // === Все 4 вместе ===
        case 10:
            Serial.println("🔵 [11/16] ALL motors");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            break;

        // === Танковый разворот (гусеницы) ===
        case 11:
            Serial.println("🔄 [12/16] TANK LEFT (right fwd, left back)");
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_DEFAULT);  // правая вперёд
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_DEFAULT);
            // FL, RL = 0 (в реале назад, но у нас LED)
            break;
        case 12:
            Serial.println("🔃 [13/16] TANK RIGHT (left fwd, right back)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_DEFAULT);  // левая вперёд
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_DEFAULT);
            // FR, RR = 0 (в реале назад)
            break;

        // === Плавное нарастание ===
        case 13:
            Serial.println("📈 [14/16] RAMP UP all (low)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_RAMP_LOW);
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_RAMP_LOW);
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_RAMP_LOW);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_RAMP_LOW);
            break;
        case 14:
            Serial.println("📈 [15/16] RAMP UP all (mid)");
            driveSetSpeed(MOTOR_FL, DEMO_SPEED_RAMP_MID);
            driveSetSpeed(MOTOR_FR, DEMO_SPEED_RAMP_MID);
            driveSetSpeed(MOTOR_RL, DEMO_SPEED_RAMP_MID);
            driveSetSpeed(MOTOR_RR, DEMO_SPEED_RAMP_MID);
            break;

        // === Стоп ===
        case 15:
            Serial.println("🛑 [16/16] STOP");
            driveStop();
            break;
    }
}

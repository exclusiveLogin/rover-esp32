/**
 * ============================================================
 * servo.cpp — Управление сервоприводом SG90 (pan, ось X)
 * ============================================================
 *
 * LEDC PWM 50Hz (20ms период). SG90: 500µs = 0°, 2400µs = 180°.
 * Интерполяция по времени: servoUpdate() в loop().
 *
 * Контракт API: POST { "deg": 90, "speed": 80 }
 *   deg   — целевой угол 0–180°
 *   speed — время достижения (мс)
 *
 * ============================================================
 */

#include "servo.h"
#include "config.h"

#define SERVO_FREQ_HZ    50   // Частота PWM для SG90 (стандарт)
#define SERVO_RESOLUTION 16  // 16-bit для точности duty
#define SERVO_PERIOD_US  20000  // 50Hz = 20ms период

// --- Состояние интерполяции ---
//
// s_current    — текущий угол (float, для плавного lerp)
// s_startAngle — угол в момент вызова servoSetTarget (начало перехода)
// s_target     — целевой угол из контракта { deg }
// s_startMs    — millis() при старте перехода
// s_durationMs — длительность перехода (мс) из контракта { speed }; 0 = серва на месте
//
static float s_current = (float)SERVO_DEFAULT;      // Текущий угол сервы (float — для плавного lerp)
static float s_startAngle = (float)SERVO_DEFAULT;  // Угол, с которого начали переход (при servoSetTarget)
static uint8_t s_target = SERVO_DEFAULT;            // Целевой угол, к которому движемся
static unsigned long s_startMs = 0;                 // millis() в момент начала перехода
static uint16_t s_durationMs = 0;                   // За сколько мс дойти до цели; 0 = стоим, анимации нет
static unsigned long s_idleStartMs = 0;              // millis() когда lerp завершился (старт отсчёта idle)
static bool s_pwmActive = false;                     // true = PWM сигнал подаётся, false = снят (тишина)

/**
 * Применить угол к PWM (LEDC).
 * angle — угол 0–180°; переводим в pulseUs 500..2400 для SG90.
 */
static void applyAngle(float angle) {
    if (angle < 0) angle = 0;
    if (angle > 180) angle = 180;
#if SERVO_INVERT
    angle = 180.0f - angle;  // 0°↔180° зеркально
#endif
    int pulseUs = SERVO_MIN_US + (SERVO_MAX_US - SERVO_MIN_US) * (int)angle / 180;  // Ширина импульса (мкс)
    uint32_t duty = (uint32_t)pulseUs * 65536UL / SERVO_PERIOD_US;  // Duty для 16-bit LEDC
    ledcWrite(SERVO_CHANNEL, (uint32_t)duty);
    s_pwmActive = true;  // PWM подаётся
}

/** Снять PWM — серва замолкает, но перестаёт удерживать позицию */
static void detachPwm() {
    ledcWrite(SERVO_CHANNEL, 0);  // Duty = 0 — нет импульса
    s_pwmActive = false;
}

void servoInit() {
    ledcSetup(SERVO_CHANNEL, SERVO_FREQ_HZ, SERVO_RESOLUTION);
    ledcAttachPin(SERVO_PIN, SERVO_CHANNEL);
    s_current = SERVO_DEFAULT;
    s_target = SERVO_DEFAULT;
    s_durationMs = 0;
    applyAngle(s_current);
    Serial.printf("servo: GPIO %d, angle %d\n", SERVO_PIN, SERVO_DEFAULT);
}

void servoSetTarget(uint8_t angle, uint16_t durationMs) {
    if (angle > 180) angle = 180;
    // Любая команда сбрасывает idle-таймер (даже если deadzone отсечёт движение)
    s_idleStartMs = millis();
    // Deadzone: разница меньше порога — игнорируем (гасит дребезг от частых мелких команд)
    int diff = (int)angle - (int)(s_current + 0.5f);  // Разница: новая цель − текущий угол (со знаком)
    if (diff < 0) diff = -diff;                        // Абсолютное значение разницы (°)
    if (diff < SERVO_DEADZONE) {
        return;  // Слишком маленькое изменение — не дёргаем серву
    }
    // Если PWM был снят (idle) — сначала подаём текущий угол, чтобы серва не дёрнулась
    if (!s_pwmActive) {
        applyAngle(s_current);
    }
    s_startAngle = s_current;   // Стартовая точка lerp (где сейчас)
    s_target = angle;            // Конечная точка lerp (куда едем)
    s_startMs = millis();        // Отсчёт времени перехода
    s_durationMs = (durationMs > 0) ? durationMs : 1;  // Длительность перехода (мс)
}

/**
 * Обновить интерполяцию. Вызывать в loop() (~50 Гц).
 * Отсечка: s_durationMs == 0 → сразу выход (серва на месте, цикл не грузим).
 */
void servoUpdate() {
    // --- Idle-таймаут: снять PWM через SERVO_IDLE_MS после остановки ---
    if (s_durationMs == 0) {
        if (s_pwmActive && SERVO_IDLE_MS > 0 && s_idleStartMs > 0) {
            if (millis() - s_idleStartMs >= SERVO_IDLE_MS) {
                detachPwm();  // Тишина: серва перестаёт жужжать
            }
        }
        return;
    }

    unsigned long now = millis();
    unsigned long elapsed = now - s_startMs;   // Сколько мс прошло с начала перехода
    float t = (float)elapsed / (float)s_durationMs;  // Прогресс 0..1 (0=старт, 1=финиш)
    if (t >= 1.0f) {
        s_current = (float)s_target;
        s_durationMs = 0;          // Переход завершён
        s_idleStartMs = millis();  // Начинаем отсчёт idle-таймаута
    } else {
        s_current = s_startAngle + ((float)s_target - s_startAngle) * t;  // Lerp
    }
    applyAngle(s_current);
}

uint8_t servoGetAngle() {
    return (uint8_t)(s_current + 0.5f);  // Округление до целого
}

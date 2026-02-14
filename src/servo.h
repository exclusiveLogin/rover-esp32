/**
 * ============================================================
 * servo.h — Управление сервоприводом SG90 (pan, ось X)
 * ============================================================
 *
 * LEDC PWM 50Hz, угол 0–180°.
 * Конфиг: config.h (SERVO_PIN, SERVO_CHANNEL, SERVO_MIN_US, SERVO_MAX_US)
 *
 * Поток: frontend POST { deg, speed } → servoSetTarget() → servoUpdate() в loop()
 *
 * ============================================================
 */

#ifndef SERVO_H
#define SERVO_H

#include <Arduino.h>

/** @brief Инициализация LEDC и пина. Вызывать в setup(). */
void servoInit();

/**
 * @brief Установить целевой угол с длительностью перехода.
 * @param angle      Целевой угол 0–180°
 * @param durationMs Время достижения (мс). Интерполяция от текущей позиции.
 *                   Вызывать servoUpdate() в loop() для анимации.
 */
void servoSetTarget(uint8_t angle, uint16_t durationMs);

/** @brief Обновить интерполяцию. Вызывать в loop() (~50 Гц). */
void servoUpdate();

/** @brief Получить текущий угол (округлённый) */
uint8_t servoGetAngle();

#endif // SERVO_H

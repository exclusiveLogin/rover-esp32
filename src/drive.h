#ifndef DRIVE_H
#define DRIVE_H

#include <Arduino.h>

// ============================================================
// 🚗 Управление движением (PWM / LED-имитация)
// ============================================================

// Индексы моторов
enum Motor : uint8_t {
    MOTOR_FL = 0,  // Front Left
    MOTOR_FR = 1,  // Front Right
    MOTOR_RL = 2,  // Rear Left
    MOTOR_RR = 3,  // Rear Right
    MOTOR_COUNT = 4
};

// Структура состояния моторов
struct DriveState {
    uint8_t speed[MOTOR_COUNT];  // 0-255 для каждого мотора
};

// --- Инициализация ---
void driveInit();

// --- Получение состояния ---
const DriveState& driveGetState();
uint8_t driveGetSpeed(Motor motor);

// --- Установка скорости отдельного мотора ---
void driveSetSpeed(Motor motor, uint8_t speed);

// --- Инкремент/декремент ---
void driveIncrement(Motor motor, uint8_t step = 10);
void driveDecrement(Motor motor, uint8_t step = 10);

// --- Команды движения (все моторы) ---
void driveStop();
void driveForward(uint8_t speed);
void driveBackward(uint8_t speed);
void driveTurnLeft(uint8_t speed);
void driveTurnRight(uint8_t speed);
void driveRotateLeft(uint8_t speed);
void driveRotateRight(uint8_t speed);

// --- Демо режим ---
void driveDemoUpdate();  // Вызывать в loop() для демо

#endif // DRIVE_H

/**
 * ============================================================
 * 🔧 config.h — Центральная конфигурация ESP32-CAM Rover
 * ============================================================
 *
 * Все аппаратные настройки в одном месте:
 *   - WiFi credentials
 *   - Пины камеры OV2640 (AI-Thinker ESP32-CAM)
 *   - Пины и каналы PWM для моторов
 *   - Порты HTTP-серверов
 *   - Параметры управления (watchdog, deadzone)
 *   - Параметры демо-режима
 *
 * ============================================================
 */

#ifndef CONFIG_H
#define CONFIG_H

// --- WiFi ---
#define WIFI_SSID     "FoxNet"
#define WIFI_PASSWORD "foxonline"

// --- Камера AI-Thinker ESP32-CAM (OV2640) ---
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1

// Переворот изображения (0=выкл, 1=вкл)
#define CAM_VFLIP       1   // Вертикальный переворот (по вертикали)
#define CAM_HMIRROR     1   // Горизонтальное зеркало (по горизонтали)
#define CAM_PIN_XCLK    0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27
#define CAM_PIN_Y9      35
#define CAM_PIN_Y8      34
#define CAM_PIN_Y7      39
#define CAM_PIN_Y6      36
#define CAM_PIN_Y5      21
#define CAM_PIN_Y4      19
#define CAM_PIN_Y3      18
#define CAM_PIN_Y2      5
#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

// --- IR LED (подсветка) ---
#define PIN_IR_LED      4

// --- PWM моторы (LED-имитация) ---
//     FL = Front Left,  FR = Front Right
//     RL = Rear Left,   RR = Rear Right
#define PWM_PIN_FL      12
#define PWM_PIN_FR      13
#define PWM_PIN_RL      14
#define PWM_PIN_RR      15

#define PWM_FREQ        5000
#define PWM_RESOLUTION  8
#define PWM_MAX_DUTY    255

// LEDC каналы (0 занят камерой)
#define PWM_CH_FL       1
#define PWM_CH_FR       2
#define PWM_CH_RL       3
#define PWM_CH_RR       4

// --- Servo Pan (SG90 на X-ось) ---
#define SERVO_PIN       2     // GPIO 2 (T2) — сигнал PWM
#define SERVO_CHANNEL   5     // LEDC канал (0=камера, 1-4=моторы)
#define SERVO_MIN_US    500   // SG90: ширина импульса для 0°
#define SERVO_MAX_US    2400  // SG90: ширина импульса для 180°
#define SERVO_DEFAULT   90   // Начальный угол при старте
#define SERVO_DEADZONE  3    // Мёртвая зона (°): разница < 3° — игнорируем, гасит дребезг
#define SERVO_IDLE_MS   500  // Через сколько мс после остановки снять PWM (тишина, 0 = не снимать)

// --- HTTP серверы ---
#define HTTP_PORT_MAIN   80
#define HTTP_PORT_STREAM 81

// --- Управление (Control) ---
#define CONTROL_TIMEOUT_MS   2000  // Watchdog таймаут (мс) — стоп если нет команд (2 сек)
#define CONTROL_DEADZONE     20    // Мёртвая зона джойстика (игнорируем малые отклонения)

// --- Демо режим ---
#define DEMO_STEP_MS         2000  // Длительность одного шага демо (мс)
#define DEMO_SPEED_DEFAULT   200   // Скорость в демо режиме
#define DEMO_SPEED_RAMP_LOW  50    // Низкая скорость для ramp
#define DEMO_SPEED_RAMP_MID  150   // Средняя скорость для ramp

#endif // CONFIG_H

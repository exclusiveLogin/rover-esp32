#ifndef CONFIG_H
#define CONFIG_H

// ============================================================
// 🔧 ESP32-CAM Rover — Конфигурация
// ============================================================

// --- WiFi ---
#define WIFI_SSID     "FoxNet"
#define WIFI_PASSWORD "foxonline"

// --- Камера AI-Thinker ESP32-CAM ---
#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
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

// --- HTTP серверы ---
#define HTTP_PORT_MAIN   80
#define HTTP_PORT_STREAM 81

#endif // CONFIG_H

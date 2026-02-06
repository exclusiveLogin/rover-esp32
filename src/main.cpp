/**
 * ============================================================
 * 🚀 main.cpp — Точка входа ESP32-CAM Rover
 * ============================================================
 *
 * Порядок инициализации (setup):
 *   1. Serial (115200 baud)
 *   2. IR LED пин (GPIO 4)
 *   3. PWM моторы (driveInit)
 *   4. Модуль управления с watchdog (controlInit)
 *   5. SPIFFS файловая система (для веб-интерфейса)
 *   6. Камера OV2640 (cameraInit)
 *   7. WiFi (STA-режим, ожидание подключения)
 *   8. HTTP-сервер на порту 80 (webserverStartMain, Core 1)
 *   9. MJPEG стрим-сервер на порту 81 (streamServerTask, Core 0)
 *
 * Основной цикл (loop, ~50 Гц):
 *   - controlUpdate() — watchdog-проверка таймаута команд
 *   - WiFi reconnect — раз в 10 сек проверка связи
 *
 * ============================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <SPIFFS.h>

#include "config.h"
#include "camera.h"
#include "drive.h"
#include "control.h"
#include "webserver.h"

void setup() {
    Serial.begin(115200);
    Serial.println("\n🚀 ESP32-CAM Rover запускается...");

    // IR LED
    pinMode(PIN_IR_LED, OUTPUT);
    digitalWrite(PIN_IR_LED, LOW);

    // PWM / моторы
    driveInit();
    Serial.println("✅ PWM инициализирован");

    // Модуль управления с watchdog
    controlInit();

    // SPIFFS
    if (!SPIFFS.begin(true)) {
        Serial.println("❌ SPIFFS Error");
    } else {
        Serial.println("✅ SPIFFS OK");
    }

    // Камера
    if (!cameraInit()) {
        Serial.println("❌ Camera Error");
        while (1) { delay(1000); }
    }

    // WiFi
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("📶 Подключение к WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.printf("✅ WiFi подключен! IP: %s\n", WiFi.localIP().toString().c_str());

    // HTTP сервер (порт 80) — Core 1
    webserverStartMain();

    // Стрим-сервер (порт 81) — Core 0
    xTaskCreatePinnedToCore(
        streamServerTask,
        "StreamServer",
        8192,
        NULL,
        1,
        NULL,
        0  // Core 0
    );

    // Инфо
    Serial.println("\n========================================");
    Serial.printf("🌐 Web UI:    http://%s/\n", WiFi.localIP().toString().c_str());
    Serial.printf("📹 Стрим:     http://%s:%d/stream\n", WiFi.localIP().toString().c_str(), HTTP_PORT_STREAM);
    Serial.printf("📷 Фото:      http://%s/photo\n", WiFi.localIP().toString().c_str());
    Serial.printf("💡 LED:       http://%s/led\n", WiFi.localIP().toString().c_str());
    Serial.printf("🔧 Drive API:   http://%s/api/drive   (отладка)\n", WiFi.localIP().toString().c_str());
    Serial.printf("🎮 Control API: http://%s/api/control (с watchdog)\n", WiFi.localIP().toString().c_str());
    Serial.printf("📊 Status API:  http://%s/api/status  (телеметрия)\n", WiFi.localIP().toString().c_str());
    Serial.println("========================================\n");
}

void loop() {
    // =========================================================
    // 🎮 Watchdog управления — ОБЯЗАТЕЛЬНО вызывать!
    // Проверяет таймаут и останавливает моторы если нет команд
    // =========================================================
    controlUpdate();

    // Демо движений (удалить при реальном управлении)
    // driveDemoUpdate();

    // Проверка WiFi (раз в 10 сек)
    static unsigned long lastWifiCheck = 0;
    if (millis() - lastWifiCheck >= 10000) {
        lastWifiCheck = millis();
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("⚠️ WiFi отключен, переподключение...");
            WiFi.reconnect();
        }
    }

    // ~50 Гц цикл для плавного управления
    vTaskDelay(pdMS_TO_TICKS(20));
}

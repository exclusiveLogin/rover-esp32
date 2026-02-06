/**
 * ============================================================
 * 🌐 webserver.h — Интерфейс HTTP-серверов ESP32-CAM Rover
 * ============================================================
 *
 * Два сервера:
 *   • webserverStartMain() — основной HTTP (порт 80): статика + REST API
 *   • streamServerTask()   — MJPEG стрим (порт 81): raw TCP, round-robin
 *
 * Стрим-сервер запускается как FreeRTOS-задача на Core 0.
 * Основной сервер работает в контексте httpd (esp_http_server).
 *
 * ============================================================
 */

#ifndef WEBSERVER_H
#define WEBSERVER_H

#include <Arduino.h>

/**
 * @brief Запуск основного HTTP-сервера на порту HTTP_PORT_MAIN (80)
 *
 * Регистрирует все URI-обработчики:
 *   - Статика: /, /config.js, /control.js, /style.css и др.
 *   - API:     /api/drive, /api/control, /api/status, /photo, /led
 *
 * Вызывать после WiFi.begin() и SPIFFS.begin().
 */
void webserverStartMain();

/**
 * @brief FreeRTOS-задача MJPEG стрим-сервера (порт HTTP_PORT_STREAM = 81)
 *
 * Реализация:
 *   - Raw TCP-сервер с non-blocking accept
 *   - Round-robin раздача кадров между клиентами
 *   - До STREAM_MAX_CLIENTS (4) одновременных подключений
 *
 * Запуск:
 *   xTaskCreatePinnedToCore(streamServerTask, "stream", 4096, NULL, 1, NULL, 0);
 *
 * @param pvParameters Не используется (NULL)
 */
void streamServerTask(void* pvParameters);

#endif // WEBSERVER_H

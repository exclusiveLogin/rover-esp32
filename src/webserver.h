#ifndef WEBSERVER_H
#define WEBSERVER_H

#include <Arduino.h>

// ============================================================
// 🌐 HTTP серверы
// ============================================================

// --- Запуск серверов ---
void webserverStartMain();       // Порт 80 — UI, API
void webserverStartStream();     // Порт 81 — MJPEG стрим (вызывать на Core 0)

// --- Задача стрим-сервера для xTaskCreatePinnedToCore ---
void streamServerTask(void* pvParameters);

#endif // WEBSERVER_H

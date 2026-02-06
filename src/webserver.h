#ifndef WEBSERVER_H
#define WEBSERVER_H

#include <Arduino.h>

// ============================================================
// 🌐 HTTP серверы
// ============================================================

// --- Запуск серверов ---
void webserverStartMain();       // Порт 80 — UI, API

// --- Стрим-сервер (Raw TCP, Round-Robin, порт 81) ---
// Запускать как задачу на Core 0 через xTaskCreatePinnedToCore
void streamServerTask(void* pvParameters);

#endif // WEBSERVER_H

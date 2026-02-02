#ifndef CAMERA_H
#define CAMERA_H

#include <Arduino.h>
#include <esp_camera.h>

// ============================================================
// 📷 Камера ESP32-CAM
// ============================================================

// Семафор для синхронизации доступа к камере
extern SemaphoreHandle_t cameraSemaphore;

// --- Инициализация ---
bool cameraInit();

// --- Получение кадра (thread-safe) ---
// Возвращает framebuffer, нужно вернуть через esp_camera_fb_return()
camera_fb_t* cameraCapture(uint32_t timeoutMs = 500);

#endif // CAMERA_H

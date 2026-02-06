/**
 * ============================================================
 * 📷 camera.cpp — Модуль камеры ESP32-CAM
 * ============================================================
 *
 * Инициализация и потокобезопасный захват кадров с OV2640.
 *
 * Особенности:
 *   - Доступ к камере защищён мьютексом (cameraSemaphore),
 *     т.к. камеру используют и стрим-сервер (Core 0),
 *     и обработчик /photo (Core 1)
 *   - Формат: JPEG, VGA (640x480), quality=12
 *   - Двойной фреймбуфер (fb_count=2) для плавного стрима
 *   - Поддержка vflip/hmirror через OV2640 сенсор (без CPU)
 *
 * Зависимости:
 *   - esp_camera.h — драйвер камеры ESP-IDF
 *   - config.h     — пины камеры AI-Thinker
 *
 * ============================================================
 */

#include "camera.h"
#include "config.h"

// --- Глобальные переменные ---

SemaphoreHandle_t cameraSemaphore = NULL;  // Мьютекс для синхронизации доступа к камере

/**
 * @brief Инициализация камеры OV2640
 *
 * Создаёт мьютекс, конфигурирует пины и параметры съёмки,
 * запускает драйвер камеры, применяет настройки переворота.
 *
 * @return true — камера готова, false — ошибка инициализации
 */
bool cameraInit() {
    // Создание мьютекса для потокобезопасного доступа
    cameraSemaphore = xSemaphoreCreateMutex();
    if (cameraSemaphore == NULL) {
        Serial.println("❌ Ошибка создания семафора камеры");
        return false;
    }

    // Конфигурация камеры
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    
    config.pin_d0       = CAM_PIN_Y2;
    config.pin_d1       = CAM_PIN_Y3;
    config.pin_d2       = CAM_PIN_Y4;
    config.pin_d3       = CAM_PIN_Y5;
    config.pin_d4       = CAM_PIN_Y6;
    config.pin_d5       = CAM_PIN_Y7;
    config.pin_d6       = CAM_PIN_Y8;
    config.pin_d7       = CAM_PIN_Y9;
    
    config.pin_xclk     = CAM_PIN_XCLK;
    config.pin_pclk     = CAM_PIN_PCLK;
    config.pin_vsync    = CAM_PIN_VSYNC;
    config.pin_href     = CAM_PIN_HREF;
    config.pin_sccb_sda = CAM_PIN_SIOD;
    config.pin_sccb_scl = CAM_PIN_SIOC;
    config.pin_pwdn     = CAM_PIN_PWDN;
    config.pin_reset    = CAM_PIN_RESET;
    
    config.xclk_freq_hz = 20000000;     // Тактовая частота XCLK (20 МГц)
    config.pixel_format = PIXFORMAT_JPEG; // Аппаратное JPEG-сжатие на OV2640
    config.frame_size   = FRAMESIZE_VGA;  // 640x480 — баланс качества и скорости
    config.jpeg_quality = 12;             // Качество JPEG (0-63, меньше = лучше)
    config.fb_count     = 2;              // Двойной буфер для непрерывного стрима

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("❌ Ошибка инициализации камеры: 0x%x\n", err);
        return false;
    }

    // --- Переворот изображения (на стороне сенсора, без canvas) ---
    // OV2640 поддерживает set_vflip и set_hmirror
    sensor_t* sensor = esp_camera_sensor_get();
    if (sensor) {
        sensor->set_vflip(sensor, CAM_VFLIP);    // Вертикально (0/1)
        sensor->set_hmirror(sensor, CAM_HMIRROR); // Горизонтально (0/1)
        Serial.printf("   📷 Flip: vflip=%d, hmirror=%d\n", CAM_VFLIP, CAM_HMIRROR);
    }

    Serial.println("✅ Камера инициализирована");
    return true;
}

/**
 * @brief Потокобезопасный захват JPEG-кадра с камеры
 *
 * Ждёт мьютекс до timeoutMs, захватывает кадр через esp_camera_fb_get(),
 * затем освобождает мьютекс. Вызывающий код ОБЯЗАН вернуть буфер через
 * esp_camera_fb_return(fb) после использования.
 *
 * @param timeoutMs Макс. время ожидания мьютекса (мс), по умолчанию 500
 * @return Указатель на framebuffer (JPEG) или NULL при таймауте/ошибке
 */
camera_fb_t* cameraCapture(uint32_t timeoutMs) {
    if (cameraSemaphore == NULL) return NULL;
    
    camera_fb_t* fb = NULL;
    
    // Пытаемся захватить мьютекс в пределах таймаута
    if (xSemaphoreTake(cameraSemaphore, pdMS_TO_TICKS(timeoutMs)) == pdTRUE) {
        fb = esp_camera_fb_get();
        xSemaphoreGive(cameraSemaphore);
    }
    
    return fb;
}

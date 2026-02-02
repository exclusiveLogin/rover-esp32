#include "camera.h"
#include "config.h"

// ============================================================
// 📷 Камера — реализация
// ============================================================

SemaphoreHandle_t cameraSemaphore = NULL;

bool cameraInit() {
    // Создание семафора
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
    
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    config.frame_size   = FRAMESIZE_VGA;
    config.jpeg_quality = 12;
    config.fb_count     = 2;

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("❌ Ошибка инициализации камеры: 0x%x\n", err);
        return false;
    }

    Serial.println("✅ Камера инициализирована");
    return true;
}

camera_fb_t* cameraCapture(uint32_t timeoutMs) {
    if (cameraSemaphore == NULL) return NULL;
    
    camera_fb_t* fb = NULL;
    
    if (xSemaphoreTake(cameraSemaphore, pdMS_TO_TICKS(timeoutMs)) == pdTRUE) {
        fb = esp_camera_fb_get();
        xSemaphoreGive(cameraSemaphore);
    }
    
    return fb;
}

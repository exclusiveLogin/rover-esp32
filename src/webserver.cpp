#include "webserver.h"
#include "config.h"
#include "camera.h"
#include "drive.h"
#include "control.h"  // Модуль управления с watchdog
#include <esp_http_server.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>

// ============================================================
// 🌐 HTTP серверы — реализация
// ============================================================

static httpd_handle_t mainHttpd   = NULL;
static httpd_handle_t streamHttpd = NULL;

// IR LED состояние
static bool irLedOn = false;

// ============================================================
// 📹 MJPEG Стрим
// ============================================================

static esp_err_t streamHandler(httpd_req_t* req) {
    #define BOUNDARY "----ESP32CAM_MJPEG"
    static const char* CONTENT_TYPE  = "multipart/x-mixed-replace;boundary=" BOUNDARY;
    static const char* PART_BOUNDARY = "\r\n--" BOUNDARY "\r\n";
    static const char* PART_HEADER   = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

    esp_err_t res = httpd_resp_set_type(req, CONTENT_TYPE);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");
    if (res != ESP_OK) return res;

    Serial.printf("🎥 Стрим запущен на Core %d\n", xPortGetCoreID());

    char partBuf[64];
    while (true) {
        camera_fb_t* fb = cameraCapture(100);
        if (!fb) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        res = httpd_resp_send_chunk(req, PART_BOUNDARY, strlen(PART_BOUNDARY));
        if (res == ESP_OK) {
            size_t hlen = snprintf(partBuf, sizeof(partBuf), PART_HEADER, fb->len);
            res = httpd_resp_send_chunk(req, partBuf, hlen);
        }
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
        }

        esp_camera_fb_return(fb);
        if (res != ESP_OK) break;

        vTaskDelay(pdMS_TO_TICKS(50));  // ~20 FPS
    }

    Serial.println("🎥 Стрим остановлен");
    return res;
}

// ============================================================
// 📷 Фото
// ============================================================

static esp_err_t photoHandler(httpd_req_t* req) {
    camera_fb_t* fb = cameraCapture(500);
    if (!fb) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    esp_err_t res = httpd_resp_send(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return res;
}

// ============================================================
// 💡 LED
// ============================================================

static esp_err_t ledHandler(httpd_req_t* req) {
    if (req->method == HTTP_POST) {
        irLedOn = !irLedOn;
        digitalWrite(PIN_IR_LED, irLedOn ? HIGH : LOW);
    }

    char json[32];
    snprintf(json, sizeof(json), "{\"state\":%s}", irLedOn ? "true" : "false");
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, json, strlen(json));
}

// ============================================================
// 🚗 Drive API — /api/drive
// ============================================================

static esp_err_t driveApiHandler(httpd_req_t* req) {
    // CORS preflight
    if (req->method == HTTP_OPTIONS) {
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
        httpd_resp_send(req, NULL, 0);
        return ESP_OK;
    }

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_type(req, "application/json");

    // GET — вернуть текущее состояние
    if (req->method == HTTP_GET) {
        const DriveState& st = driveGetState();
        char json[128];
        snprintf(json, sizeof(json), 
            "{\"fl\":%d,\"fr\":%d,\"rl\":%d,\"rr\":%d}",
            st.speed[MOTOR_FL], st.speed[MOTOR_FR], 
            st.speed[MOTOR_RL], st.speed[MOTOR_RR]);
        return httpd_resp_send(req, json, strlen(json));
    }

    // POST — команда
    char body[256];
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty body");
        return ESP_FAIL;
    }
    body[len] = '\0';

    // Парсинг JSON (ArduinoJson v7)
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    const char* action = doc["action"] | "";
    const char* motorStr = doc["motor"] | "all";
    int value = doc["value"] | 10;

    // Определяем мотор
    Motor motor = MOTOR_FL;
    bool allMotors = false;
    if (strcmp(motorStr, "fl") == 0)      motor = MOTOR_FL;
    else if (strcmp(motorStr, "fr") == 0) motor = MOTOR_FR;
    else if (strcmp(motorStr, "rl") == 0) motor = MOTOR_RL;
    else if (strcmp(motorStr, "rr") == 0) motor = MOTOR_RR;
    else if (strcmp(motorStr, "all") == 0) allMotors = true;

    // Выполняем действие
    if (strcmp(action, "stop") == 0) {
        driveStop();
    } else if (strcmp(action, "set") == 0) {
        if (allMotors) {
            for (int i = 0; i < MOTOR_COUNT; i++) driveSetSpeed((Motor)i, value);
        } else {
            driveSetSpeed(motor, value);
        }
    } else if (strcmp(action, "increment") == 0) {
        if (allMotors) {
            for (int i = 0; i < MOTOR_COUNT; i++) driveIncrement((Motor)i, value);
        } else {
            driveIncrement(motor, value);
        }
    } else if (strcmp(action, "decrement") == 0) {
        if (allMotors) {
            for (int i = 0; i < MOTOR_COUNT; i++) driveDecrement((Motor)i, value);
        } else {
            driveDecrement(motor, value);
        }
    }

    // Возвращаем новое состояние
    const DriveState& st = driveGetState();
    char json[128];
    snprintf(json, sizeof(json), 
        "{\"fl\":%d,\"fr\":%d,\"rl\":%d,\"rr\":%d}",
        st.speed[MOTOR_FL], st.speed[MOTOR_FR], 
        st.speed[MOTOR_RL], st.speed[MOTOR_RR]);
    return httpd_resp_send(req, json, strlen(json));
}

// ============================================================
// 🎮 Control API — /api/control (с Watchdog таймаутом)
// ============================================================
//
// Этот эндпоинт для "живого" управления (джойстик, стики).
// В отличие от /api/drive (отладочный), здесь:
//   - Watchdog таймаут: моторы остановятся если нет команд
//   - Поддержка X/Y координат джойстика
//   - Упрощённые команды направления
//
// POST /api/control
// {
//   "type": "direction" | "xy" | "stop",
//   "direction": "forward" | "backward" | "left" | "right" | "rotate_left" | "rotate_right",
//   "speed": 0-255,
//   "x": -255..+255,  // для type: "xy"
//   "y": -255..+255   // для type: "xy"
// }
//
// GET /api/control — текущее состояние
//
// ============================================================

static esp_err_t controlApiHandler(httpd_req_t* req) {
    // --- CORS preflight ---
    if (req->method == HTTP_OPTIONS) {
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
        httpd_resp_send(req, NULL, 0);
        return ESP_OK;
    }

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_type(req, "application/json");

    // --- GET: вернуть состояние управления ---
    if (req->method == HTTP_GET) {
        const ControlState& st = controlGetState();
        const DriveState& drv = driveGetState();
        
        // Формируем JSON с полным состоянием
        char json[256];
        snprintf(json, sizeof(json), 
            "{"
            "\"active\":%s,"
            "\"direction\":%d,"
            "\"speed\":%d,"
            "\"motors\":{\"fl\":%d,\"fr\":%d,\"rl\":%d,\"rr\":%d},"
            "\"timeout_ms\":%d"
            "}",
            st.active ? "true" : "false",
            st.direction,
            st.speed,
            drv.speed[MOTOR_FL], drv.speed[MOTOR_FR],
            drv.speed[MOTOR_RL], drv.speed[MOTOR_RR],
            CONTROL_TIMEOUT_MS
        );
        return httpd_resp_send(req, json, strlen(json));
    }

    // --- POST: команда управления ---
    char body[256];
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty body");
        return ESP_FAIL;
    }
    body[len] = '\0';

    // Парсинг JSON
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    const char* type = doc["type"] | "stop";
    
    // --- Тип: stop ---
    if (strcmp(type, "stop") == 0) {
        controlStop();
    }
    // --- Тип: direction (направление + скорость) ---
    else if (strcmp(type, "direction") == 0) {
        const char* dir = doc["direction"] | "stop";
        uint8_t speed = doc["speed"] | 200;
        
        ControlDirection direction = CTRL_STOP;
        if (strcmp(dir, "forward") == 0)       direction = CTRL_FORWARD;
        else if (strcmp(dir, "backward") == 0) direction = CTRL_BACKWARD;
        else if (strcmp(dir, "left") == 0)     direction = CTRL_LEFT;
        else if (strcmp(dir, "right") == 0)    direction = CTRL_RIGHT;
        else if (strcmp(dir, "rotate_left") == 0)  direction = CTRL_ROTATE_LEFT;
        else if (strcmp(dir, "rotate_right") == 0) direction = CTRL_ROTATE_RIGHT;
        
        controlSetMovement(direction, speed);
    }
    // --- Тип: xy (джойстик) ---
    else if (strcmp(type, "xy") == 0) {
        int16_t x = doc["x"] | 0;
        int16_t y = doc["y"] | 0;
        controlSetXY(x, y);
    }

    // Возвращаем обновлённое состояние
    const ControlState& st = controlGetState();
    const DriveState& drv = driveGetState();
    char json[256];
    snprintf(json, sizeof(json), 
        "{"
        "\"active\":%s,"
        "\"direction\":%d,"
        "\"speed\":%d,"
        "\"motors\":{\"fl\":%d,\"fr\":%d,\"rl\":%d,\"rr\":%d}"
        "}",
        st.active ? "true" : "false",
        st.direction,
        st.speed,
        drv.speed[MOTOR_FL], drv.speed[MOTOR_FR],
        drv.speed[MOTOR_RL], drv.speed[MOTOR_RR]
    );
    return httpd_resp_send(req, json, strlen(json));
}

// ============================================================
// 📁 Статика (SPIFFS)
// ============================================================

static const char* getMimeType(const char* path) {
    if (strstr(path, ".html")) return "text/html";
    if (strstr(path, ".css"))  return "text/css";
    if (strstr(path, ".js"))   return "application/javascript";
    if (strstr(path, ".json")) return "application/json";
    if (strstr(path, ".png"))  return "image/png";
    if (strstr(path, ".jpg"))  return "image/jpeg";
    if (strstr(path, ".svg"))  return "image/svg+xml";
    if (strstr(path, ".ico"))  return "image/x-icon";
    return "text/plain";
}

static esp_err_t staticHandler(httpd_req_t* req) {
    char filepath[64];
    const char* uri = req->uri;

    if (strcmp(uri, "/") == 0) {
        strcpy(filepath, "/index.html");
    } else {
        snprintf(filepath, sizeof(filepath), "%s", uri);
    }

    File file = SPIFFS.open(filepath, "r");
    if (!file) {
        Serial.printf("❌ Файл не найден: %s\n", filepath);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, getMimeType(filepath));
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    if (!strstr(filepath, ".html")) {
        httpd_resp_set_hdr(req, "Cache-Control", "public, max-age=86400");
    }

    size_t fileSize = file.size();
    const size_t chunkSize = 1024;
    char* buf = (char*)malloc(chunkSize);
    if (!buf) {
        file.close();
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    size_t bytesRead;
    while ((bytesRead = file.readBytes(buf, chunkSize)) > 0) {
        if (httpd_resp_send_chunk(req, buf, bytesRead) != ESP_OK) {
            free(buf);
            file.close();
            return ESP_FAIL;
        }
    }
    httpd_resp_send_chunk(req, NULL, 0);

    free(buf);
    file.close();
    Serial.printf("✅ Отдан: %s (%d байт)\n", filepath, fileSize);
    return ESP_OK;
}

// ============================================================
// 🚀 Запуск серверов
// ============================================================

void webserverStartMain() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = HTTP_PORT_MAIN;
    config.ctrl_port = 32768;
    config.max_open_sockets = 5;
    config.max_uri_handlers = 20;
    config.lru_purge_enable = true;

    if (httpd_start(&mainHttpd, &config) != ESP_OK) {
        Serial.println("❌ Ошибка запуска основного сервера");
        return;
    }

    // Статика
    httpd_uri_t uriIndex   = {"/",            HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriConfigJs = {"/config.js",  HTTP_GET, staticHandler, NULL};  // Config
    httpd_uri_t uriCtrlJs  = {"/control.js",  HTTP_GET, staticHandler, NULL};  // ControlService
    httpd_uri_t uriJs      = {"/script.js",   HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriCss     = {"/style.css",   HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriLogo    = {"/logo.svg",    HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriFavicon = {"/favicon.ico", HTTP_GET, staticHandler, NULL};
    httpd_register_uri_handler(mainHttpd, &uriIndex);
    httpd_register_uri_handler(mainHttpd, &uriConfigJs);
    httpd_register_uri_handler(mainHttpd, &uriCtrlJs);
    httpd_register_uri_handler(mainHttpd, &uriJs);
    httpd_register_uri_handler(mainHttpd, &uriCss);
    httpd_register_uri_handler(mainHttpd, &uriLogo);
    httpd_register_uri_handler(mainHttpd, &uriFavicon);

    // API — отладка
    httpd_uri_t uriPhoto      = {"/photo",      HTTP_GET,  photoHandler,    NULL};
    httpd_uri_t uriLedGet     = {"/led",        HTTP_GET,  ledHandler,      NULL};
    httpd_uri_t uriLedToggle  = {"/led/toggle", HTTP_POST, ledHandler,      NULL};
    
    // API — /api/drive (отладочный: increment/decrement, БЕЗ таймаута)
    httpd_uri_t uriDriveGet   = {"/api/drive",  HTTP_GET,  driveApiHandler, NULL};
    httpd_uri_t uriDrivePost  = {"/api/drive",  HTTP_POST, driveApiHandler, NULL};
    httpd_uri_t uriDriveOpts  = {"/api/drive",  HTTP_OPTIONS, driveApiHandler, NULL};
    
    // API — /api/control (живое управление: джойстик, С таймаутом watchdog)
    httpd_uri_t uriCtrlGet    = {"/api/control", HTTP_GET,  controlApiHandler, NULL};
    httpd_uri_t uriCtrlPost   = {"/api/control", HTTP_POST, controlApiHandler, NULL};
    httpd_uri_t uriCtrlOpts   = {"/api/control", HTTP_OPTIONS, controlApiHandler, NULL};
    
    httpd_register_uri_handler(mainHttpd, &uriPhoto);
    httpd_register_uri_handler(mainHttpd, &uriLedGet);
    httpd_register_uri_handler(mainHttpd, &uriLedToggle);
    httpd_register_uri_handler(mainHttpd, &uriDriveGet);
    httpd_register_uri_handler(mainHttpd, &uriDrivePost);
    httpd_register_uri_handler(mainHttpd, &uriDriveOpts);
    httpd_register_uri_handler(mainHttpd, &uriCtrlGet);
    httpd_register_uri_handler(mainHttpd, &uriCtrlPost);
    httpd_register_uri_handler(mainHttpd, &uriCtrlOpts);

    Serial.printf("🌐 Основной сервер на порту %d, Core %d\n", HTTP_PORT_MAIN, xPortGetCoreID());
    Serial.println("   📡 /api/drive   — отладка (без таймаута)");
    Serial.println("   🎮 /api/control — управление (с watchdog)");
}

void webserverStartStream() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = HTTP_PORT_STREAM;
    config.ctrl_port = 32769;
    config.max_open_sockets = 4;
    config.lru_purge_enable = true;
    config.stack_size = 8192;

    if (httpd_start(&streamHttpd, &config) != ESP_OK) {
        Serial.println("❌ Ошибка запуска стрим-сервера");
        return;
    }

    httpd_uri_t uriStream = {"/stream", HTTP_GET, streamHandler, NULL};
    httpd_register_uri_handler(streamHttpd, &uriStream);

    Serial.printf("📹 Стрим-сервер на порту %d, Core %d\n", HTTP_PORT_STREAM, xPortGetCoreID());
}

void streamServerTask(void* pvParameters) {
    webserverStartStream();
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

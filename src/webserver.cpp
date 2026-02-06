#include "webserver.h"
#include "config.h"
#include "camera.h"
#include "drive.h"
#include "control.h"  // Модуль управления с watchdog
#include <esp_http_server.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>

#include <lwip/sockets.h>
#include <lwip/netdb.h>

// ============================================================
// 🌐 HTTP серверы — реализация
// ============================================================

static httpd_handle_t mainHttpd = NULL;

// IR LED состояние
static bool irLedOn = false;

// ============================================================
// 📹 MJPEG Стрим — Raw TCP, Round-Robin
// ============================================================

#define STREAM_MAX_CLIENTS 4
#define STREAM_BOUNDARY    "----ESP32CAM"
#define STREAM_FRAME_DELAY 50  // ~20 FPS базовая задержка

static int  streamClients[STREAM_MAX_CLIENTS];
static int  streamClientCount = 0;
static int  streamRRIndex     = 0;

// HTTP-ответ для нового MJPEG-клиента
static const char STREAM_HTTP_RESPONSE[] =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: multipart/x-mixed-replace;boundary=" STREAM_BOUNDARY "\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Cache-Control: no-cache, no-store, must-revalidate\r\n"
    "Connection: keep-alive\r\n"
    "\r\n";

// Удалить клиента из массива по индексу
static void streamRemoveClient(int idx) {
    if (idx < 0 || idx >= streamClientCount) return;
    
    close(streamClients[idx]);
    Serial.printf("🎥 Клиент #%d отключён (fd=%d)\n", idx, streamClients[idx]);
    
    // Сдвигаем массив
    for (int i = idx; i < streamClientCount - 1; i++) {
        streamClients[i] = streamClients[i + 1];
    }
    streamClientCount--;
    
    // Корректируем round-robin индекс
    if (streamClientCount == 0) {
        streamRRIndex = 0;
    } else {
        streamRRIndex = streamRRIndex % streamClientCount;
    }
    
    Serial.printf("📊 Стрим-клиентов: %d\n", streamClientCount);
}

// Полная отправка буфера (обработка partial send)
static bool streamSendAll(int fd, const char* buf, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        int n = send(fd, buf + sent, len - sent, MSG_NOSIGNAL);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

// Принять новых клиентов (non-blocking)
static void streamAcceptClients(int serverFd) {
    struct sockaddr_in clientAddr;
    socklen_t addrLen = sizeof(clientAddr);
    
    while (true) {
        int clientFd = accept(serverFd, (struct sockaddr*)&clientAddr, &addrLen);
        if (clientFd < 0) break;  // EAGAIN — нет новых подключений
        
        if (streamClientCount >= STREAM_MAX_CLIENTS) {
            // Отправляем 503 и закрываем
            const char* busy = "HTTP/1.1 503 Service Unavailable\r\n\r\nMax stream clients reached\n";
            send(clientFd, busy, strlen(busy), 0);
            close(clientFd);
            Serial.println("⚠️ Стрим: макс. клиентов, отклонён");
            continue;
        }
        
        // Отправляем HTTP-заголовки MJPEG
        if (!streamSendAll(clientFd, STREAM_HTTP_RESPONSE, strlen(STREAM_HTTP_RESPONSE))) {
            close(clientFd);
            continue;
        }
        
        // Настраиваем сокет: таймаут на send
        struct timeval tv;
        tv.tv_sec = 2;
        tv.tv_usec = 0;
        setsockopt(clientFd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
        
        // Добавляем в массив
        streamClients[streamClientCount] = clientFd;
        streamClientCount++;
        
        Serial.printf("🎥 Новый стрим-клиент (fd=%d), всего: %d\n", clientFd, streamClientCount);
    }
}

// Отправить кадр следующему клиенту (round-robin)
static void streamSendFrame(camera_fb_t* fb) {
    if (streamClientCount == 0) return;
    
    // Round-robin: берём текущего клиента
    int idx = streamRRIndex;
    int fd  = streamClients[idx];
    
    // Формируем MJPEG part
    char partHeader[128];
    int headerLen = snprintf(partHeader, sizeof(partHeader),
        "\r\n--" STREAM_BOUNDARY "\r\n"
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %u\r\n\r\n",
        (unsigned)fb->len);
    
    // Отправляем заголовок + данные
    bool ok = streamSendAll(fd, partHeader, headerLen) &&
              streamSendAll(fd, (const char*)fb->buf, fb->len);
    
    if (!ok) {
        // Клиент отвалился — удаляем
        streamRemoveClient(idx);
        // Не сдвигаем RR — следующий клиент уже на этом idx
    } else {
        // Сдвигаем round-robin
        streamRRIndex = (streamRRIndex + 1) % streamClientCount;
    }
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
    httpd_uri_t uriCtrlJs  = {"/control.js",      HTTP_GET, staticHandler, NULL};  // ControlService
    httpd_uri_t uriCvJs   = {"/cv-processor.js", HTTP_GET, staticHandler, NULL};  // CV Processor
    httpd_uri_t uriJs     = {"/script.js",       HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriCss     = {"/style.css",   HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriLogo    = {"/logo.svg",    HTTP_GET, staticHandler, NULL};
    httpd_uri_t uriFavicon = {"/favicon.ico", HTTP_GET, staticHandler, NULL};
    httpd_register_uri_handler(mainHttpd, &uriIndex);
    httpd_register_uri_handler(mainHttpd, &uriConfigJs);
    httpd_register_uri_handler(mainHttpd, &uriCtrlJs);
    httpd_register_uri_handler(mainHttpd, &uriCvJs);
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

void streamServerTask(void* pvParameters) {
    Serial.printf("📹 Стрим-сервер запускается на Core %d...\n", xPortGetCoreID());

    // Создаём TCP-сервер
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) {
        Serial.println("❌ Стрим: ошибка создания сокета");
        vTaskDelete(NULL);
        return;
    }

    // Разрешаем повторное использование адреса
    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    // Привязка к порту
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons(HTTP_PORT_STREAM);

    if (bind(serverFd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        Serial.println("❌ Стрим: ошибка bind");
        close(serverFd);
        vTaskDelete(NULL);
        return;
    }

    if (listen(serverFd, STREAM_MAX_CLIENTS) < 0) {
        Serial.println("❌ Стрим: ошибка listen");
        close(serverFd);
        vTaskDelete(NULL);
        return;
    }

    // Non-blocking accept
    int flags = fcntl(serverFd, F_GETFL, 0);
    fcntl(serverFd, F_SETFL, flags | O_NONBLOCK);

    Serial.printf("📹 Стрим-сервер слушает порт %d (макс. %d клиентов, round-robin)\n",
                  HTTP_PORT_STREAM, STREAM_MAX_CLIENTS);

    // === Основной цикл: accept + capture + round-robin send ===
    while (true) {
        // 1. Принимаем новых клиентов (non-blocking)
        streamAcceptClients(serverFd);

        // 2. Если нет клиентов — просто ждём
        if (streamClientCount == 0) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        // 3. Захват кадра
        camera_fb_t* fb = cameraCapture(200);
        if (!fb) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        // 4. Отправка по round-robin
        streamSendFrame(fb);

        // 5. Возврат буфера камеры
        esp_camera_fb_return(fb);

        // 6. Задержка (~20 FPS базовая)
        vTaskDelay(pdMS_TO_TICKS(STREAM_FRAME_DELAY));
    }
}

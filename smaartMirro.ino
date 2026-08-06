#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Fonts/Picopixel.h>

// --- Matrix Configuration ---
#define PANEL_RES_X 64
#define PANEL_RES_Y 64
#define PANEL_CHAIN 1

MatrixPanel_I2S_DMA *dma_display = nullptr;

// --- Preferences for Saving Config ---
Preferences preferences;
char smaart_ip[40] = "192.168.31.57";
char smaart_port[6] = "26000";
char smaart_metric[20] = "SPL Fast";
int color_mode = 1; // 1 = Custom
char custom_color_hex[8] = "#FFFFFF";
char label_color_hex[8] = "#00FFCC";
int offset_x = 6;
int offset_y = -5;
int label_x = 3;
int label_y = 62;
int matrix_brightness = 128; 

// --- HTTP Web Server (Always active after WiFi connects) ---
WebServer server(80);

// --- WebSocket ---
WebSocketsClient webSocket;
bool is_connected = false;
String stream_endpoint = "";
float current_spl = 0.0;
bool needs_reconnect = false;

const char* ALL_METRICS[] = {
  "FS Peak", "Peak C", "SPL Fast", "SPL A Fast", "SPL C Fast", 
  "SPL Slow", "SPL A Slow", "SPL C Slow", "Leq 1", "LAeq 1", 
  "LCeq 1", "Leq 10", "LAeq 10", "LCeq 10"
};
const int NUM_METRICS = 14;

// --- Helper: Calculate Dimmed Color via Software ---
// Since hardware brightness might not work on all panels, we scale RGB values directly.
uint16_t getDimmedColor(uint8_t r, uint8_t g, uint8_t b) {
  r = (r * matrix_brightness) / 255;
  g = (g * matrix_brightness) / 255;
  b = (b * matrix_brightness) / 255;
  return dma_display->color565(r, g, b);
}

// --- Helper: Draw Text on Screen using Picopixel ---
void drawTextCenter(String text, int y, uint16_t color, bool clear = true) {
  if (clear) dma_display->clearScreen();
  dma_display->setFont(&Picopixel);
  dma_display->setTextSize(1);
  dma_display->setTextColor(color);
  
  int x = (PANEL_RES_X - (text.length() * 4)) / 2;
  if (x < 0) x = 0;
  
  dma_display->setCursor(x, y);
  dma_display->print(text);
  dma_display->setFont(); // Reset to default
  
  if (clear) dma_display->flipDMABuffer(); // Swap buffers to prevent flicker
}

// --- WiFiManager Callbacks ---
void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("Entered config mode");
  
  dma_display->clearScreen();
  dma_display->setFont(&Picopixel);
  dma_display->setTextSize(1);
  
  dma_display->setTextColor(getDimmedColor(255, 255, 0)); 
  dma_display->setCursor(0, 10);
  dma_display->print("WiFi Setup");
  
  dma_display->setTextColor(getDimmedColor(0, 255, 255)); 
  dma_display->setCursor(0, 25);
  dma_display->print("SSID:");
  dma_display->setCursor(0, 35);
  dma_display->print(myWiFiManager->getConfigPortalSSID());
  
  dma_display->setTextColor(getDimmedColor(0, 255, 0)); 
  dma_display->setCursor(0, 50);
  dma_display->print("IP:");
  dma_display->setCursor(0, 60);
  dma_display->print(WiFi.softAPIP().toString());
  
  dma_display->setFont();
  dma_display->flipDMABuffer(); // Present to screen without flicker
}

// --- Web Server Endpoints ---
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<meta charset='utf-8'>
<title>Smaart Matrix Config</title>
<style>
  body { background-color: #1a1a1a; color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; margin: 0; padding: 20px; }
  .container { max-width: 500px; margin: 0 auto; background: #242424; padding: 25px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
  h2 { text-align: center; margin-top: 0; padding-bottom: 20px; border-bottom: 1px solid #3a3a3a; color: #ffffff; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; line-height: 1.4; }
  .section { margin-bottom: 20px; padding: 18px; background: #2d2d2d; border-radius: 8px; border: 1px solid #3d3d3d; }
  h3 { margin-top: 0; margin-bottom: 15px; font-size: 14px; color: #4da6ff; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; }
  label { display: block; margin-bottom: 8px; font-size: 13px; color: #aaaaaa; }
  input, select { width: 100%; padding: 12px; margin-bottom: 15px; background: #1e1e1e; border: 1px solid #444; color: #ffffff; border-radius: 6px; box-sizing: border-box; font-size: 14px; transition: border-color 0.2s; }
  input:focus, select:focus { outline: none; border-color: #4da6ff; }
  input[type="color"] { height: 46px; padding: 2px; cursor: pointer; }
  input[type="submit"] { background: #4da6ff; color: #000; border: none; padding: 16px; border-radius: 6px; font-size: 16px; font-weight: bold; letter-spacing: 1px; cursor: pointer; transition: background 0.2s, transform 0.1s; margin-bottom: 0; margin-top: 5px; }
  input[type="submit"]:hover { background: #3b88d8; }
  input[type="submit"]:active { transform: scale(0.98); }
  .subtitle { font-size: 12px; color: #888; letter-spacing: normal; text-transform: none; display: block; margin-top: 5px; }
</style>
</head>
<body>
<div class='container'>
  <h2>SMAART MATRIX<span class='subtitle'>Config Panel / 配置后台</span></h2>
  <form action='/save' method='POST'>
)rawliteral";

  html += "<div class='section'><h3>Server Connection / 服务器连接</h3>";
  html += "<label>Server IP / 服务器 IP</label><input type='text' name='ip' value='" + String(smaart_ip) + "'>";
  html += "<label>Port / 端口</label><input type='number' name='port' value='" + String(smaart_port) + "'>";
  html += "</div>";

  html += "<div class='section'><h3>Display Settings / 显示设置</h3>";
  html += "<label>Measurement Parameter / 测量参数 (数据源)</label><select name='metric'>";
  for (int i=0; i<NUM_METRICS; i++) {
    String sel = (String(smaart_metric) == String(ALL_METRICS[i])) ? "selected" : "";
    html += "<option value='" + String(ALL_METRICS[i]) + "' " + sel + ">" + String(ALL_METRICS[i]) + "</option>";
  }
  html += "</select>";
  html += "<label>Screen Brightness / 屏幕亮度 (0-255)</label><input type='number' name='brightness' min='0' max='255' value='" + String(matrix_brightness) + "'>";
  html += "</div>";

  html += "<div class='section'><h3>SPL (Center Big Text) / SPL (居中大字)</h3>";
  html += "<label>Color Mode / 颜色模式</label><select name='colormode'>";
  html += "<option value='0' " + String(color_mode == 0 ? "selected" : "") + ">Auto (By SPL Level) / 自动 (根据声压级变色)</option>";
  html += "<option value='1' " + String(color_mode == 1 ? "selected" : "") + ">Custom Color / 自定义颜色</option>";
  html += "</select>";
  html += "<label>Custom Color / 自定义颜色</label><input type='color' name='customcolor' value='" + String(custom_color_hex) + "'>";
  html += "<label>X Offset / X 轴偏移 (Pixels)</label><input type='number' name='offsetx' value='" + String(offset_x) + "'>";
  html += "<label>Y Offset / Y 轴偏移 (Pixels)</label><input type='number' name='offsety' value='" + String(offset_y) + "'>";
  html += "</div>";

  html += "<div class='section'><h3>Measurement Parameter (Small Text) / 测量参数 (左下小字)</h3>";
  html += "<label>Color / 颜色</label><input type='color' name='labelcolor' value='" + String(label_color_hex) + "'>";
  html += "<label>X Position / X 轴坐标</label><input type='number' name='labelx' value='" + String(label_x) + "'>";
  html += "<label>Y Position / Y 轴坐标</label><input type='number' name='labely' value='" + String(label_y) + "'>";
  html += "</div>";

  html += "<input type='submit' value='SAVE & REBOOT / 保存并重启'>";
  html += "</form></div></body></html>";
  
  server.send(200, "text/html", html);
}

void handleSave() {
  if (server.hasArg("ip")) {
    preferences.putString("ip", server.arg("ip"));
    preferences.putString("port", server.arg("port"));
    preferences.putString("metric", server.arg("metric"));
    preferences.putString("lcolorhex", server.arg("labelcolor"));
    preferences.putInt("colormode", server.arg("colormode").toInt());
    preferences.putString("colorhex", server.arg("customcolor"));
    preferences.putInt("offsetx", server.arg("offsetx").toInt());
    preferences.putInt("offsety", server.arg("offsety").toInt());
    preferences.putInt("labelx", server.arg("labelx").toInt());
    preferences.putInt("labely", server.arg("labely").toInt());
    preferences.putInt("brightness", server.arg("brightness").toInt());
    
    String html = "<html><head><meta charset='utf-8'></head><body style='background:#1a1a1a; color:#fff; text-align:center; font-family:sans-serif; padding-top:50px;'><h2>Saved Successfully! / 保存成功！</h2><p>Rebooting Matrix... / 屏幕即将重启...</p></body></html>";
    server.send(200, "text/html", html);
    
    delay(1000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Bad Request");
  }
}

// --- WebSocket Event Handler ---
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WSc] Disconnected!");
      is_connected = false;
      break;
    case WStype_CONNECTED:
      Serial.printf("[WSc] Connected to url: %s\n", payload);
      is_connected = true;
      if (stream_endpoint == "") {
        webSocket.sendTXT("{\"action\":\"get\",\"target\":\"activeCalibratedInputs\"}");
      } else {
        webSocket.sendTXT("{\"action\":\"set\",\"properties\":[{\"targetFPS\":2}]}");
      }
      break;
    case WStype_TEXT:
      {
        String msg = (char*)payload;
        DynamicJsonDocument doc(4096);
        DeserializationError error = deserializeJson(doc, msg);
        if (error) return;

        if (stream_endpoint == "" && doc.containsKey("response") && doc["response"].containsKey("devices")) {
          JsonArray devices = doc["response"]["devices"];
          if (devices.size() > 0 && devices[0]["activeCalibratedChannels"].size() > 0) {
            stream_endpoint = devices[0]["activeCalibratedChannels"][0]["streamEndpoint"].as<String>();
            Serial.println("Found Stream Endpoint: " + stream_endpoint);
            needs_reconnect = true; 
          }
        }
        
        if (doc.containsKey("metrics")) {
          JsonArray metrics = doc["metrics"];
          for (JsonObject metricObj : metrics) {
            if (metricObj.containsKey(smaart_metric)) {
              current_spl = metricObj[smaart_metric];
              
              // Draw entirely to back buffer first
              dma_display->clearScreen();
              
              // 1. Label text (Bottom left)
              long l_number = (long) strtol(&label_color_hex[1], NULL, 16);
              uint16_t l_Color = getDimmedColor(l_number >> 16, l_number >> 8 & 0xFF, l_number & 0xFF);
              
              dma_display->setFont(&Picopixel);
              dma_display->setTextSize(1);
              dma_display->setTextColor(l_Color);
              dma_display->setCursor(label_x, label_y); 
              dma_display->print(smaart_metric);
              
              // 2. Determine color for the big number
              uint16_t valColor;
              if (color_mode == 0) {
                if (current_spl < 40.0) valColor = getDimmedColor(0, 255, 255); 
                else if (current_spl < 70.0) valColor = getDimmedColor(0, 255, 0); 
                else if (current_spl < 90.0) valColor = getDimmedColor(255, 255, 0); 
                else if (current_spl < 110.0) valColor = getDimmedColor(255, 128, 0); 
                else valColor = getDimmedColor(255, 0, 0); 
              } else {
                long number = (long) strtol(&custom_color_hex[1], NULL, 16);
                valColor = getDimmedColor(number >> 16, number >> 8 & 0xFF, number & 0xFF);
              }
              
              // 3. Draw big centered SPL Value
              dma_display->setFont(&Picopixel);
              dma_display->setTextSize(4);
              dma_display->setTextColor(valColor);
              
              String spl_str = String(current_spl, 1);
              int text_width = spl_str.length() * (4 * 4);
              
              int base_x = (PANEL_RES_X - text_width) / 2; 
              int final_x = base_x + offset_x;
              
              int base_y = 42; 
              int final_y = base_y + offset_y;
              
              dma_display->setCursor(final_x, final_y);
              dma_display->print(spl_str);
              dma_display->setFont();
              
              // Push back buffer to screen (ELIMINATES FLICKER)
              dma_display->flipDMABuffer();
              break; 
            }
          }
        }
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);

  // --- Load Config BEFORE matrix init so we have brightness ---
  preferences.begin("smaart", false);
  String saved_ip = preferences.getString("ip", "192.168.31.57");
  String saved_port = preferences.getString("port", "26000");
  String saved_metric = preferences.getString("metric", "SPL Fast");
  String saved_lcolorhex = preferences.getString("lcolorhex", "#00FFCC");
  color_mode = preferences.getInt("colormode", 1);
  String saved_colorhex = preferences.getString("colorhex", "#FFFFFF");
  offset_x = preferences.getInt("offsetx", 6);
  offset_y = preferences.getInt("offsety", -5);
  label_x = preferences.getInt("labelx", 3);
  label_y = preferences.getInt("labely", 62);
  matrix_brightness = preferences.getInt("brightness", 128);
  
  saved_ip.toCharArray(smaart_ip, 40);
  saved_port.toCharArray(smaart_port, 6);
  saved_metric.toCharArray(smaart_metric, 20);
  saved_lcolorhex.toCharArray(label_color_hex, 8);
  saved_colorhex.toCharArray(custom_color_hex, 8);

  // --- Initialize Matrix with Double Buffering ---
  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  mxconfig.gpio.e = 18;
  mxconfig.double_buff = true; // MUST BE TRUE to eliminate flicker
  
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  
  // Set hardware brightness to max, we handle dimming in software for reliability
  dma_display->setBrightness8(255); 
  
  dma_display->clearScreen();
  drawTextCenter("Booting...", 32, getDimmedColor(255, 255, 255));

  // --- WiFiManager Setup ---
  WiFiManager wm;
  wm.setAPCallback(configModeCallback);
  
  if (!wm.autoConnect("HUB75-Smaart-AP")) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.restart();
  }

  // --- Post-Connection Setup ---
  String myIP = WiFi.localIP().toString();
  Serial.println("IP: " + myIP);

  dma_display->clearScreen();
  dma_display->setFont(&Picopixel);
  dma_display->setTextSize(1);
  dma_display->setTextColor(getDimmedColor(0, 255, 0));
  dma_display->setCursor(0, 20);
  dma_display->print("Connected!");
  dma_display->setTextColor(getDimmedColor(255, 255, 255));
  dma_display->setCursor(0, 40);
  dma_display->print(myIP);
  dma_display->setFont();
  dma_display->flipDMABuffer();
  delay(2000);

  // --- Setup Ongoing Web Server ---
  server.on("/", HTTP_GET, handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.begin();
  Serial.println("HTTP server started");

  // --- WebSocket Setup ---
  dma_display->clearScreen();
  drawTextCenter("Connecting", 25, getDimmedColor(255, 255, 0), false);
  drawTextCenter("to Smaart...", 40, getDimmedColor(255, 255, 0), false);
  
  webSocket.begin(smaart_ip, atoi(smaart_port), "/api/v3/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  if (needs_reconnect) {
    needs_reconnect = false;
    webSocket.disconnect();
    delay(200);
    webSocket.begin(smaart_ip, atoi(smaart_port), stream_endpoint.c_str());
  }

  webSocket.loop();
  server.handleClient();
}

/*
  ESP8266 NodeMCU Captive Portal Firmware
  Project: ESP8266 Wi-Fi Portal — Consent-Based Remote Camera & Microphone Monitoring System
  
  Configuration:
  - SSID: Mini_Portal
  - Local IP: 192.168.4.1
  - DNS Server: Port 53 (redirects all requests to 192.168.4.1)
  - HTTP Server: Port 80 (handles captive portal detection and portal page)
  - Target URL: https://esp8266-permission-portal.vercel.app/
*/

#include <ESP8266WiFi.h>
#include <DNSServer.h>
#include <ESP8266WebServer.h>

// Wi-Fi Access Point Configuration
const char* AP_SSID = "Mini_Portal";
const char* AP_PASSWORD = ""; // Open network

const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);
IPAddress netMsk(255, 255, 255, 0);

DNSServer dnsServer;
ESP8266WebServer server(80);

// Captive Portal HTML Page stored in flash memory (PROGMEM)
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mini_Portal &bull; Device Permission Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b0f19;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .card {
      background-color: #151c2c;
      border: 1px solid #232f47;
      border-radius: 16px;
      padding: 28px 24px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    h1 {
      font-size: 22px;
      margin-bottom: 8px;
      color: #fff;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 18px;
    }
    .notice {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fcd34d;
      padding: 12px;
      border-radius: 10px;
      font-size: 13px;
      text-align: left;
      margin-bottom: 22px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background-color: #2563eb;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border-radius: 10px;
      transition: background-color 0.2s;
    }
    .btn:hover {
      background-color: #1d4ed8;
    }
    .footer {
      margin-top: 18px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Wi-Fi: Mini_Portal</div>
    <h1>Device Permission Portal</h1>
    <p>
      You are connected to the local <strong>Mini_Portal</strong> wireless hotspot.
    </p>

    <div class="notice">
      <strong>Important Internet Notice:</strong><br>
      This ESP8266 local hotspot does not provide direct internet transit. Real-time WebRTC audio and video streaming requires an internet connection (via mobile data or standard Wi-Fi) to reach the secure hosted portal.
    </div>

    <a href="https://esp8266-permission-portal.vercel.app/" class="btn" target="_blank" rel="noopener">
      Open Hosted Permission Portal &rarr;
    </a>

    <div class="footer">
      ESP8266 NodeMCU &bull; IP: 192.168.4.1
    </div>
  </div>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "-1");
  server.send(200, "text/html", PORTAL_HTML);
}

// Redirects common OS captive portal probes to the portal
void handleCaptivePortal() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP8266] Initializing Mini_Portal Captive Portal...");

  // Configure SoftAP
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apIP, netMsk);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  Serial.print("[ESP8266] SoftAP SSID: ");
  Serial.println(AP_SSID);
  Serial.print("[ESP8266] IP Address: ");
  Serial.println(WiFi.softAPIP());

  // Start DNS server redirecting all domain requests to ESP8266 IP
  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", apIP);
  Serial.println("[ESP8266] Captive DNS Server started on port 53");

  // Handle Web Requests
  server.on("/", HTTP_GET, handleRoot);

  // Common OS Captive Portal Check Endpoints
  server.on("/generate_204", HTTP_GET, handleRoot);         // Android / Chrome
  server.on("/gen_204", HTTP_GET, handleRoot);              // Android
  server.on("/hotspot-detect.html", HTTP_GET, handleRoot);  // iOS / macOS
  server.on("/ncsi.txt", HTTP_GET, handleRoot);             // Windows
  server.on("/connecttest.txt", HTTP_GET, handleRoot);      // Windows

  server.onNotFound(handleCaptivePortal);

  server.begin();
  Serial.println("[ESP8266] HTTP Web Server started on port 80");
  Serial.println("[ESP8266] Setup complete. Ready for visitor connections.");
}

void loop() {
  // Process incoming DNS requests
  dnsServer.processNextRequest();

  // Process incoming HTTP requests
  server.handleClient();
}

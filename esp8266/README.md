# ESP8266 Captive Portal Firmware

This directory contains the complete, production-ready Arduino firmware for the ESP8266 NodeMCU.

## Overview

- **SSID:** `Mini_Portal`
- **Authentication:** Open (no password required)
- **Local IP:** `192.168.4.1`
- **Subnet:** `255.255.255.0`
- **DNS Server:** Port 53 (redirects all requests `*` to `192.168.4.1`)
- **HTTP Server:** Port 80 (serves the captive portal landing page)
- **Hosted Portal Target:** `https://esp8266-permission-portal.vercel.app/`

## How Captive Portal Detection Works

When mobile devices (Android, iOS, iPadOS) and laptops connect to `Mini_Portal`, the OS attempts to probe known URLs (e.g., `/generate_204`, `/hotspot-detect.html`, `/ncsi.txt`).

1. The ESP8266's `DNSServer` resolves all DNS lookups to `192.168.4.1`.
2. The `ESP8266WebServer` intercepts these probes and serves the portal page directly.
3. The user sees a system dialog or popup displaying the landing page.
4. The page clearly explains that the local hotspot directs them to the hosted Vercel portal and that remote WebRTC transmission requires an internet connection.

## Flashing Instructions (Arduino IDE)

1. **Install Arduino IDE** (2.x recommended).
2. Go to **File -> Preferences -> Additional Boards Manager URLs** and add:
   ```text
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Go to **Tools -> Board -> Boards Manager**, search for `esp8266`, and install the package.
4. Select your board under **Tools -> Board -> ESP8266 Boards**:
   - For NodeMCU: Select **NodeMCU 1.0 (ESP-12E Module)**
   - For D1 Mini: Select **LOLIN(WEMOS) D1 R2 & mini**
   - For generic modules: Select **Generic ESP8266 Module**
5. Configure board settings:
   - **Upload Speed:** 115200 (or 921600 for faster flashing)
   - **CPU Frequency:** 80 MHz or 160 MHz
   - **Flash Size:** 4MB (FS:2MB OTA:~1019KB)
6. Connect the ESP8266 via USB cable and select the correct COM port under **Tools -> Port**.
7. Open `esp8266_captive_portal.ino` and click **Upload**.

## Flashing with PlatformIO

If using PlatformIO (VS Code), create a `platformio.ini` file:

```ini
[env:nodemcuv2]
platform = espressif8266
board = nodemcuv2
framework = arduino
monitor_speed = 115200
```
Then run:
```bash
pio run --target upload
```

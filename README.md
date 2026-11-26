# ESP8266 Wi-Fi Portal — Consent-Based Remote Camera & Microphone Monitoring System

A secure, full-stack, consent-based remote device monitoring system with an administrator console, WebRTC real-time media streaming, Firebase signaling, and an ESP8266 captive portal integration.

- **Repository:** [https://github.com/Shashikant-akkihuggi/esp8266-permission-portal](https://github.com/Shashikant-akkihuggi/esp8266-permission-portal)
- **Live Hosted Application:** [https://esp8266-permission-portal.vercel.app/](https://esp8266-permission-portal.vercel.app/)

---

## 1. Architectural Overview & Workflow

```
+------------------------+      Captive DNS Redirection       +-------------------------------+
| ESP8266 NodeMCU        | ---------------------------------> | Connected Visitor Device      |
| SSID: Mini_Portal      |   Guides visitor to hosted portal   | (Smartphone / Laptop)         |
| Local IP: 192.168.4.1  |                                    +---------------+---------------+
+------------------------+                                                    |
                                                                              | 1. Opens Hosted Portal
                                                                              | 2. Grants Camera/Mic
                                                                              | 3. Explicit Consent Confirmed
                                                                              v
+-------------------------------+      Signaling Metadata     +-------------------------------+
| Firebase Realtime Database /  | <=========================> | Vercel Serverless Backend     |
| Signaling Engine              |   (SDP Offers, Answers,     | - /api/auth/*                 |
| (NO media streams stored)     |    ICE Candidates, Status)  | - /api/sessions/*             |
+---------------+---------------+                             | - /api/admin/*                |
                ^                                             +---------------+---------------+
                | Signaling Exchange                                          |
                v                                                             v
+-------------------------------+      Encrypted P2P Media    +-------------------------------+
| Visitor WebRTC Media Stream   | ==========================> | Authenticated Admin Console   |
| (Local preview + Status dot)  |   (Direct audio/video over  | (Live Video, Audio Controls,  |
+-------------------------------+    DTLS-SRTP WebRTC stream) |  Session Table, Disconnect)   |
                                                              +-------------------------------+
```

---

## 2. Core Security & Privacy Principles

This system is engineered with strict application security and user privacy guardrails:

- **Strict Consent Barrier:** Camera and microphone streams are **never** activated in the background or requested without contextual explanation.
- **Separate Explicit Opt-In:** Browser device permission alone is not treated as consent for remote transmission. The visitor must explicitly confirm an opt-in checkbox before any stream is shared with the administrator.
- **Zero Media Recording or Upload:** No video or audio is ever recorded, stored on disk, or uploaded to any server or cloud database. Media flows directly peer-to-peer between the visitor and the administrator over encrypted WebRTC (DTLS-SRTP).
- **Persistent Live Transparency:** While streaming, a prominent pulsing indicator is displayed on the visitor screen. The visitor is explicitly alerted the moment an administrator connects.
- **Instant Revocation:** A high-visibility "Stop Sharing Immediately" button terminates all hardware tracks (`MediaStreamTrack.stop()`), closes the WebRTC peer connection, and wipes signaling data immediately.
- **Robust Authentication & Protection:**
  - Password verification uses `bcrypt` with salt rounds.
  - Sessions are protected via cryptographic `HMAC-SHA256` signatures stored in `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
  - Brute-force protection: IP-based login rate limiting (max 5 failed attempts within 15 minutes, with lockout).
  - Generic authentication errors prevent username enumeration.
  - No public registration endpoint exists.

---

## 3. Technology Stack

- **Frontend:** Responsive HTML5, CSS3 (Modern dark-themed CSS variables), Vanilla JavaScript (ES Modules).
- **Backend:** Node.js Serverless Functions deployed on Vercel (`/api/*`).
- **Real-Time Media:** WebRTC (`RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate`, `MediaStream`).
- **Signaling:** Firebase Realtime Database (with automatic fallback to serverless signaling endpoints).
- **Microcontroller:** ESP8266 NodeMCU (SoftAP `Mini_Portal`, `DNSServer` on port 53, `ESP8266WebServer` on port 80).

---

## 4. Directory Structure

```
esp8266-permission-portal/
├── .env.example              # Template for environment variables
├── .gitignore                # Git ignore rules
├── package.json              # Dependencies and project metadata
├── vercel.json               # Vercel configuration & security headers
├── server.js                 # Local development server
├── index.html                # Enhanced mobile-first visitor permission portal
│
├── admin/
│   ├── login.html            # Administrator login page
│   └── dashboard.html        # Comprehensive dark-themed admin monitoring dashboard
│
├── api/                      # Vercel Serverless Functions
│   ├── auth/
│   │   ├── login.js          # POST /api/auth/login (bcrypt verification & cookie issuance)
│   │   ├── logout.js         # POST /api/auth/logout (clears session cookie)
│   │   └── session.js        # GET /api/auth/session (validates session signature)
│   ├── sessions/
│   │   ├── create.js         # POST /api/sessions/create (registers session with server IP)
│   │   ├── heartbeat.js      # POST /api/sessions/heartbeat (syncs consent and active state)
│   │   └── stop.js           # POST /api/sessions/stop (immediately terminates sharing)
│   ├── admin/
│   │   └── sessions/
│   │       ├── index.js      # GET /api/admin/sessions (lists active devices with IP)
│   │       └── [id]/
│   │           ├── index.js      # GET /api/admin/sessions/:id
│   │           ├── connect.js    # POST /api/admin/sessions/:id/connect
│   │           └── disconnect.js # POST /api/admin/sessions/:id/disconnect
│   ├── webrtc/
│   │   └── config.js         # GET /api/webrtc/config (STUN/TURN & Firebase client config)
│   └── signaling/            # WebRTC signaling fallback endpoints
│       ├── offer.js
│       ├── answer.js
│       ├── candidate.js
│       └── poll.js
│
├── lib/                      # Shared Backend Modules
│   ├── auth.js               # bcrypt password verification, HMAC session signing
│   ├── security.js           # Rate limiting, IP extraction, security headers
│   ├── store.js              # Active sessions store and status manager
│   └── firebase.js           # Firebase Realtime Database signaling client
│
├── css/
│   ├── visitor.css           # Visitor UI responsive styles
│   └── admin.css             # Admin console and login dark theme styles
│
├── js/
│   ├── visitor.js            # Visitor device acquisition and streaming logic
│   ├── admin-login.js        # Admin authentication client logic
│   ├── admin-dashboard.js    # Admin dashboard monitoring & WebRTC receiving logic
│   └── webrtc-signaling.js   # Shared WebRTC signaling abstraction
│
├── esp8266/
│   ├── esp8266_captive_portal.ino # Production Arduino sketch for NodeMCU
│   └── README.md                  # Flashing and captive portal configuration guide
│
├── scripts/
│   └── hash-password.js      # Utility CLI to generate bcrypt password hashes
│
└── test/
    └── api.test.js           # Automated end-to-end API test suite (11 test cases)
```

---

## 5. Configuration & Environment Variables

To configure administrator credentials, session secrets, and optional Firebase/TURN settings, add the following environment variables in your Vercel Project Settings (**Settings -> Environment Variables**):

| Variable | Description | Example / Default |
|---|---|---|
| `ADMIN_USERNAME` | Administrator login username | `admin` |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of admin password | *Generate using `node scripts/hash-password.js`* |
| `SESSION_SECRET` | Secret key for signing session cookies (min 32 chars) | `a-cryptographically-random-string-at-least-32-chars` |
| `FIREBASE_DATABASE_URL` | *(Optional)* Firebase Realtime Database URL for signaling | `https://your-app-default-rtdb.firebaseio.com` |
| `FIREBASE_API_KEY` | *(Optional)* Firebase Web API Key | `AIzaSy...` |
| `FIREBASE_PROJECT_ID` | *(Optional)* Firebase Project ID | `your-project-id` |
| `TURN_SERVER_URL` | *(Optional)* TURN server URL for cross-NAT relay | `turn:turn.example.com:3478` |
| `TURN_USERNAME` | *(Optional)* TURN server username | `username` |
| `TURN_PASSWORD` | *(Optional)* TURN server credential | `password` |

### Generating a New Admin Password Hash

Run the included hashing script in your terminal:

```bash
node scripts/hash-password.js "YourChosenSecretPassword"
```

Copy the generated `$2a$10$...` hash into your `ADMIN_PASSWORD_HASH` environment variable.

---

## 6. WebRTC Signaling & NAT Traversal (STUN/TURN)

### Firebase Realtime Database Signaling
The application uses Firebase Realtime Database exclusively for exchanging signaling information:
- SDP Offers & Answers
- ICE Candidates (`RTCIceCandidate`)
- Session connection state changes

If Firebase is not yet configured, the system automatically falls back to the built-in serverless signaling endpoints (`/api/signaling/*`), ensuring the application works reliably out-of-the-box in all environments.

### Firebase Realtime Database Security Rules
In your Firebase Console, apply the following security rules:

```json
{
  "rules": {
    "sessions": {
      "$sessionId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

### STUN and TURN Configuration
- **STUN:** By default, Google's public STUN servers (`stun:stun.l.google.com:19302`) are configured for basic NAT traversal.
- **TURN Server Requirement:** Public STUN servers cannot traverse Symmetric NATs (frequently encountered on 4G/5G mobile cellular networks and strict corporate firewalls). For reliable cross-network connectivity, configure a TURN relay server using `TURN_SERVER_URL`, `TURN_USERNAME`, and `TURN_PASSWORD` (e.g. from Metered.ca, Twilio, Xirsys, or self-hosted Coturn).

---

## 7. ESP8266 Captive Portal Setup

1. Open `esp8266/esp8266_captive_portal.ino` in the Arduino IDE.
2. Select your board (e.g. **NodeMCU 1.0 (ESP-12E Module)**).
3. Connect your ESP8266 via USB and click **Upload**.
4. The ESP8266 broadcasts a Wi-Fi network named **`Mini_Portal`**.
5. When a visitor connects, the captive portal DNS redirects them to `192.168.4.1`, explaining that the ESP8266 hotspot directs them to the hosted HTTPS portal at:
   `https://esp8266-permission-portal.vercel.app/`

---

## 8. Automated Testing

An automated test suite verifies all authentication flows, rate limiting, session creation, consent verification, and WebRTC configurations:

```bash
npm test
```

Expected output:
```
--- Starting Automated API & Security Tests ---
✓ Test 1 Passed: Unauthenticated admin session returns 401
✓ Test 2 Passed: Invalid login rejected with generic error
✓ Test 3 Passed: Valid login sets secure HTTP-only cookie
✓ Test 4 Passed: Admin session verification succeeds with signed cookie
✓ Test 5 Passed: Visitor session created with server-extracted IP
✓ Test 6 Passed: Visitor heartbeat updates consent and sharing state
✓ Test 7 Passed: Admin lists active sessions with accurate metadata
✓ Test 8 Passed: Admin connects only when visitor granted explicit consent
✓ Test 9 Passed: WebRTC configuration returns valid ICE servers
✓ Test 10 Passed: Visitor stops sharing and media state is immediately stopped
✓ Test 11 Passed: Admin logout clears session cookie

========================================
ALL 11 AUTOMATED TESTS PASSED SUCCESSFULLY!
========================================
```

---

## 9. Running Locally

To run the full stack locally:

```bash
# Install dependencies
npm install

# Start local development server
npm start
```

Visit:
- **Visitor Portal:** `http://localhost:3000/`
- **Admin Login:** `http://localhost:3000/admin/login.html` (Default: `admin` / `admin123`)
- **Admin Dashboard:** `http://localhost:3000/admin/dashboard.html`

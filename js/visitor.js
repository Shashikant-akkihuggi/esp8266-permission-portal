import { SignalingClient } from './webrtc-signaling.js';

// DOM Elements
const previewVideo = document.getElementById('preview');
const previewWrapper = document.getElementById('previewWrapper');
const streamIndicator = document.getElementById('streamIndicator');
const streamIndicatorText = document.getElementById('streamIndicatorText');
const pulseDot = document.getElementById('pulseDot');
const statusBar = document.getElementById('statusBar');

const cameraBtn = document.getElementById('cameraBtn');
const micBtn = document.getElementById('micBtn');
const bothBtn = document.getElementById('bothBtn');
const stopBtn = document.getElementById('stopBtn');
const consentCheckbox = document.getElementById('consentCheckbox');
const sessionIdDisplay = document.getElementById('sessionIdDisplay');
const adminNotice = document.getElementById('adminNotice');

// State
let localStream = null;
let cameraTrack = null;
let micTrack = null;
let sessionId = null;
let deviceId = null;
let signalingClient = null;
let heartbeatTimer = null;
let isSharingLive = false;

/**
 * Initializes Session and Device IDs
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

  if (sessionIdDisplay) {
    sessionIdDisplay.textContent = sessionId;
  }
}

/**
 * Updates status bar UI
 */
function setStatus(message, type = 'info') {
  if (!statusBar) return;
  statusBar.textContent = message;
  statusBar.className = 'status-bar ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
}

/**
 * Updates visible streaming indicator
 */
function updateStreamIndicator(adminConnected = false) {
  if (!localStream || !isSharingLive) {
    streamIndicator.className = 'stream-indicator';
    streamIndicator.style.display = 'none';
    return;
  }

  streamIndicator.style.display = 'flex';
  if (adminConnected) {
    streamIndicator.className = 'stream-indicator active-admin';
    pulseDot.className = 'pulse-dot admin-live';
    streamIndicatorText.textContent = 'ADMINISTRATOR CONNECTED — Live Transmission Active';
  } else {
    streamIndicator.className = 'stream-indicator active';
    pulseDot.className = 'pulse-dot';
    streamIndicatorText.textContent = 'LIVE STREAMING ACTIVE — Awaiting Administrator Connection';
  }
}

/**
 * Handles WebRTC peer connection setup and stream publication
 */
async function setupWebRTC() {
  if (!signalingClient) {
    signalingClient = new SignalingClient({
      sessionId,
      role: 'visitor',
      onConnectionStateChange: (state) => {
        console.log('[Visitor] WebRTC state:', state);
        if (state === 'connected') {
          updateStreamIndicator(true);
          setStatus('Connected to administrator via secure WebRTC.', 'success');
        } else if (state === 'disconnected' || state === 'failed') {
          updateStreamIndicator(false);
          setStatus('Administrator disconnected.', 'info');
        }
      }
    });

    await signalingClient.init();
  }

  signalingClient.createPeerConnection(localStream);

  // Send SDP offer to signaling
  await signalingClient.createAndSendOffer();

  // Listen for signaling responses
  signalingClient.startListening((data) => {
    if (data && typeof data.adminConnected === 'boolean') {
      updateStreamIndicator(data.adminConnected);
      if (adminNotice) {
        adminNotice.textContent = data.adminConnected
          ? 'An administrator is currently viewing/listening live.'
          : 'Waiting for an administrator to view your shared stream.';
        adminNotice.style.display = 'block';
      }
    }
  });
}

/**
 * Sends heartbeat to server
 */
async function sendHeartbeat() {
  try {
    const res = await fetch('/api/sessions/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        sharingCamera: Boolean(cameraTrack && cameraTrack.enabled),
        sharingMic: Boolean(micTrack && micTrack.enabled),
        explicitConsent: Boolean(consentCheckbox.checked && isSharingLive)
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.adminConnected === 'boolean') {
        updateStreamIndicator(data.adminConnected);
      }
    }
  } catch (err) {
    console.warn('[Heartbeat] Sync error:', err);
  }
}

/**
 * Registers session with backend
 */
async function registerSession() {
  try {
    await fetch('/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        deviceId,
        sharingCamera: Boolean(cameraTrack && cameraTrack.enabled),
        sharingMic: Boolean(micTrack && micTrack.enabled),
        explicitConsent: Boolean(consentCheckbox.checked && isSharingLive)
      })
    });
  } catch (err) {
    console.warn('[Session] Register error:', err);
  }
}

/**
 * Requests media permissions and captures user media stream
 */
async function startMediaCapture({ video = false, audio = false }) {
  // Check browser support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Error: Your browser or environment does not support media capture (getUserMedia). Make sure you are using HTTPS.', 'error');
    return;
  }

  // Check consent requirement
  if (!consentCheckbox.checked) {
    setStatus('Please read the privacy policy and check the explicit consent box before sharing.', 'error');
    consentCheckbox.focus();
    return;
  }

  setStatus('Requesting browser permission...', 'info');

  try {
    // Acquire new tracks
    const constraints = {
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Merge tracks into existing or new localStream
    if (!localStream) {
      localStream = new MediaStream();
    }

    if (video) {
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack) {
        if (cameraTrack) {
          localStream.removeTrack(cameraTrack);
          cameraTrack.stop();
        }
        cameraTrack = newVideoTrack;
        localStream.addTrack(cameraTrack);
        previewVideo.srcObject = localStream;
        previewWrapper.classList.add('visible');
      }
    }

    if (audio) {
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (newAudioTrack) {
        if (micTrack) {
          localStream.removeTrack(micTrack);
          micTrack.stop();
        }
        micTrack = newAudioTrack;
        localStream.addTrack(micTrack);
      }
    }

    isSharingLive = true;
    stopBtn.disabled = false;

    // Start WebRTC signaling
    await setupWebRTC();

    // Register & start heartbeat
    await registerSession();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeat, 5000);

    const sharedItems = [];
    if (cameraTrack) sharedItems.push('Camera');
    if (micTrack) sharedItems.push('Microphone');

    updateStreamIndicator(false);
    setStatus(`Sharing ${sharedItems.join(' & ')} live. You can stop anytime.`, 'success');

  } catch (error) {
    console.error('[Media Capture Error]', error);
    let msg = 'Failed to access device.';
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      msg = 'Permission was denied in your browser. Please allow camera/microphone access in your browser settings.';
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      msg = 'Requested camera or microphone hardware was not found on your device.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      msg = 'Device is already in use by another application or tab.';
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg = 'Browsers require a secure context (HTTPS) to access camera and microphone.';
    }
    setStatus(msg, 'error');
  }
}

/**
 * Stops all media sharing immediately
 */
async function stopAllSharing() {
  // 1. Stop all media stream tracks immediately
  if (localStream) {
    localStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (e) {}
    });
    localStream = null;
  }
  cameraTrack = null;
  micTrack = null;

  // 2. Hide and clear preview
  if (previewVideo) {
    previewVideo.srcObject = null;
  }
  if (previewWrapper) {
    previewWrapper.classList.remove('visible');
  }

  // 3. Close WebRTC peer connection
  if (signalingClient) {
    signalingClient.closePeerConnection();
  }

  // 4. Clear heartbeat
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  isSharingLive = false;
  updateStreamIndicator(false);

  if (adminNotice) {
    adminNotice.style.display = 'none';
  }

  // 5. Notify backend server to immediately clean up session
  try {
    await fetch('/api/sessions/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
  } catch (err) {
    console.warn('[Stop] Server notify error:', err);
  }

  stopBtn.disabled = true;
  setStatus('All media streaming stopped and connections closed.', 'info');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  initSession();
  registerSession(); // Register initial idle visitor session

  cameraBtn.addEventListener('click', () => startMediaCapture({ video: true, audio: false }));
  micBtn.addEventListener('click', () => startMediaCapture({ video: false, audio: true }));
  bothBtn.addEventListener('click', () => startMediaCapture({ video: true, audio: true }));
  stopBtn.addEventListener('click', stopAllSharing);

  // Stop when page unloads
  window.addEventListener('beforeunload', () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    navigator.sendBeacon('/api/sessions/stop', JSON.stringify({ sessionId }));
  });
});

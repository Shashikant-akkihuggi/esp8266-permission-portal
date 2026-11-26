import { SignalingClient } from './webrtc-signaling.js';

// DOM References
const adminUserBadge = document.getElementById('adminUserBadge');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');

const metricTotalSessions = document.getElementById('metricTotalSessions');
const metricSharingCamera = document.getElementById('metricSharingCamera');
const metricSharingMic = document.getElementById('metricSharingMic');
const metricActiveWebRTC = document.getElementById('metricActiveWebRTC');

const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const sessionsTableBody = document.getElementById('sessionsTableBody');

const liveStatusBadge = document.getElementById('liveStatusBadge');
const remoteVideo = document.getElementById('remoteVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const muteBtn = document.getElementById('muteBtn');
const muteIcon = document.getElementById('muteIcon');
const volumeSlider = document.getElementById('volumeSlider');
const volumePercent = document.getElementById('volumePercent');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const activeSessionIdText = document.getElementById('activeSessionIdText');
const activeIpText = document.getElementById('activeIpText');
const activeMediaTracksText = document.getElementById('activeMediaTracksText');
const webrtcStateText = document.getElementById('webrtcStateText');
const disconnectStreamBtn = document.getElementById('disconnectStreamBtn');
const toastContainer = document.getElementById('toastContainer');

// State
let allSessions = [];
let activeSessionId = null;
let activeSignalingClient = null;
let pollTimer = null;
let currentUser = null;

/**
 * Toast notifications helper
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Checks authentication on load
 */
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/session');
    if (!res.ok) {
      window.location.replace('/admin/login.html');
      return false;
    }
    const data = await res.json();
    if (!data.authenticated) {
      window.location.replace('/admin/login.html');
      return false;
    }
    currentUser = data.user;
    if (adminUserBadge) {
      adminUserBadge.textContent = `Admin: ${currentUser.username}`;
    }
    return true;
  } catch (err) {
    window.location.replace('/admin/login.html');
    return false;
  }
}

/**
 * Handles admin logout
 */
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/admin/login.html');
  }
}

/**
 * Fetches sessions from server
 */
async function fetchSessions() {
  try {
    const res = await fetch('/api/admin/sessions');
    if (res.status === 401) {
      window.location.replace('/admin/login.html');
      return;
    }
    if (res.ok) {
      const data = await res.json();
      allSessions = data.sessions || [];
      renderDashboard();
    }
  } catch (err) {
    console.warn('[Admin] Error fetching sessions:', err);
  }
}

/**
 * Updates metrics and table
 */
function renderDashboard() {
  // Update metric cards
  metricTotalSessions.textContent = allSessions.length;

  const cameraCount = allSessions.filter(s => s.sharingCamera).length;
  metricSharingCamera.textContent = cameraCount;

  const micCount = allSessions.filter(s => s.sharingMic).length;
  metricSharingMic.textContent = micCount;

  const connectedCount = allSessions.filter(s => s.adminConnected).length;
  metricActiveWebRTC.textContent = connectedCount;

  // Filter sessions
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filterVal = statusFilter.value;

  const filtered = allSessions.filter(session => {
    // Search filter
    const matchesSearch = !searchTerm ||
      session.sessionId.toLowerCase().includes(searchTerm) ||
      session.deviceId.toLowerCase().includes(searchTerm) ||
      (session.ip && session.ip.toLowerCase().includes(searchTerm));

    if (!matchesSearch) return false;

    // Status filter
    if (filterVal === 'camera') return session.sharingCamera;
    if (filterVal === 'mic') return session.sharingMic;
    if (filterVal === 'both') return session.sharingCamera && session.sharingMic;
    if (filterVal === 'not-sharing') return !session.sharingCamera && !session.sharingMic;

    return true;
  });

  renderTable(filtered);
}

/**
 * Formats ISO timestamp
 */
function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoStr;
  }
}

/**
 * Renders table body
 */
function renderTable(sessions) {
  sessionsTableBody.innerHTML = '';

  if (sessions.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="8" style="text-align: center; color: var(--admin-text-dim); padding: 24px;">
        No visitor sessions found matching current filter.
      </td>
    `;
    sessionsTableBody.appendChild(row);
    return;
  }

  sessions.forEach(session => {
    const row = document.createElement('tr');
    const isThisActive = activeSessionId === session.sessionId;

    const cameraBadge = session.sharingCamera
      ? '<span class="badge badge-success">● Sharing</span>'
      : '<span class="badge badge-dim">Not Sharing</span>';

    const micBadge = session.sharingMic
      ? '<span class="badge badge-success">● Sharing</span>'
      : '<span class="badge badge-dim">Not Sharing</span>';

    const connBadge = session.connectionStatus === 'Connected'
      ? '<span class="badge badge-primary">Online</span>'
      : '<span class="badge badge-dim">Disconnected</span>';

    const canView = session.explicitConsent && (session.sharingCamera || session.sharingMic);

    let actionBtn = '';
    if (isThisActive) {
      actionBtn = `
        <button class="btn-admin btn-admin-danger" style="padding: 6px 12px; font-size: 12px;" onclick="window.disconnectActiveStream()">
          Disconnect
        </button>
      `;
    } else if (canView) {
      actionBtn = `
        <button class="btn-admin btn-admin-primary" style="padding: 6px 12px; font-size: 12px;" onclick="window.connectToSession('${session.sessionId}')">
          View Stream
        </button>
      `;
    } else {
      actionBtn = `
        <span style="font-size: 12px; color: var(--admin-text-dim);" title="Visitor has not granted explicit consent or shared media">
          Awaiting Consent
        </span>
      `;
    }

    row.innerHTML = `
      <td>
        <span style="font-family: monospace; font-size: 12px;" title="${session.sessionId}">
          ${session.sessionId.length > 14 ? session.sessionId.substring(0, 14) + '...' : session.sessionId}
        </span>
      </td>
      <td>
        <span style="font-family: monospace; font-size: 12px; color: var(--admin-text-muted);">
          ${session.deviceId.length > 12 ? session.deviceId.substring(0, 12) + '...' : session.deviceId}
        </span>
      </td>
      <td>${session.ip || '—'}</td>
      <td>${formatTime(session.connectionTime)}</td>
      <td>${cameraBadge}</td>
      <td>${micBadge}</td>
      <td>${connBadge}</td>
      <td>${actionBtn}</td>
    `;

    sessionsTableBody.appendChild(row);
  });
}

/**
 * Connects admin to a visitor's shared media stream via WebRTC
 */
async function connectToSession(sessionId) {
  if (activeSessionId) {
    await disconnectActiveStream();
  }

  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  if (!session.explicitConsent || (!session.sharingCamera && !session.sharingMic)) {
    showToast('Cannot connect: visitor has not explicitly consented to share media.', 'error');
    return;
  }

  showToast(`Initiating WebRTC connection to session ${sessionId.substring(0, 8)}...`, 'info');

  activeSessionId = sessionId;
  activeSessionIdText.textContent = sessionId;
  activeIpText.textContent = session.ip || '—';
  activeMediaTracksText.textContent = [
    session.sharingCamera ? 'Camera' : null,
    session.sharingMic ? 'Microphone' : null
  ].filter(Boolean).join(' + ') || 'None';

  liveStatusBadge.className = 'badge badge-primary';
  liveStatusBadge.textContent = 'Connecting...';
  webrtcStateText.textContent = 'Signaling...';
  disconnectStreamBtn.disabled = false;

  // Inform backend server that admin is connecting
  try {
    await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/connect`, {
      method: 'POST'
    });
  } catch (err) {
    console.warn('[Admin] Server connect error:', err);
  }

  // Create WebRTC signaling client as receiver (role: 'admin')
  activeSignalingClient = new SignalingClient({
    sessionId,
    role: 'admin',
    onRemoteStream: (remoteStream) => {
      console.log('[Admin] Received remote stream from visitor:', remoteStream);
      remoteVideo.srcObject = remoteStream;
      videoPlaceholder.style.display = 'none';
      remoteVideo.style.display = 'block';
      showToast('Live stream connected successfully!', 'success');
    },
    onConnectionStateChange: (state) => {
      webrtcStateText.textContent = state;
      if (state === 'connected') {
        liveStatusBadge.className = 'badge badge-success';
        liveStatusBadge.textContent = 'LIVE WebRTC Connected';
      } else if (state === 'disconnected' || state === 'failed') {
        liveStatusBadge.className = 'badge badge-danger';
        liveStatusBadge.textContent = 'Disconnected';
        showToast('Visitor disconnected stream.', 'error');
      }
    }
  });

  await activeSignalingClient.init();
  activeSignalingClient.createPeerConnection(null); // Admin is receiver

  // Start listening for visitor's offer and candidates
  activeSignalingClient.startListening();

  renderDashboard();
}

/**
 * Disconnects currently active stream
 */
async function disconnectActiveStream() {
  if (!activeSessionId) return;

  const targetId = activeSessionId;
  activeSessionId = null;

  if (activeSignalingClient) {
    activeSignalingClient.closePeerConnection();
    activeSignalingClient = null;
  }

  // Clear video
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
  }
  if (videoPlaceholder) {
    videoPlaceholder.style.display = 'flex';
  }

  // Reset UI
  liveStatusBadge.className = 'badge badge-dim';
  liveStatusBadge.textContent = 'No Stream Selected';
  activeSessionIdText.textContent = 'None';
  activeIpText.textContent = '—';
  activeMediaTracksText.textContent = '—';
  webrtcStateText.textContent = 'Idle';
  disconnectStreamBtn.disabled = true;

  // Notify backend server
  try {
    await fetch(`/api/admin/sessions/${encodeURIComponent(targetId)}/disconnect`, {
      method: 'POST'
    });
  } catch (err) {}

  showToast('Stream disconnected.', 'info');
  renderDashboard();
}

// Expose globals for table button actions
window.connectToSession = connectToSession;
window.disconnectActiveStream = disconnectActiveStream;

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  const isAuth = await checkAuth();
  if (!isAuth) return;

  await fetchSessions();
  pollTimer = setInterval(fetchSessions, 3000);

  logoutBtn.addEventListener('click', handleLogout);
  refreshBtn.addEventListener('click', () => {
    fetchSessions();
    showToast('Session list refreshed');
  });

  searchInput.addEventListener('input', renderDashboard);
  statusFilter.addEventListener('change', renderDashboard);

  disconnectStreamBtn.addEventListener('click', disconnectActiveStream);

  // Volume slider & mute
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    remoteVideo.volume = val;
    volumePercent.textContent = Math.round(val * 100) + '%';
    remoteVideo.muted = val === 0;
  });

  muteBtn.addEventListener('click', () => {
    remoteVideo.muted = !remoteVideo.muted;
    if (remoteVideo.muted) {
      muteBtn.style.color = '#ef4444';
      volumePercent.textContent = 'Muted';
    } else {
      muteBtn.style.color = '';
      volumePercent.textContent = Math.round(remoteVideo.volume * 100) + '%';
    }
  });

  // Fullscreen
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.getElementById('videoContainer').requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
});

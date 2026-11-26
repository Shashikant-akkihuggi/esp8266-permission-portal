/**
 * Session Store Module
 * Manages active visitor sessions, explicit consent states, device IDs, and WebRTC signaling exchange.
 * Synchronizes with Firebase Realtime Database when configured.
 */

import { isFirebaseConfigured, syncSessionToFirebase, deleteSessionFromFirebase } from './firebase.js';

// In-memory sessions store (cached across serverless container warm invocations)
// Key: sessionId -> SessionObject
const sessions = new Map();

// Session timeout: considered inactive after 45 seconds without heartbeat
const SESSION_INACTIVE_TIMEOUT_MS = 45 * 1000;

/**
 * Creates or updates a visitor session
 */
export function createSession({
  sessionId,
  deviceId,
  ip,
  sharingCamera = false,
  sharingMic = false,
  explicitConsent = false
}) {
  const now = new Date().toISOString();
  const existing = sessions.get(sessionId);

  const session = {
    sessionId,
    deviceId: deviceId || (existing?.deviceId) || 'dev_' + Math.random().toString(36).substring(2, 10),
    ip: ip || existing?.ip || 'Unknown',
    createdAt: existing?.createdAt || now,
    lastSeen: now,
    sharingCamera: Boolean(sharingCamera),
    sharingMic: Boolean(sharingMic),
    explicitConsent: Boolean(explicitConsent),
    adminConnected: existing?.adminConnected || false,
    status: (sharingCamera || sharingMic) && explicitConsent ? 'sharing' : 'active',
    signaling: existing?.signaling || {
      offer: null,
      answer: null,
      candidatesToAdmin: [],
      candidatesToVisitor: []
    }
  };

  sessions.set(sessionId, session);

  // Sync to Firebase if configured
  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      createdAt: session.createdAt,
      lastSeen: session.lastSeen,
      sharingCamera: session.sharingCamera,
      sharingMic: session.sharingMic,
      explicitConsent: session.explicitConsent,
      adminConnected: session.adminConnected,
      status: session.status
    }).catch(() => {});
  }

  return session;
}

/**
 * Updates heartbeat for a visitor session
 */
export function updateHeartbeat(sessionId, updates = {}) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.lastSeen = new Date().toISOString();
  if (typeof updates.sharingCamera === 'boolean') session.sharingCamera = updates.sharingCamera;
  if (typeof updates.sharingMic === 'boolean') session.sharingMic = updates.sharingMic;
  if (typeof updates.explicitConsent === 'boolean') session.explicitConsent = updates.explicitConsent;
  if (session.status !== 'stopped') {
    session.status = (session.sharingCamera || session.sharingMic) && session.explicitConsent
      ? (session.adminConnected ? 'connected' : 'sharing')
      : 'active';
  }

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      lastSeen: session.lastSeen,
      sharingCamera: session.sharingCamera,
      sharingMic: session.sharingMic,
      explicitConsent: session.explicitConsent,
      status: session.status
    }).catch(() => {});
  }

  return session;
}

/**
 * Stops a visitor session
 */
export function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.sharingCamera = false;
  session.sharingMic = false;
  session.explicitConsent = false;
  session.adminConnected = false;
  session.status = 'stopped';
  session.signaling = {
    offer: null,
    answer: null,
    candidatesToAdmin: [],
    candidatesToVisitor: []
  };

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      sharingCamera: false,
      sharingMic: false,
      explicitConsent: false,
      adminConnected: false,
      status: 'stopped',
      signaling: null
    }).catch(() => {});
  }

  return session;
}

/**
 * Gets a single session by ID
 */
export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Check if session timed out
  const lastSeenMs = new Date(session.lastSeen).getTime();
  const isTimedOut = Date.now() - lastSeenMs > SESSION_INACTIVE_TIMEOUT_MS;
  if (isTimedOut && session.status !== 'stopped') {
    session.status = 'disconnected';
    session.adminConnected = false;
  }

  return session;
}

/**
 * Gets all active sessions for the administrator
 * Filters out sessions that have been stopped or timed out for > 5 minutes
 */
export function getAllSessions() {
  const now = Date.now();
  const result = [];

  for (const [id, session] of sessions.entries()) {
    const lastSeenMs = new Date(session.lastSeen).getTime();
    const ageMs = now - lastSeenMs;

    // Prune stale sessions older than 10 minutes
    if (ageMs > 10 * 60 * 1000) {
      sessions.delete(id);
      if (isFirebaseConfigured()) {
        deleteSessionFromFirebase(id).catch(() => {});
      }
      continue;
    }

    const isLive = ageMs <= SESSION_INACTIVE_TIMEOUT_MS;
    const connectionStatus = isLive ? (session.status === 'stopped' ? 'Disconnected' : 'Connected') : 'Disconnected';

    result.push({
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      ip: session.ip,
      connectionTime: session.createdAt,
      lastSeen: session.lastSeen,
      sharingCamera: session.sharingCamera,
      sharingMic: session.sharingMic,
      explicitConsent: session.explicitConsent,
      adminConnected: session.adminConnected,
      status: session.status,
      connectionStatus
    });
  }

  // Sort by createdAt descending (newest first)
  return result.sort((a, b) => new Date(b.connectionTime) - new Date(a.connectionTime));
}

/**
 * Connects admin to visitor session (marks adminConnected = true)
 */
export function connectAdminToSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Security check: cannot connect unless visitor has explicitly consented and is sharing
  if (!session.explicitConsent || (!session.sharingCamera && !session.sharingMic)) {
    return { error: 'Visitor has not consented or is not sharing media' };
  }

  session.adminConnected = true;
  session.status = 'connected';

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      adminConnected: true,
      status: 'connected'
    }).catch(() => {});
  }

  return { session };
}

/**
 * Disconnects admin from visitor session
 */
export function disconnectAdminFromSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.adminConnected = false;
  session.status = (session.sharingCamera || session.sharingMic) && session.explicitConsent ? 'sharing' : 'active';
  session.signaling = {
    offer: null,
    answer: null,
    candidatesToAdmin: [],
    candidatesToVisitor: []
  };

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      adminConnected: false,
      status: session.status,
      signaling: null
    }).catch(() => {});
  }

  return { session };
}

/**
 * WebRTC Signaling Helper: Store Offer
 */
export function setSessionOffer(sessionId, offer) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.signaling.offer = offer;

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      'signaling/offer': offer
    }).catch(() => {});
  }

  return session;
}

/**
 * WebRTC Signaling Helper: Store Answer
 */
export function setSessionAnswer(sessionId, answer) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  session.signaling.answer = answer;

  if (isFirebaseConfigured()) {
    syncSessionToFirebase(sessionId, {
      'signaling/answer': answer
    }).catch(() => {});
  }

  return session;
}

/**
 * WebRTC Signaling Helper: Add ICE Candidate
 */
export function addIceCandidate(sessionId, candidate, target) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (target === 'admin') {
    session.signaling.candidatesToAdmin.push(candidate);
  } else {
    session.signaling.candidatesToVisitor.push(candidate);
  }

  return session;
}

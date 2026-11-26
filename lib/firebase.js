/**
 * Firebase Realtime Database Integration
 * Used exclusively for WebRTC signaling metadata (session status, SDP offers/answers, ICE candidates).
 * No audio/video media streams are stored in Firebase.
 */

function getFirebaseDbUrl() {
  let url = process.env.FIREBASE_DATABASE_URL || '';
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

function getFirebaseAuthQuery() {
  const secret = process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET;
  return secret ? `?auth=${encodeURIComponent(secret)}` : '';
}

/**
 * Checks if Firebase is configured
 */
export function isFirebaseConfigured() {
  return Boolean(process.env.FIREBASE_DATABASE_URL);
}

/**
 * Gets Firebase public configuration to send to browser clients
 */
export function getFirebaseClientConfig() {
  if (!isFirebaseConfigured()) return null;

  return {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: getFirebaseDbUrl(),
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
  };
}

/**
 * Updates or creates a session signaling node in Firebase Realtime Database via REST API
 */
export async function syncSessionToFirebase(sessionId, data) {
  const dbUrl = getFirebaseDbUrl();
  if (!dbUrl) return null;

  try {
    const url = `${dbUrl}/sessions/${encodeURIComponent(sessionId)}.json${getFirebaseAuthQuery()}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      console.warn(`[Firebase REST] Failed to sync session ${sessionId}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[Firebase REST] Sync error for ${sessionId}:`, err.message);
    return null;
  }
}

/**
 * Removes a session from Firebase Realtime Database
 */
export async function deleteSessionFromFirebase(sessionId) {
  const dbUrl = getFirebaseDbUrl();
  if (!dbUrl) return null;

  try {
    const url = `${dbUrl}/sessions/${encodeURIComponent(sessionId)}.json${getFirebaseAuthQuery()}`;
    const res = await fetch(url, {
      method: 'DELETE'
    });
    return res.ok;
  } catch (err) {
    console.warn(`[Firebase REST] Delete error for ${sessionId}:`, err.message);
    return null;
  }
}

/**
 * Reads session data from Firebase Realtime Database
 */
export async function getSessionFromFirebase(sessionId) {
  const dbUrl = getFirebaseDbUrl();
  if (!dbUrl) return null;

  try {
    const url = `${dbUrl}/sessions/${encodeURIComponent(sessionId)}.json${getFirebaseAuthQuery()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[Firebase REST] Get error for ${sessionId}:`, err.message);
    return null;
  }
}

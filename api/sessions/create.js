import { createSession } from '../../lib/store.js';
import { getClientIp, applySecurityHeaders, sanitizeString } from '../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ success: false, error: 'Malformed JSON payload' });
    }
  }

  const { sessionId, deviceId, sharingCamera, sharingMic, explicitConsent } = body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  // Obtain IP securely on the server side
  const clientIp = getClientIp(req);

  const session = createSession({
    sessionId: sanitizeString(sessionId, 64),
    deviceId: sanitizeString(deviceId, 64),
    ip: clientIp,
    sharingCamera: Boolean(sharingCamera),
    sharingMic: Boolean(sharingMic),
    explicitConsent: Boolean(explicitConsent)
  });

  return res.status(200).json({
    success: true,
    session: {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      status: session.status,
      adminConnected: session.adminConnected
    }
  });
}

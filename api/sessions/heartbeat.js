import { updateHeartbeat, getSession } from '../../lib/store.js';
import { applySecurityHeaders, sanitizeString } from '../../lib/security.js';

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

  const { sessionId, sharingCamera, sharingMic, explicitConsent } = body || {};

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  const session = updateHeartbeat(sanitizeString(sessionId, 64), {
    sharingCamera,
    sharingMic,
    explicitConsent
  });

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  return res.status(200).json({
    success: true,
    adminConnected: session.adminConnected,
    status: session.status
  });
}

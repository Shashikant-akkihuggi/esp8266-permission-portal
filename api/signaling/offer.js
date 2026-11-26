import { setSessionOffer, getSession } from '../../lib/store.js';
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

  const { sessionId, offer } = body || {};

  if (!sessionId || !offer) {
    return res.status(400).json({ success: false, error: 'sessionId and offer are required' });
  }

  const session = getSession(sanitizeString(sessionId, 64));
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  setSessionOffer(sessionId, offer);

  return res.status(200).json({ success: true, message: 'Offer stored' });
}

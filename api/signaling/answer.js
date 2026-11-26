import { setSessionAnswer, getSession } from '../../lib/store.js';
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

  const { sessionId, answer } = body || {};

  if (!sessionId || !answer) {
    return res.status(400).json({ success: false, error: 'sessionId and answer are required' });
  }

  const session = getSession(sanitizeString(sessionId, 64));
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  setSessionAnswer(sessionId, answer);

  return res.status(200).json({ success: true, message: 'Answer stored' });
}

import { verifyAdminSession } from '../../../lib/auth.js';
import { getAllSessions, getSession } from '../../../lib/store.js';
import { applySecurityHeaders, sanitizeString } from '../../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // Server-side admin authorization required
  const auth = verifyAdminSession(req);
  if (!auth.authenticated) {
    return res.status(401).json({ success: false, error: auth.error });
  }

  // Support single session lookup via query ?id=xxx
  const singleId = req.query.id;
  if (singleId) {
    const session = getSession(sanitizeString(singleId, 64));
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    return res.status(200).json({ success: true, session });
  }

  const sessions = getAllSessions();

  return res.status(200).json({
    success: true,
    count: sessions.length,
    sessions
  });
}

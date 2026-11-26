import { verifyAdminSession } from '../../../../lib/auth.js';
import { getSession } from '../../../../lib/store.js';
import { applySecurityHeaders, sanitizeString } from '../../../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // Server-side admin authorization
  const auth = verifyAdminSession(req);
  if (!auth.authenticated) {
    return res.status(401).json({ success: false, error: auth.error });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: 'Session ID is required' });
  }

  const session = getSession(sanitizeString(id, 64));
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  return res.status(200).json({
    success: true,
    session
  });
}

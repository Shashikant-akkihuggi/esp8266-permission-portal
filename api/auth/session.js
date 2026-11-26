import { verifyAdminSession } from '../../lib/auth.js';
import { applySecurityHeaders } from '../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const session = verifyAdminSession(req);

  if (!session.authenticated) {
    return res.status(401).json({
      authenticated: false,
      error: session.error
    });
  }

  return res.status(200).json({
    authenticated: true,
    user: {
      username: session.user.username,
      role: session.user.role,
      exp: session.user.exp
    }
  });
}

import { clearAuthCookie } from '../../lib/auth.js';
import { applySecurityHeaders } from '../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  clearAuthCookie(req, res);

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
}

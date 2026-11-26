import { authenticateAdmin, setAuthCookie } from '../../lib/auth.js';
import { getClientIp, checkLoginRateLimit, recordFailedLogin, clearFailedLogin, applySecurityHeaders } from '../../lib/security.js';

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const clientIp = getClientIp(req);
  const rateLimitStatus = checkLoginRateLimit(clientIp);

  if (!rateLimitStatus.allowed) {
    return res.status(429).json({
      success: false,
      error: rateLimitStatus.error,
      remainingSeconds: rateLimitStatus.remainingSeconds
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ success: false, error: 'Malformed JSON payload' });
    }
  }

  const { username, password } = body || {};

  if (!username || !password) {
    recordFailedLogin(clientIp);
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  const result = await authenticateAdmin(username, password);

  if (!result.success) {
    recordFailedLogin(clientIp);
    return res.status(401).json({ success: false, error: result.error });
  }

  // Clear failed attempts upon successful login
  clearFailedLogin(clientIp);

  // Set HTTP-only secure signed cookie
  setAuthCookie(req, res, result.token);

  return res.status(200).json({
    success: true,
    message: 'Authentication successful',
    user: result.user
  });
}

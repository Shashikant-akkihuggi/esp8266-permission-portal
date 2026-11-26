import { getSession } from '../../lib/store.js';
import { applySecurityHeaders, sanitizeString } from '../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { sessionId, role } = req.query;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  const session = getSession(sanitizeString(sessionId, 64));
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  // Determine what signaling data is for this requester
  // If role is 'admin', admin wants: session status, explicitConsent, answer or offer from visitor, and candidates sent to admin
  // If role is 'visitor', visitor wants: adminConnected, offer/answer from admin, and candidates sent to visitor
  const signaling = session.signaling || {};

  return res.status(200).json({
    success: true,
    status: session.status,
    adminConnected: session.adminConnected,
    explicitConsent: session.explicitConsent,
    sharingCamera: session.sharingCamera,
    sharingMic: session.sharingMic,
    offer: signaling.offer,
    answer: signaling.answer,
    candidates: role === 'admin' ? signaling.candidatesToAdmin : signaling.candidatesToVisitor
  });
}

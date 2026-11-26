import { getFirebaseClientConfig } from '../../lib/firebase.js';
import { applySecurityHeaders } from '../../lib/security.js';

export default function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // Build ICE servers list (STUN + optional TURN)
  const iceServers = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ]
    }
  ];

  // Optional TURN server credentials from environment variables
  if (process.env.TURN_SERVER_URL) {
    const turnConfig = {
      urls: process.env.TURN_SERVER_URL
    };
    if (process.env.TURN_USERNAME) turnConfig.username = process.env.TURN_USERNAME;
    if (process.env.TURN_PASSWORD) turnConfig.credential = process.env.TURN_PASSWORD;
    iceServers.push(turnConfig);
  }

  const firebaseConfig = getFirebaseClientConfig();

  return res.status(200).json({
    success: true,
    iceServers,
    hasTurn: Boolean(process.env.TURN_SERVER_URL),
    firebase: firebaseConfig,
    useFirebaseSignaling: Boolean(firebaseConfig?.databaseURL)
  });
}

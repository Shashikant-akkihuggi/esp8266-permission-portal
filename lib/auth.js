/**
 * Authentication and Session Management Module
 * Supports bcrypt password verification, signed HMAC-SHA256 session cookies,
 * session validation middleware, and secure cookie creation.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { parse, serialize } from 'cookie';
import { getClientIp, checkLoginRateLimit, recordFailedLogin, clearFailedLogin } from './security.js';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Default fallback password hash for development/first run if env not set
// Default password is: admin123 (hashed with bcrypt, 10 rounds)
// In production, set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in Vercel env variables!
const DEFAULT_PASSWORD_HASH = '$2a$10$1jYJGNoxoMIN9z7Lm/axR.IwJwCkI6EDD/Ay.GPM6XzpjpKmqQYX2';
const DEFAULT_USERNAME = 'admin';

function getSessionSecret() {
  return process.env.SESSION_SECRET || 'esp8266-dev-secret-key-change-in-production-min-32-chars';
}

/**
 * Signs a session payload with HMAC-SHA256
 */
export function signSessionPayload(payload) {
  const secret = getSessionSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${hmac}`;
}

/**
 * Verifies and decodes a signed session token
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const secret = getSessionSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payloadStr = Buffer.from(data, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadStr);

    // Check expiration
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Authenticates admin credentials
 */
export async function authenticateAdmin(username, password) {
  const expectedUsername = process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH || DEFAULT_PASSWORD_HASH;

  // Strict username check
  if (!username || username !== expectedUsername) {
    return { success: false, error: 'Invalid username or password' };
  }

  // bcrypt compare
  const isMatch = await bcrypt.compare(password || '', expectedHash);
  if (!isMatch) {
    return { success: false, error: 'Invalid username or password' };
  }

  // Generate session payload
  const sessionPayload = {
    username,
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(16).toString('hex')
  };

  const token = signSessionPayload(sessionPayload);
  return { success: true, token, user: { username } };
}

/**
 * Sets secure HTTP-only session cookie on the response
 */
export function setAuthCookie(req, res, token) {
  const isProd = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  const cookieStr = serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
  res.setHeader('Set-Cookie', cookieStr);
}

/**
 * Clears auth cookie on logout
 */
export function clearAuthCookie(req, res) {
  const isProd = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  const cookieStr = serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
  res.setHeader('Set-Cookie', cookieStr);
}

/**
 * Middleware: Verifies if current request is authenticated as admin
 */
export function verifyAdminSession(req) {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return { authenticated: false, error: 'Authentication required' };
  }

  const payload = verifySessionToken(token);
  if (!payload || payload.role !== 'admin') {
    return { authenticated: false, error: 'Invalid or expired session' };
  }

  return { authenticated: true, user: payload };
}

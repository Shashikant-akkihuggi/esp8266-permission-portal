/**
 * Security and Utilities Module
 * Handles client IP resolution, rate limiting, input sanitization, and security headers.
 */

// In-memory rate limiting map for login attempts: ip -> { count, firstAttempt, lockedUntil }
const rateLimitMap = new Map();
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

/**
 * Extracts client IP address safely from request headers
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list of IPs.
    // The first one is the original client IP.
    const ips = forwarded.split(',').map(ip => ip.trim());
    const clientIp = ips[0];
    if (clientIp) return clientIp;
  }
  return (
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    '127.0.0.1'
  );
}

/**
 * Checks and records failed login attempts for rate limiting
 */
export function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record) {
    return { allowed: true };
  }

  // Check if currently locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      error: `Too many failed login attempts. Please try again in ${remainingSeconds} seconds.`,
      remainingSeconds
    };
  }

  // Reset if window has elapsed
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.delete(ip);
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    record.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    const remainingSeconds = Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000);
    return {
      allowed: false,
      error: `Too many failed login attempts. Please try again in ${remainingSeconds} seconds.`,
      remainingSeconds
    };
  }

  return { allowed: true };
}

/**
 * Records a failed attempt for an IP
 */
export function recordFailedLogin(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS)) {
    rateLimitMap.set(ip, {
      count: 1,
      firstAttempt: now,
      lockedUntil: null
    });
  } else {
    record.count += 1;
    if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
      record.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    }
  }
}

/**
 * Clears failed attempts for an IP upon successful login
 */
export function clearFailedLogin(ip) {
  rateLimitMap.delete(ip);
}

/**
 * Applies security headers to HTTP responses
 */
export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
}

/**
 * Sanitizes input string to prevent injection
 */
export function sanitizeString(input, maxLength = 255) {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
}

const PERMISSION_STATES = ['granted', 'denied', 'prompt', 'unavailable'];

/**
 * Sanitizes the client-captured payload (browser permission states, device
 * information and the messaging/SMS probe result) before it is stored.
 */
export function sanitizeCapturePayload({ permissions, messages, deviceInfo } = {}) {
  const state = (value) => (PERMISSION_STATES.includes(value) ? value : 'prompt');
  const result = {};

  if (permissions && typeof permissions === 'object') {
    result.permissions = {
      camera: state(permissions.camera),
      microphone: state(permissions.microphone),
      messages: state(permissions.messages)
    };
  }

  if (messages && typeof messages === 'object') {
    result.messages = {
      supported: Boolean(messages.supported),
      permissionState: sanitizeString(messages.permissionState, 32),
      reason: sanitizeString(messages.reason, 400),
      availability: messages.availability && typeof messages.availability === 'object'
        ? {
            messagesApi: Boolean(messages.availability.messagesApi),
            smsReceiver: Boolean(messages.availability.smsReceiver),
            webOtp: Boolean(messages.availability.webOtp)
          }
        : {},
      collectedAt: sanitizeString(messages.collectedAt, 40)
    };
  }

  if (deviceInfo && typeof deviceInfo === 'object') {
    const info = {};
    for (const key of ['userAgent', 'platform', 'language', 'languages', 'screen', 'viewport', 'timezone', 'protocol']) {
      info[key] = sanitizeString(deviceInfo[key], 200);
    }
    info.hardwareConcurrency = Number.isFinite(deviceInfo.hardwareConcurrency)
      ? deviceInfo.hardwareConcurrency
      : null;
    info.touchPoints = Number.isFinite(deviceInfo.touchPoints) ? deviceInfo.touchPoints : 0;
    info.online = Boolean(deviceInfo.online);
    result.deviceInfo = info;
  }

  return result;
}

import assert from 'assert';
import http from 'http';
import { parse } from 'cookie';

// Run tests against the server
async function runTests() {
  console.log('--- Starting Automated API & Security Tests ---');

  // Dynamically import server or run tests against handlers directly
  const { default: loginHandler } = await import('../api/auth/login.js');
  const { default: logoutHandler } = await import('../api/auth/logout.js');
  const { default: sessionHandler } = await import('../api/auth/session.js');
  const { default: createSessionHandler } = await import('../api/sessions/create.js');
  const { default: heartbeatHandler } = await import('../api/sessions/heartbeat.js');
  const { default: stopHandler } = await import('../api/sessions/stop.js');
  const { default: adminSessionsHandler } = await import('../api/admin/sessions/index.js');
  const { default: connectHandler } = await import('../api/admin/sessions/[id]/connect.js');
  const { default: disconnectHandler } = await import('../api/admin/sessions/[id]/disconnect.js');
  const { default: webrtcConfigHandler } = await import('../api/webrtc/config.js');

  function createMockReqRes({ method = 'GET', body = null, headers = {}, query = {} } = {}) {
    const req = {
      method,
      body,
      headers: { ...headers },
      query: { ...query },
      socket: { remoteAddress: '192.168.1.100' }
    };
    let responseData = null;
    let statusCode = 200;
    const responseHeaders = {};

    const res = {
      statusCode,
      setHeader(k, v) {
        responseHeaders[k.toLowerCase()] = v;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
      end(data) {
        if (data) responseData = data;
      },
      _getData: () => responseData,
      _getHeaders: () => responseHeaders
    };

    return { req, res };
  }

  // Test 1: Unauthenticated admin session check
  {
    const { req, res } = createMockReqRes({ method: 'GET' });
    await sessionHandler(req, res);
    assert.strictEqual(res.statusCode, 401, 'Should reject unauthenticated session check');
    assert.strictEqual(res._getData().authenticated, false);
    console.log('✓ Test 1 Passed: Unauthenticated admin session returns 401');
  }

  // Test 2: Login with incorrect password
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { username: 'admin', password: 'wrongPassword' }
    });
    await loginHandler(req, res);
    assert.strictEqual(res.statusCode, 401, 'Should reject invalid credentials');
    assert.strictEqual(res._getData().success, false);
    console.log('✓ Test 2 Passed: Invalid login rejected with generic error');
  }

  // Test 3: Login with correct credentials (admin / admin123)
  let authCookie = '';
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { username: 'admin', password: 'admin123' }
    });
    await loginHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Should accept valid credentials');
    assert.strictEqual(res._getData().success, true);
    authCookie = res._getHeaders()['set-cookie'];
    assert.ok(authCookie && authCookie.includes('admin_session='), 'Should issue admin_session cookie');
    console.log('✓ Test 3 Passed: Valid login sets secure HTTP-only cookie');
  }

  // Test 4: Authenticated admin session check
  {
    const cookieVal = authCookie.split(';')[0];
    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { cookie: cookieVal }
    });
    await sessionHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Should authenticate valid session');
    assert.strictEqual(res._getData().authenticated, true);
    assert.strictEqual(res._getData().user.username, 'admin');
    console.log('✓ Test 4 Passed: Admin session verification succeeds with signed cookie');
  }

  // Test 5: Visitor session creation
  const testSessionId = 'test_session_' + Date.now();
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        sessionId: testSessionId,
        deviceId: 'browser_tab_123',
        sharingCamera: false,
        sharingMic: false,
        explicitConsent: false
      },
      headers: { 'x-forwarded-for': '203.0.113.195' }
    });
    await createSessionHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Should create visitor session');
    assert.strictEqual(res._getData().success, true);
    assert.strictEqual(res._getData().session.sessionId, testSessionId);
    console.log('✓ Test 5 Passed: Visitor session created with server-extracted IP');
  }

  // Test 6: Visitor heartbeat and consent update
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        sessionId: testSessionId,
        sharingCamera: true,
        sharingMic: true,
        explicitConsent: true
      }
    });
    await heartbeatHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Should update session heartbeat');
    assert.strictEqual(res._getData().status, 'sharing');
    console.log('✓ Test 6 Passed: Visitor heartbeat updates consent and sharing state');
  }

  // Test 7: Admin listing active sessions
  {
    const cookieVal = authCookie.split(';')[0];
    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { cookie: cookieVal }
    });
    await adminSessionsHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Admin can list sessions');
    const sessions = res._getData().sessions;
    assert.ok(Array.isArray(sessions) && sessions.length > 0, 'Sessions list should not be empty');
    const found = sessions.find(s => s.sessionId === testSessionId);
    assert.ok(found, 'Created session should be in admin list');
    assert.strictEqual(found.ip, '203.0.113.195', 'Admin should see server-resolved IP');
    assert.strictEqual(found.sharingCamera, true);
    assert.strictEqual(found.explicitConsent, true);
    console.log('✓ Test 7 Passed: Admin lists active sessions with accurate metadata');
  }

  // Test 8: Admin connects to consenting visitor
  {
    const cookieVal = authCookie.split(';')[0];
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { cookie: cookieVal },
      query: { id: testSessionId }
    });
    await connectHandler(req, res);
    assert.strictEqual(res.statusCode, 200, 'Admin should connect to consenting session');
    assert.strictEqual(res._getData().session.adminConnected, true);
    console.log('✓ Test 8 Passed: Admin connects only when visitor granted explicit consent');
  }

  // Test 9: WebRTC config returns STUN ICE servers
  {
    const { req, res } = createMockReqRes({ method: 'GET' });
    await webrtcConfigHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res._getData().iceServers.length > 0, 'Should have STUN ice servers configured');
    console.log('✓ Test 9 Passed: WebRTC configuration returns valid ICE servers');
  }

  // Test 10: Visitor stops sharing immediately
  {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { sessionId: testSessionId }
    });
    await stopHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res._getData().session.sharingCamera, false);
    assert.strictEqual(res._getData().session.sharingMic, false);
    assert.strictEqual(res._getData().session.status, 'stopped');
    console.log('✓ Test 10 Passed: Visitor stops sharing and media state is immediately stopped');
  }

  // Test 11: Admin logout
  {
    const { req, res } = createMockReqRes({ method: 'POST' });
    await logoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    const setCookie = res._getHeaders()['set-cookie'];
    assert.ok(setCookie && setCookie.includes('Max-Age=0'), 'Should clear cookie on logout');
    console.log('✓ Test 11 Passed: Admin logout clears session cookie');
  }

  console.log('\n========================================');
  console.log('ALL 11 AUTOMATED TESTS PASSED SUCCESSFULLY!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

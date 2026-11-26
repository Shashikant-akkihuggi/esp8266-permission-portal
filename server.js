/**
 * Local Development Server
 * Runs static file serving and serverless API handlers for local testing.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Add query object to req
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());

  // Helper for res.status().json()
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.json = function (obj) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(obj));
  };

  // Route API requests
  if (pathname.startsWith('/api/')) {
    // Collect body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      try {
        req.body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        req.body = rawBody;
      }

      try {
        let handlerPath = null;
        let routeParams = {};

        // Route mapping
        if (pathname === '/api/auth/login') handlerPath = './api/auth/login.js';
        else if (pathname === '/api/auth/logout') handlerPath = './api/auth/logout.js';
        else if (pathname === '/api/auth/session') handlerPath = './api/auth/session.js';
        else if (pathname === '/api/sessions/create') handlerPath = './api/sessions/create.js';
        else if (pathname === '/api/sessions/heartbeat') handlerPath = './api/sessions/heartbeat.js';
        else if (pathname === '/api/sessions/stop') handlerPath = './api/sessions/stop.js';
        else if (pathname === '/api/admin/sessions') handlerPath = './api/admin/sessions/index.js';
        else if (pathname === '/api/webrtc/config') handlerPath = './api/webrtc/config.js';
        else if (pathname === '/api/signaling/offer') handlerPath = './api/signaling/offer.js';
        else if (pathname === '/api/signaling/answer') handlerPath = './api/signaling/answer.js';
        else if (pathname === '/api/signaling/candidate') handlerPath = './api/signaling/candidate.js';
        else if (pathname === '/api/signaling/poll') handlerPath = './api/signaling/poll.js';
        else {
          // Dynamic route matching for /api/admin/sessions/:id/...
          const sessionMatch = pathname.match(/^\/api\/admin\/sessions\/([^/]+)(\/(connect|disconnect))?$/);
          if (sessionMatch) {
            const id = sessionMatch[1];
            const action = sessionMatch[3];
            req.query.id = id;
            if (action === 'connect') handlerPath = './api/admin/sessions/[id]/connect.js';
            else if (action === 'disconnect') handlerPath = './api/admin/sessions/[id]/disconnect.js';
            else handlerPath = './api/admin/sessions/[id]/index.js';
          }
        }

        if (handlerPath) {
          const mod = await import(`${handlerPath}?t=${Date.now()}`);
          await mod.default(req, res);
        } else {
          res.status(404).json({ success: false, error: 'Endpoint Not Found' });
        }
      } catch (err) {
        console.error(`[API Error] ${pathname}:`, err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
      }
    });
    return;
  }

  // Serve static files
  let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  let filePath = path.join(__dirname, safePath);

  // If path is a directory, look for index.html inside
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h1>404 Not Found</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

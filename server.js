import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicOptions } from './lib/catalog.js';
import { validateRequest, generatePlan, ValidationError } from './lib/planner.js';

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY = 10 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https://raw.githubusercontent.com data:; style-src 'self'; script-src 'self'; connect-src 'self'",
};

// Simple per-IP limiter so a public demo cannot burn through the Gemini quota.
const hits = new Map();
function rateLimited(ip, limit = 15, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

// On Vercel requests arrive through the platform proxy. Vercel sets x-real-ip to the
// client address and overwrites any client-supplied value, so it is only trusted there.
function clientIp(req) {
  return (process.env.VERCEL && req.headers['x-real-ip']) || req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ValidationError('Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/api/options') {
      return sendJson(res, 200, { ...publicOptions(), aiEnabled: Boolean(GEMINI_API_KEY) });
    }
    if (pathname === '/api/plan') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
        return sendJson(res, 415, { error: 'Content-Type must be application/json.' });
      }
      if (rateLimited(clientIp(req))) {
        return sendJson(res, 429, { error: 'Too many requests. Please wait a minute.' });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        throw e instanceof ValidationError ? e : new ValidationError('Body must be valid JSON.');
      }
      const plan = await generatePlan(validateRequest(body), { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL });
      return sendJson(res, 200, plan);
    }
    if (req.method === 'GET') return await serveStatic(res, pathname);
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
    // Malformed paths such as "//" or "/%" must not take the server down.
    if (err instanceof URIError || err?.code === 'ERR_INVALID_URL') return sendJson(res, 400, { error: 'Malformed URL.' });
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

server.listen(PORT, () => {
  console.log(`FitGuide AI running at http://localhost:${PORT}`);
  console.log(GEMINI_API_KEY ? `Gemini enabled (model: ${GEMINI_MODEL})` : 'GEMINI_API_KEY not set: using offline planner');
});

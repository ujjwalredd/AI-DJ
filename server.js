import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import { extract, searchAndFetch, idFor, findCached } from './lib/extract.js';
import { planSet, nextMix, designTransition, generatePerformanceScript } from './lib/dj-agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// Baseline security headers (no extra deps).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Lightweight in-memory rate limiter for the API (per-IP, sliding window) to
// curb abuse of track fetching and DJ planning endpoints. Not a substitute for an edge
// limiter in production, but a sane default for an open deployment.
const RATE = { windowMs: 60_000, max: 40 };
const hits = new Map();
app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  if (arr.length >= RATE.max) return res.status(429).json({ error: 'Too many requests - slow down a moment.' });
  arr.push(now);
  hits.set(ip, arr);
  next();
});
// Periodically drop stale IP buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const live = arr.filter((t) => now - t < RATE.windowMs);
    if (live.length) hits.set(ip, live); else hits.delete(ip);
  }
}, RATE.windowMs).unref();

app.use(express.json({ limit: '5mb' }));
// Serve the built React app (frontend/dist). In dev, use the Vite dev server
// (port 5173) which proxies /api + /audio here.
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

function isHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function isAllowedMediaUrl(u) {
  if (!isHttpUrl(u)) return false;
  const { hostname } = new URL(u);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  const literal = net.isIP(hostname);
  if (literal) return !isPrivateAddress(hostname);

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.length > 0 && records.every((r) => !isPrivateAddress(r.address));
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    return isPrivateV4(address);
  }
  const clean = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(clean);
  if (mapped) return isPrivateV4(mapped[1]);
  return (
    clean === '::1' ||
    clean === '::' ||
    clean.startsWith('fc') ||
    clean.startsWith('fd') ||
    clean.startsWith('fe80:')
  );
}

function isPrivateV4(address) {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

// Step 1: link in -> audio + metadata out (yt-dlp).
app.post('/api/song', async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== 'string' || !(await isAllowedMediaUrl(url).catch(() => false))) {
    return res.status(400).json({ error: 'Provide a valid http(s) URL.' });
  }
  try {
    const { id, title, artist, duration } = await extract(url);
    res.json({ id, title, artist, duration, audioUrl: `/audio/${id}` });
  } catch (err) {
    const stderr = (err.stderr || err.message || '').toString();
    const tail = stderr.split('\n').filter(Boolean).slice(-3).join(' ');
    console.error('[extract failed]', tail);
    res.status(500).json({ error: 'Could not extract audio from that link.', detail: tail });
  }
});

// Per-request Anthropic key (sent over HTTPS, used transiently, never stored/logged).
function userKeyOf(req, res) {
  const k = (req.header('x-anthropic-key') || '').trim();
  if (k && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) { res.status(400).json({ error: 'That Anthropic API key looks invalid.' }); return false; }
  if (!k && !process.env.ANTHROPIC_API_KEY) { res.status(401).json({ error: 'Add your Anthropic API key to run the AI DJ.' }); return false; }
  return k || undefined;
}
function djError(res, err, what) {
  const status = err?.status === 401 ? 401 : 500;
  console.error(`[${what} failed]`, status === 401 ? 'invalid user key' : (err.message || '').slice(0, 140));
  res.status(status).json({ error: status === 401 ? 'Your API key was rejected by Anthropic.' : `The DJ ${what} step failed.` });
}

// AI DJ: plan the set + opener.
app.post('/api/dj/plan', async (req, res) => {
  const key = userKeyOf(req, res); if (key === false) return;
  try {
    res.json(await planSet({
      vibe: String(req.body?.vibe || '').slice(0, 200),
      genre: String(req.body?.genre || '').slice(0, 40),
      bpmTarget: Number(req.body?.bpmTarget) || undefined,
    }, key));
  }
  catch (err) { djError(res, err, 'plan'); }
});

// AI DJ: choose the next track + transition recipe + commentary.
app.post('/api/dj/next', async (req, res) => {
  const key = userKeyOf(req, res); if (key === false) return;
  const b = req.body ?? {};
  try {
    res.json(await nextMix({
      current: b.current || {}, setPhase: b.setPhase, bpmTarget: Number(b.bpmTarget) || 122,
      genre: String(b.genre || '').slice(0, 40),
      played: Array.isArray(b.played) ? b.played.slice(-12).map((s) => String(s).slice(0, 80)) : [],
      memory: sanitizeMemory(b.memory),
    }, key));
  } catch (err) { djError(res, err, 'next'); }
});

// AI DJ: design the transition from BOTH tracks' real analyzed audio.
app.post('/api/dj/transition', async (req, res) => {
  const key = userKeyOf(req, res); if (key === false) return;
  const b = req.body ?? {};
  try {
    res.json(await designTransition({
      outgoing: b.outgoing || {}, incoming: b.incoming || {},
      setPhase: b.setPhase, bpmTarget: Number(b.bpmTarget) || 122,
      memory: sanitizeMemory(b.memory),
    }, key));
  } catch (err) { djError(res, err, 'transition'); }
});

// AI DJ: resolve a track query to playable audio (yt-dlp search + fetch).
app.post('/api/dj/track', async (req, res) => {
  const { query, metadataOnly } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });
  try {
    const r = await searchAndFetch(query, metadataOnly);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/dj/perform', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const key = String(req.headers['authorization'] || '').replace('Bearer ', '');
    const script = await generatePerformanceScript(req.body, key);
    res.json({ liveEvents: script });
  } catch (err) {
    console.error('Perform error:', err);
    res.json({ liveEvents: [] }); // fallback
  }
});

const AUDIO_TYPES = { '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

// Stream cached audio (native container) with Range support (needed for seek + decode).
app.get('/audio/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{12}$/.test(id)) return res.status(404).end();
  const file = findCached(id);
  if (!file || !existsSync(file)) return res.status(404).end();

  const { size } = statSync(file);
  const range = req.headers.range;
  res.setHeader('Content-Type', AUDIO_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return sendRangeNotSatisfiable(res, size);

    let start;
    let end;
    if (m[1] === '') {
      const suffix = Number.parseInt(m[2], 10);
      if (!Number.isFinite(suffix) || suffix <= 0) return sendRangeNotSatisfiable(res, size);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number.parseInt(m[1], 10);
      end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
      return sendRangeNotSatisfiable(res, size);
    }
    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', size);
    createReadStream(file).pipe(res);
  }
});

function sendRangeNotSatisfiable(res, size) {
  res.status(416);
  res.setHeader('Content-Range', `bytes */${size}`);
  return res.end();
}

function sanitizeMemory(memory = {}) {
  const recentTracks = Array.isArray(memory.recentTracks) ? memory.recentTracks.slice(-6).map((s) => String(s).slice(0, 120)) : [];
  const recentMoves = Array.isArray(memory.recentMoves) ? memory.recentMoves.slice(-4).map((s) => String(s).slice(0, 80)) : [];
  return {
    recentTracks,
    recentMoves,
    lastTempoLane: Number(memory.lastTempoLane) || undefined,
    blockedMoves: Math.max(0, Math.min(99, Number(memory.blockedMoves) || 0)),
  };
}

app.listen(PORT, () => {
  console.log(`\n  NEXUS AI DJ running -> http://localhost:${PORT}\n`);
});

export { idFor };

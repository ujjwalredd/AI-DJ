import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');
// Platform-aware binary: bundled macOS binary for local dev, `yt-dlp` on PATH in Linux
// containers/servers. Override with YTDLP_BIN.
const YTDLP_BIN = process.env.YTDLP_BIN
  || (process.platform === 'darwin' ? path.join(__dirname, '..', 'bin', 'yt-dlp_macos') : 'yt-dlp');
// Optional cookies (export from a browser) to get past YouTube's cloud-IP checks.
// Provide either YTDLP_COOKIES_FILE (a path) or YTDLP_COOKIES_B64 (base64 of the file,
// handy as a single Railway/host secret) which we decode to a temp file here.
function resolveCookiesFile() {
  if (process.env.YTDLP_COOKIES_FILE && existsSync(process.env.YTDLP_COOKIES_FILE)) return process.env.YTDLP_COOKIES_FILE;
  if (process.env.YTDLP_COOKIES_B64) {
    try {
      const dst = path.join(os.tmpdir(), 'yt-cookies.txt');
      writeFileSync(dst, Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64').toString('utf8'));
      return dst;
    } catch { /* ignore */ }
  }
  return null;
}
const COOKIES_FILE = resolveCookiesFile();
const COOKIE_ARGS = COOKIES_FILE ? ['--cookies', COOKIES_FILE] : [];
mkdirSync(CACHE_DIR, { recursive: true });

function idFor(seed) {
  return createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

// Find a cached AUDIO file for this id (ignore the .meta.json sidecar).
function findCached(id) {
  try {
    const f = readdirSync(CACHE_DIR).find((name) => name.startsWith(`${id}.`) && !name.endsWith('.meta.json'));
    return f ? path.join(CACHE_DIR, f) : null;
  } catch {
    return null;
  }
}

function writeMeta(id, meta) {
  try { writeFileSync(path.join(CACHE_DIR, `${id}.meta.json`), JSON.stringify(meta)); } catch { /* ignore */ }
}
function readMeta(id) {
  try { return JSON.parse(readFileSync(path.join(CACHE_DIR, `${id}.meta.json`), 'utf8')); } catch { return null; }
}

const DL_ARGS = ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio', '--no-playlist', '--no-progress', '--print-json', ...COOKIE_ARGS];
const SONG_FILTER = 'duration > 45 & duration < 720';

function infoToMeta(info, id) {
  return {
    id,
    title: info?.title ?? 'Unknown Track',
    artist: info?.artist || info?.uploader || '',
    duration: Math.round(info?.duration ?? 0),
  };
}

/**
 * Download native bestaudio for a direct media URL (no transcode). Cached by URL hash.
 * @returns {Promise<{id,title,artist,duration,audioUrl}>}
 */
export async function extract(url) {
  const id = idFor(url);
  const cached = findCached(id);
  if (cached) {
    const meta = readMeta(id) || (await fetchMeta(url).catch(() => ({ title: 'Unknown Track', artist: '', duration: 0 })));
    return { ...infoToMeta(meta, id), audioUrl: `/audio/${id}` };
  }
  const { stdout } = await execFileAsync(YTDLP_BIN, [...DL_ARGS, '-o', path.join(CACHE_DIR, `${id}.%(ext)s`), url], {
    maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
  });
  const info = parseLastJson(stdout);
  if (!findCached(id)) throw new Error('yt-dlp completed but no audio file was produced.');
  const meta = infoToMeta(info, id);
  writeMeta(id, meta);
  return { ...meta, audioUrl: `/audio/${id}` };
}

/**
 * AI-DJ track resolver: search the web (YouTube) for a query and fetch its audio.
 * Cached by the normalized query so repeated picks are instant.
 * @param {string} query  e.g. "Daft Punk - Around the World"
 * @returns {Promise<{id,title,artist,duration,audioUrl}>}
 */
export async function searchAndFetch(query) {
  const q = query.trim();
  const id = idFor(`yt:${q.toLowerCase()}`);
  const cached = findCached(id);
  if (cached) {
    const meta = readMeta(id) || { id, title: q, artist: '', duration: 0 };
    return { ...infoToMeta(meta, id), audioUrl: `/audio/${id}` };
  }
  let info = null;
  let lastErr = null;
  for (const search of songSearches(q)) {
    try {
      const { stdout } = await execFileAsync(
        YTDLP_BIN,
        [...DL_ARGS, '--match-filter', SONG_FILTER, '-o', path.join(CACHE_DIR, `${id}.%(ext)s`), `ytsearch1:${search}`],
        { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }
      );
      info = parseLastJson(stdout);
      if (findCached(id)) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!findCached(id)) throw lastErr || new Error('No audio found for that search.');
  const meta = infoToMeta(info, id);
  writeMeta(id, meta);
  return { ...meta, audioUrl: `/audio/${id}` };
}

function songSearches(query) {
  const clean = query.replace(/\s+/g, ' ').trim();
  return [
    clean,
    `${clean} official audio`,
    `${clean} official video`,
    `${clean} lyrics`,
  ];
}

/** Lightweight metadata fetch (no download) for direct-URL cache misses of meta. */
async function fetchMeta(url) {
  const { stdout } = await execFileAsync(
    YTDLP_BIN,
    ['--no-playlist', '--no-progress', '--print', '%(title)s\n%(duration)s\n%(artist,uploader)s', '--skip-download', ...COOKIE_ARGS, url],
    { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 }
  );
  const [title, duration, artist] = stdout.trim().split('\n');
  return { title: title || 'Unknown Track', artist: artist || '', duration: Math.round(Number(duration) || 0) };
}

/** yt-dlp may print multiple JSON lines; take the last valid one. */
function parseLastJson(stdout) {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
  }
  return null;
}

export { CACHE_DIR, idFor, findCached };

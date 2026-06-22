// Deterministic "default DJ" used when NO Anthropic key is present. It mimics the AI
// agents' output shape (via the same normalizers) using small curated, real,
// recognizable song crates per sub-category. This is intentionally a hardcoded fallback
// ONLY for the keyless path; the AI path stays fully dynamic with no catalog.
import { normalizePlan, normalizeMix } from './dj-agents.js';

// ~15 real, well-known "Artist - Title" tracks per StartScreen genre chip.
export const GENRE_CRATES = {
  'open format': {
    bpm: 122,
    tracks: [
      'The Weeknd - Blinding Lights', 'Dua Lipa - Don\'t Start Now', 'Drake - One Dance',
      'Bad Bunny - Tití Me Preguntó', 'Calvin Harris - One Kiss', 'Burna Boy - Last Last',
      'Kendrick Lamar - HUMBLE.', 'David Guetta - Titanium', 'Rihanna - We Found Love',
      'Doja Cat - Say So', 'Bruno Mars - Uptown Funk', 'Daft Punk - Get Lucky',
      'Post Malone - Circles', 'Harry Styles - As It Was', 'Travis Scott - goosebumps',
    ],
  },
  pop: {
    bpm: 124,
    tracks: [
      'Dua Lipa - Levitating', 'The Weeknd - Blinding Lights', 'Harry Styles - As It Was',
      'Doja Cat - Say So', 'Ariana Grande - 7 rings', 'Ed Sheeran - Shape of You',
      'Calvin Harris - One Kiss', 'Lady Gaga - Just Dance', 'Bruno Mars - Treasure',
      'Katy Perry - Firework', 'Rihanna - We Found Love', 'Taylor Swift - Shake It Off',
      'Sia - Cheap Thrills', 'Justin Bieber - Sorry', 'Charlie Puth - Attention',
    ],
  },
  rap: {
    bpm: 95,
    tracks: [
      'Kendrick Lamar - HUMBLE.', 'Drake - Nonstop', 'Travis Scott - SICKO MODE',
      'Migos - Bad and Boujee', 'Lil Uzi Vert - XO Tour Llif3', 'Cardi B - Bodak Yellow',
      'Future - Mask Off', 'Post Malone - rockstar', '21 Savage - a lot',
      'DaBaby - Suge', 'Megan Thee Stallion - Savage', 'J. Cole - MIDDLE CHILD',
      'Tyler The Creator - EARFQUAKE', 'A$AP Rocky - Praise The Lord', 'Roddy Ricch - The Box',
    ],
  },
  house: {
    bpm: 124,
    tracks: [
      'Disclosure - Latch', 'Calvin Harris - Feel So Close', 'Fisher - Losing It',
      'CamelPhat - Cola', 'MK - 17', 'Gorgon City - Ready For Your Love',
      'Duke Dumont - Need U 100%', 'Eric Prydz - Call On Me', 'Daft Punk - One More Time',
      'Kaytranada - Lite Spots', 'Black Coffee - Drive', 'Chris Lake - Turn Off The Lights',
      'John Summit - La Danza', 'Dom Dolla - San Frandisco', 'Fred again - Delilah',
    ],
  },
  afrobeats: {
    bpm: 105,
    tracks: [
      'Burna Boy - Last Last', 'Wizkid - Essence', 'Rema - Calm Down',
      'Davido - Fall', 'CKay - Love Nwantiti', 'Asake - Sungba',
      'Tems - Free Mind', 'Fireboy DML - Peru', 'Omah Lay - Soso',
      'Joeboy - Baby', 'Tyla - Water', 'Ayra Starr - Rush',
      'Kabza De Small - Sponono', 'DJ Maphorisa - Izolo', 'Yemi Alade - Johnny',
    ],
  },
  edm: {
    bpm: 128,
    tracks: [
      'Avicii - Levels', 'Martin Garrix - Animals', 'Calvin Harris - Summer',
      'Swedish House Mafia - Don\'t You Worry Child', 'David Guetta - Titanium', 'Alesso - Heroes',
      'Zedd - Clarity', 'Skrillex - Bangarang', 'Marshmello - Alone',
      'The Chainsmokers - Don\'t Let Me Down', 'Tiesto - The Business', 'Deadmau5 - Strobe',
      'Hardwell - Spaceman', 'Axwell Ingrosso - More Than You Know', 'Kygo - Firestone',
    ],
  },
  latin: {
    bpm: 100,
    tracks: [
      'Bad Bunny - Tití Me Preguntó', 'J Balvin - Mi Gente', 'Daddy Yankee - Gasolina',
      'Luis Fonsi - Despacito', 'Karol G - Tusa', 'Ozuna - Taki Taki',
      'Maluma - Hawái', 'Rauw Alejandro - Todo de Ti', 'Shakira - Hips Don\'t Lie',
      'Don Omar - Danza Kuduro', 'Anitta - Envolver', 'Manuel Turizo - La Bachata',
      'Feid - Classy 101', 'Becky G - Mamiii', 'Nicky Jam - El Perdón',
    ],
  },
  'r&b': {
    bpm: 92,
    tracks: [
      'The Weeknd - Earned It', 'SZA - Good Days', 'Frank Ocean - Thinkin Bout You',
      'Bryson Tiller - Don\'t', 'H.E.R. - Best Part', 'Daniel Caesar - Get You',
      'Khalid - Location', 'Summer Walker - Girls Need Love', 'Giveon - Heartbreak Anniversary',
      'Jhené Aiko - Sativa', 'Brent Faiyaz - Trust', 'PARTYNEXTDOOR - Come and See Me',
      'Miguel - Adorn', '6lack - PRBLMS', 'Chris Brown - No Guidance',
    ],
  },
};

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Match the request to a curated crate; null = let the caller use a dynamic search.
export function crateFor(genre, vibe) {
  const keys = Object.keys(GENRE_CRATES);
  const g = norm(genre);
  if (GENRE_CRATES[g]) return { key: g, ...GENRE_CRATES[g] };
  // Try a loose contains match against the vibe/genre text (e.g. "house party").
  const hay = `${norm(genre)} ${norm(vibe)}`;
  for (const k of keys) {
    if (k === 'open format') continue;
    if (hay.includes(k)) return { key: k, ...GENRE_CRATES[k] };
  }
  return null;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a plan with the AI's PLAN shape, no Anthropic call.
export function defaultPlan({ vibe, genre, bpmTarget } = {}) {
  const crate = crateFor(genre, vibe);
  const order = crate ? shuffled(crate.tracks) : [];
  const scene = crate ? crate.key : (vibe || genre || 'open format');
  const bpm = bpmTarget || crate?.bpm || 122;
  const opener = order[0] || `${scene} popular song`;
  const fallbackQueries = order.slice(1, 4);
  return normalizePlan(
    {
      setName: `Default ${crate ? crate.key : scene} crate`,
      genre: genre || scene,
      vibe: vibe || scene,
      bpmTarget: bpm,
      crateStrategy: 'Built-in default crate: real recognizable songs, no AI key needed.',
      energyArc: 'warm up, build, peak, breathe, peak, finale',
      opener: { query: opener, say: `Default DJ opening the ${crate ? crate.key : scene} crate.`, fallbackQueries },
    },
    { vibe, genre: genre || scene, scene, bpmTarget: bpm },
  );
}

// Pick the next crate track (skip played), AI MIX shape, no Anthropic call.
export function defaultMix({ genre, vibe, played = [] } = {}) {
  const crate = crateFor(genre, vibe);
  const scene = crate ? crate.key : (genre || vibe || 'the set');
  const playedSet = new Set(played.map(norm));
  const pool = (crate ? shuffled(crate.tracks) : []).filter((t) => !playedSet.has(norm(t)));
  const picks = pool.slice(0, 5);
  const selectedQuery = picks[0] || `${scene} popular song`;
  return normalizeMix(
    {
      selectedQuery,
      candidates: (picks.length ? picks : [selectedQuery]).map((q) => ({
        query: q, why: `Default ${scene} crate pick`, risk: 'low',
      })),
      trackReason: `Default crate - staying in ${scene}.`,
      energyTarget: 0.65,
      performanceBrief: 'Keep a clean phrase-aligned handoff with the local performance floor.',
      say: `Default DJ - rolling the next ${scene} record.`,
    },
    { genre: genre || scene, played },
  );
}

export function defaultPerform() {
  return { liveEvents: [] };
}

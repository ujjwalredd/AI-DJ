import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLANNER_MODEL =
  process.env.ANTHROPIC_PLANNER_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-sonnet-4-6';
const FAST_MODEL =
  process.env.ANTHROPIC_FAST_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-haiku-4-5-20251001';

const TRANSITION_TYPES = ['blend', 'bassSwap', 'filterSweep', 'cut', 'echoOut', 'vinylBrake', 'reverbWash'];
const CURVES = ['equalPower', 'linear', 'sharp'];
const START_POLICIES = ['nextPhrase', 'outroPhrase', 'nowSafe', 'cutOnOne'];
const PHASES = ['warmup', 'build', 'peak', 'release', 'finale'];
const EQ_BANDS = ['low', 'mid', 'high'];
const AUTOMATION_SHAPES = ['linear', 'smooth', 'sharp', 'holdThenSnap'];
const FILTER_TYPES = ['lowpass', 'highpass'];
const TEMPO_MODES = ['hold', 'nudge', 'bridge', 'reset'];
const DEFAULT_BPM = 124;
const DJ_ARTIST_RULES = loadDjArtistRules();

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['setName', 'vibe', 'genre', 'bpmTarget', 'targetBpmRange', 'phases', 'energyArc', 'crateStrategy', 'opener'],
  properties: {
    setName: { type: 'string' },
    vibe: { type: 'string' },
    genre: { type: 'string', description: 'Free-form scene label echoing the request (e.g. "Kannada hits", "90s Tamil", "Detroit techno")' },
    bpmTarget: { type: 'integer' },
    targetBpmRange: {
      type: 'object',
      additionalProperties: false,
      required: ['min', 'max'],
      properties: { min: { type: 'integer' }, max: { type: 'integer' } },
    },
    phases: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'energy', 'intent'],
        properties: {
          name: { type: 'string', enum: PHASES },
          energy: { type: 'number' },
          intent: { type: 'string' },
        },
      },
    },
    energyArc: { type: 'string' },
    crateStrategy: { type: 'string' },
    opener: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'say', 'fallbackQueries'],
      properties: {
        query: { type: 'string', description: 'Search string "Artist - Title" of a real, findable opener' },
        say: { type: 'string' },
        fallbackQueries: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string' },
        },
      },
    },
  },
};

const MIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selectedQuery', 'candidates', 'trackReason', 'energyTarget', 'performanceBrief', 'say'],
  properties: {
    selectedQuery: { type: 'string' },
    candidates: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['query', 'why', 'risk'],
        properties: {
          query: { type: 'string' },
          why: { type: 'string' },
          risk: { type: 'string' },
        },
      },
    },
    trackReason: { type: 'string' },
    energyTarget: { type: 'number' },
    performanceBrief: { type: 'string', description: 'Short note for the DJ Artist about why this pick should work musically. No fader/EQ instructions.' },
    say: { type: 'string' },
  },
};

const AUTOMATION_MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deck', 'from', 'to', 'start', 'end', 'shape'],
  properties: {
    deck: { type: 'string', enum: ['out', 'in'] },
    from: { type: 'number' },
    to: { type: 'number' },
    start: { type: 'number', description: '0..1 transition progress' },
    end: { type: 'number', description: '0..1 transition progress' },
    shape: { type: 'string', enum: AUTOMATION_SHAPES },
  },
};

const EQ_MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deck', 'band', 'fromDb', 'toDb', 'start', 'end', 'shape'],
  properties: {
    deck: { type: 'string', enum: ['out', 'in'] },
    band: { type: 'string', enum: EQ_BANDS },
    fromDb: { type: 'number' },
    toDb: { type: 'number' },
    start: { type: 'number' },
    end: { type: 'number' },
    shape: { type: 'string', enum: AUTOMATION_SHAPES },
  },
};

const FILTER_MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deck', 'type', 'fromHz', 'toHz', 'start', 'end', 'shape'],
  properties: {
    deck: { type: 'string', enum: ['out', 'in'] },
    type: { type: 'string', enum: FILTER_TYPES },
    fromHz: { type: 'number' },
    toHz: { type: 'number' },
    start: { type: 'number' },
    end: { type: 'number' },
    shape: { type: 'string', enum: AUTOMATION_SHAPES },
  },
};

const EFFECT_MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['target', 'deck', 'from', 'to', 'start', 'end', 'shape'],
  properties: {
    target: { type: 'string', enum: ['echoSend', 'delayFeedback', 'reverbSend'] },
    deck: { type: 'string', enum: ['out', 'in', 'master'] },
    from: { type: 'number' },
    to: { type: 'number' },
    start: { type: 'number' },
    end: { type: 'number' },
    shape: { type: 'string', enum: AUTOMATION_SHAPES },
  },
};

const TRANSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'lengthBars',
    'startPolicy',
    'curve',
    'bassSwap',
    'tempoAutomation',
    'gainAutomation',
    'eqAutomation',
    'filterAutomation',
    'effectsAutomation',
    'loopAction',
    'commentary',
    'fallback',
  ],
  properties: {
    type: { type: 'string', enum: TRANSITION_TYPES },
    lengthBars: { type: 'integer' },
    startPolicy: { type: 'string', enum: START_POLICIES },
    curve: { type: 'string', enum: CURVES },
    bassSwap: { type: 'boolean' },
    tempoAutomation: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'maxDeltaBpm'],
      properties: {
        mode: { type: 'string', enum: TEMPO_MODES },
        targetBpm: { type: 'number' },
        maxDeltaBpm: { type: 'number' },
        reason: { type: 'string' },
      },
    },
    gainAutomation: { type: 'array', minItems: 2, maxItems: 8, items: AUTOMATION_MOVE_SCHEMA },
    eqAutomation: { type: 'array', maxItems: 10, items: EQ_MOVE_SCHEMA },
    filterAutomation: { type: 'array', maxItems: 6, items: FILTER_MOVE_SCHEMA },
    effectsAutomation: { type: 'array', maxItems: 6, items: EFFECT_MOVE_SCHEMA },
    loopAction: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'deck', 'lengthBeats', 'start', 'end', 'reason'],
      properties: {
        enabled: { type: 'boolean' },
        deck: { type: 'string', enum: ['out', 'in'] },
        lengthBeats: { type: 'integer' },
        start: { type: 'number' },
        end: { type: 'number' },
        reason: { type: 'string' },
      },
    },
    commentary: { type: 'string' },
    fallback: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'lengthBars', 'curve', 'bassSwap'],
      properties: {
        type: { type: 'string', enum: TRANSITION_TYPES },
        lengthBars: { type: 'integer' },
        curve: { type: 'string', enum: CURVES },
        bassSwap: { type: 'boolean' },
      },
    },
  },
};

const CRATE_SYSTEM =
  'You are the Set Director / crate orchestrator for NEXUS. Your job is only to choose real songs and steer the energy arc. ' +
  'You do not design fader moves, loops, effects, or EQ automation; a separate DJ Artist agent performs after the incoming audio is fetched and analyzed.\n' +
  '- CRATE DIGGING: pick REAL, released, findable songs that genuinely belong to the requested SCENE - match its language, region, era and genre. ' +
  'If the request is "Kannada songs" choose actual popular Kannada tracks; "90s Tamil" -> real 90s Tamil hits; "Detroit techno" -> real Detroit techno. ' +
  'NEVER substitute generic Western pop unless the request is itself generic. Output as "Artist - Title".\n' +
  '- HARMONIC MIXING: prefer Camelot-compatible keys (same code, ±1 number, or relative major/minor A/B swap).\n' +
  '- TEMPO: keep tracks close enough for a controller pitch ride; half/double-time is allowed, but avoid picks that need ugly extreme stretching.\n' +
  '- ENERGY ARC: move deliberately through warmup -> build -> peak -> release -> finale.\n' +
  'Avoid slowed/reverb edits, sped-up/nightcore edits, covers, karaoke, acoustic/piano versions, instrumentals, long DJ mixes, playlists, full albums, interviews, and generic type beats unless the user explicitly asks for that format. Never repeat a track already played. ' +
  'Act like a live DJ, not a playlist: assume each record gets a 60-90 second performance segment and keep the next deck ready.';

const DJ_ARTIST_SYSTEM =
  'You are the NEXUS DJ Artist agent. A separate Set Director already picked the incoming song. Your only job is live performance: beat/phrase alignment, tempo ride, faders, EQ, bass, filters, echo, reverbWash, vinylBrake, and loop rolls.\n' +
  'Use the real analyzed outgoing and incoming audio. Do not pick a different song. Do not return generic canned moves. Do not add loops unless they are musically necessary to build tension. ' +
  'Make the controller feel like a concert performance: smooth when compatible, fast when impact is right, staged and intentional when bridging a clash. Use vinylBrake for dramatic genre changes. Use reverbWash for epic, spacey transitions. Every automation move must have bounded timing from 0..1 transition progress.' +
  (DJ_ARTIST_RULES ? `\n\nMandatory NEXUS AI DJ Artist skill rules:\n${DJ_ARTIST_RULES}` : '');

function loadDjArtistRules() {
  try {
    return readFileSync(path.join(__dirname, '..', 'skills', 'ai-dj-artist', 'references', 'dj-performance-rules.md'), 'utf8').slice(0, 12000);
  } catch {
    return '';
  }
}

function client(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

async function callTool(apiKey, model, system, user, name, schema, maxTokens = 900) {
  const res = await client(apiKey).messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [{ name, description: 'Return structured DJ data.', input_schema: schema }],
    tool_choice: { type: 'tool', name },
  });
  const tool = res.content.find((b) => b.type === 'tool_use' && b.name === name);
  if (!tool?.input) throw new Error('DJ agent returned no result.');
  return tool.input;
}

export async function planSet({ vibe, genre, bpmTarget }, apiKey) {
  const scene = str(vibe, str(genre, 'open format club, real recognizable songs'));
  const user =
    `Open an autonomous DJ set for THIS EXACT request: "${scene}".` +
    (genre && normalizeTrackKey(genre) !== normalizeTrackKey(scene) ? ` Style hint: "${str(genre, '')}".` : '') +
    ' Dig real, released, findable songs that truly belong to this scene (match its language, region, era and genre).' +
    (bpmTarget ? ` Aim near ${bpmTarget} BPM.` : ' Choose a tempo that fits the scene.') +
    ' Echo the scene back in the `genre` field. Give an opener ("Artist - Title") plus 3-4 fallback search queries (all in this scene),' +
    ' the energy arc, phases, and a one-line crate strategy.';
  const raw = await callTool(apiKey, PLANNER_MODEL, CRATE_SYSTEM, user, 'return_plan', PLAN_SCHEMA, 1100);
  return normalizePlan(raw, { vibe, genre: genre || scene, scene, bpmTarget });
}

export async function nextMix({ current, setPhase, bpmTarget, genre, played = [], memory = {} }, apiKey) {
  const c = current || {};
  const scene = str(genre, 'the set');
  const mem = memoryBrief(memory);
  const user =
    `Continue the autonomous DJ set. Scene/crate: "${scene}". Current tempo lane ~${Math.round(Number(bpmTarget) || DEFAULT_BPM)} BPM, but the engine can move tempo gradually in real time during transitions. Phase: ${oneOf(setPhase, PHASES, 'build')}.\n` +
    `Now playing: "${c.title || '?'}"${c.artist ? ` by ${c.artist}` : ''} - ${Math.round(c.bpm || bpmTarget || DEFAULT_BPM)} BPM, key ${c.camelot || '?'}, energy ${num(c.energy, 0.5, 0, 1).toFixed(2)}, groove ${num(c.grooveScore, 0.5, 0, 1).toFixed(2)}, beat confidence ${num(c.bpmConfidence, 0.5, 0, 1).toFixed(2)}, phrase ${num(c.phraseConfidence, 0.4, 0, 1).toFixed(2)}, vocal density ${num(c.vocalDensity, 0.35, 0, 1).toFixed(2)}, mixability ${num(c.mixabilityScore, 0.5, 0, 1).toFixed(2)}.\n` +
    (played.length ? `Already played - NEVER repeat: ${played.slice(-16).join('; ')}.\n` : '') +
    (mem ? `SET MEMORY: ${mem}\n` : '') +
    'Pick the next REAL, in-scene song (harmonic + close tempo/pitch ride) that moves the energy arc. ' +
    'Do not propose slowed/reverb, acoustic, cover, karaoke, instrumental, lo-fi, type beat, interview, full album, or long DJ mix uploads unless the user explicitly requested that format.' +
    ' Assume the app preloads this deck early and will mix around the next 60-90 second performance window, not at the end of the full song.' +
    ' Return 3-5 ranked, real, findable candidates plus a performanceBrief for the DJ Artist. Do NOT include fader, loop, EQ, or transition automation.';
  const raw = await callTool(apiKey, PLANNER_MODEL, CRATE_SYSTEM, user, 'return_mix', MIX_SCHEMA, 1000);
  return normalizeMix(raw, { bpmTarget, genre: scene, played });
}

// Decide the transition from the REAL analyzed audio of BOTH tracks (BPM, key,
// energy, cue points, time-remaining) - grounded, not guessed. Run after the
// incoming track is fetched + analyzed.
export async function designTransition({ outgoing, incoming, setPhase, bpmTarget, memory = {} }, apiKey) {
  const o = outgoing || {};
  const n = incoming || {};
  const mem = memoryBrief(memory);
  const user =
    `Design the LIVE transition between two real, analyzed tracks. Current tempo lane ~${Math.round(Number(bpmTarget) || DEFAULT_BPM)} BPM; the engine may ramp tempo toward the incoming track during this transition. Phase: ${oneOf(setPhase, PHASES, 'build')}.\n` +
    `OUTGOING: "${str(o.title, '?')}" - ${Math.round(o.bpm || 0)} BPM, key ${str(o.camelot, '?')}, energy ${num(o.energy, 0.5, 0, 1).toFixed(2)}, groove ${num(o.grooveScore, 0.5, 0, 1).toFixed(2)}; ` +
    `phrase ${num(o.phraseConfidence, 0.4, 0, 1).toFixed(2)}, downbeat ${num(o.downbeatConfidence, 0.4, 0, 1).toFixed(2)}, vocal density ${num(o.vocalDensity, 0.35, 0, 1).toFixed(2)}, mixability ${num(o.mixabilityScore, 0.5, 0, 1).toFixed(2)}; ` +
    `about ${Math.round(num(o.secondsRemaining, 30, 0, 600))}s of outro left (mix-out ~${Math.round(num(o.mixOutSec, 0, 0, 6000))}s of ${Math.round(num(o.duration, 0, 0, 6000))}s). Exit windows: ${windowBrief(o.bestExitWindows)}.\n` +
    `INCOMING: "${str(n.title, '?')}" - ${Math.round(n.bpm || 0)} BPM, key ${str(n.camelot, '?')}, energy ${num(n.energy, 0.5, 0, 1).toFixed(2)}, groove ${num(n.grooveScore, 0.5, 0, 1).toFixed(2)}, beat confidence ${num(n.bpmConfidence, 0.5, 0, 1).toFixed(2)}, ` +
    `phrase ${num(n.phraseConfidence, 0.4, 0, 1).toFixed(2)}, downbeat ${num(n.downbeatConfidence, 0.4, 0, 1).toFixed(2)}, vocal density ${num(n.vocalDensity, 0.35, 0, 1).toFixed(2)}, mixability ${num(n.mixabilityScore, 0.5, 0, 1).toFixed(2)}; mixes in cleanly around ${Math.round(num(n.mixInSec, 0, 0, 6000))}s. Entry windows: ${windowBrief(n.bestEntryWindows)}.\n` +
    (n.performanceBrief ? `SET DIRECTOR BRIEF: ${str(n.performanceBrief, '')}\n` : '') +
    (mem ? `SET MEMORY: ${mem}\n` : '') +
    'Decide WHEN (lengthBars + startPolicy, phrase-aligned) and WHAT controller performance from the REAL compatibility. Return explicit gainAutomation for both decks. ' +
    'If the incoming track cannot be cleanly beatmatched to the current lane, use tempoAutomation.mode="reset" with targetBpm near the incoming track lane and choose a controlled echoOut/filterSweep bridge, not a normal blend and not a sudden hard cut unless secondsRemaining is critically low. ' +
    'Return eqAutomation/filterAutomation/effectsAutomation only when musically needed. Use loopAction.enabled=false unless a short phrase loop is clearly necessary; random loops are forbidden. ' +
    'Pick tempoAutomation mode and maxDeltaBpm from the track pair. Favor musical 8-16 bar bridges, staged bass/EQ handoff, and audible preparation before the drop. Fast impact moves should be justified and still phrase-clean. Keep it musical and clean.';
  const raw = await callTool(apiKey, PLANNER_MODEL, DJ_ARTIST_SYSTEM, user, 'return_transition', TRANSITION_SCHEMA, 1100);
  return normalizeTransition(raw);
}

export async function fallbackCommentary({ current, next, transition }, apiKey) {
  const user =
    `Say one concise DJ line for mixing from "${current?.title || 'this track'}" into "${next?.title || 'the next track'}" with ${transition?.type || 'blend'}.`;
  const raw = await callTool(apiKey, FAST_MODEL, DJ_ARTIST_SYSTEM, user, 'return_commentary', {
    type: 'object',
    additionalProperties: false,
    required: ['say'],
    properties: { say: { type: 'string' } },
  }, 120);
  return { say: str(raw.say, 'Locking in the next groove.') };
}

export function normalizePlan(raw = {}, defaults = {}) {
  const scene = str(defaults.scene, str(defaults.vibe, str(defaults.genre, 'open format')));
  const genre = str(raw.genre, str(defaults.genre, scene));
  const bpm = clampInt(raw.bpmTarget, 70, 180, defaults.bpmTarget || DEFAULT_BPM);
  const min = clampInt(raw.targetBpmRange?.min, 60, 180, Math.max(60, bpm - 4));
  const max = clampInt(raw.targetBpmRange?.max, 70, 200, Math.min(200, bpm + 4));
  // Last resort is a SEARCH for the user's own scene - never a hardcoded song.
  const openerQuery = cleanQuery(raw.opener?.query, `${scene} popular song`);
  const fallbackQueries = uniqueQueries([
    openerQuery,
    ...(Array.isArray(raw.opener?.fallbackQueries) ? raw.opener.fallbackQueries : []),
    `${scene} hit song`,
  ]).slice(0, 4);
  return {
    setName: str(raw.setName, 'NEXUS Live Session'),
    vibe: str(raw.vibe, defaults.vibe || scene),
    genre,
    bpmTarget: bpm,
    targetBpmRange: { min: Math.min(min, max), max: Math.max(min, max) },
    phases: normalizePhases(raw.phases),
    energyArc: str(raw.energyArc, raw.arc || 'warm up, build, peak, release'),
    arc: str(raw.energyArc, raw.arc || 'warm up, build, peak, release'),
    crateStrategy: str(raw.crateStrategy, 'Stay harmonic, keep BPM tight, and lift energy gradually.'),
    opener: {
      query: openerQuery,
      say: str(raw.opener?.say, 'Opening the room with a clean groove.'),
      fallbackQueries,
    },
  };
}

export function normalizeMix(raw = {}, defaults = {}) {
  const genre = str(defaults.genre, 'the set');
  const played = new Set((defaults.played || []).map(normalizeTrackKey));
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidateQueries = uniqueQueries([
    raw.selectedQuery,
    raw.query,
    ...rawCandidates.map((c) => c?.query),
  ]).filter((q) => !played.has(normalizeTrackKey(q))).slice(0, 5);
  // Last resort is a SEARCH for the scene - never a hardcoded song.
  const query = candidateQueries[0] || `${genre} popular song`;
  return {
    query,
    selectedQuery: query,
    genre,
    candidates: candidateQueries.map((q) => {
      const found = rawCandidates.find((c) => normalizeTrackKey(c?.query) === normalizeTrackKey(q));
      return {
        query: q,
        why: str(found?.why, raw.trackReason || 'Fits tempo, key, and energy arc.'),
        risk: str(found?.risk, 'Check fetch availability.'),
      };
    }),
    trackReason: str(raw.trackReason, 'Compatible tempo and harmonic direction, with a controlled energy move.'),
    energyTarget: num(raw.energyTarget, 0.65, 0, 1),
    performanceBrief: str(raw.performanceBrief, raw.trackReason || 'Give the DJ Artist a clean phrase-aligned handoff with energy control.'),
    say: str(raw.say, 'Digging the next record for the room.'),
  };
}

export function normalizeTransition(t = {}) {
  const rawType = oneOf(t.type, TRANSITION_TYPES, 'blend');
  const rawTempoMode = oneOf(t.tempoAutomation?.mode, TEMPO_MODES, rawType === 'cut' || rawType === 'echoOut' ? 'bridge' : 'nudge');
  const forcedResetBridge = rawTempoMode === 'reset' && rawType === 'cut';
  const type = forcedResetBridge ? 'echoOut' : rawType;
  const lengthBars = normalizeTransitionLength(t.lengthBars, type, rawTempoMode);
  const curve = oneOf(t.curve, CURVES, 'equalPower');
  const bassSwap = typeof t.bassSwap === 'boolean' ? t.bassSwap : type === 'bassSwap';
  const gainAutomation = normalizeGainAutomation(forcedResetBridge ? undefined : t.gainAutomation, type, curve);
  return {
    type,
    lengthBars,
    startPolicy: oneOf(t.startPolicy, START_POLICIES, 'outroPhrase'),
    curve,
    bassSwap,
    tempoAutomation: normalizeTempoAutomation(t.tempoAutomation, type),
    gainAutomation,
    eqAutomation: normalizeEqAutomation(t.eqAutomation, bassSwap, type),
    filterAutomation: normalizeFilterAutomation(forcedResetBridge ? undefined : t.filterAutomation, type),
    effectsAutomation: normalizeEffectsAutomation(forcedResetBridge ? undefined : t.effectsAutomation, type),
    loopAction: normalizeLoopAction(t.loopAction),
    commentary: str(t.commentary, 'Phrase is locked, swapping the low end now.'),
    fallback: {
      type: oneOf(t.fallback?.type, TRANSITION_TYPES, 'blend'),
      lengthBars: [4, 8, 16].includes(Number(t.fallback?.lengthBars)) ? Number(t.fallback.lengthBars) : 8,
      curve: oneOf(t.fallback?.curve, CURVES, 'linear'),
      bassSwap: typeof t.fallback?.bassSwap === 'boolean' ? t.fallback.bassSwap : true,
    },
  };
}

function normalizeTransitionLength(value, type, tempoMode) {
  const n = Number(value);
  if (type === 'cut') return [4, 8].includes(n) ? n : 4;
  if (tempoMode === 'reset') return [8, 16].includes(n) ? n : 16;
  return [4, 8, 16, 32].includes(n) ? n : 16;
}

function normalizePhases(phases) {
  const fallback = [
    { name: 'warmup', energy: 0.35, intent: 'Establish groove and tempo.' },
    { name: 'build', energy: 0.58, intent: 'Raise momentum with harmonic picks.' },
    { name: 'peak', energy: 0.86, intent: 'Deliver the biggest records.' },
    { name: 'release', energy: 0.5, intent: 'Ease down while staying musical.' },
  ];
  if (!Array.isArray(phases)) return fallback;
  const out = phases
    .map((p) => ({
      name: oneOf(p?.name, PHASES, 'build'),
      energy: num(p?.energy, 0.5, 0, 1),
      intent: str(p?.intent, 'Move the room deliberately.'),
    }))
    .slice(0, 5);
  return out.length >= 3 ? out : fallback;
}

function normalizeTempoAutomation(value, type) {
  const mode = oneOf(value?.mode, TEMPO_MODES, type === 'cut' || type === 'echoOut' ? 'bridge' : 'nudge');
  return {
    mode,
    targetBpm: Number.isFinite(Number(value?.targetBpm)) ? num(value.targetBpm, DEFAULT_BPM, 70, 180) : undefined,
    maxDeltaBpm: num(value?.maxDeltaBpm, mode === 'hold' ? 0 : mode === 'reset' ? 60 : type === 'cut' ? 8 : ['filterSweep', 'echoOut'].includes(type) ? 5 : 3, 0, mode === 'reset' ? 60 : 10),
    reason: str(value?.reason, 'Keep the tempo ride musical for the analyzed track pair.'),
  };
}

function normalizeGainAutomation(items, type, curve) {
  const fallback = defaultGainAutomation(type, curve);
  if (!Array.isArray(items) || items.length < 2) return fallback;
  const out = items.slice(0, 8).map((x) => normalizeMove(x, { from: 0, to: 1, lo: 0, hi: 1 }));
  const hasOut = out.some((x) => x.deck === 'out');
  const hasIn = out.some((x) => x.deck === 'in');
  return hasOut && hasIn ? out : fallback;
}

function normalizeEqAutomation(items, bassSwap, type) {
  const fallback = bassSwap
    ? [
        { deck: 'out', band: 'low', fromDb: 0, toDb: -28, start: 0.34, end: type === 'bassSwap' ? 0.58 : 0.66, shape: 'smooth' },
        { deck: 'in', band: 'low', fromDb: -28, toDb: 0, start: 0.34, end: type === 'bassSwap' ? 0.58 : 0.66, shape: 'smooth' },
      ]
    : [];
  if (!Array.isArray(items)) return fallback;
  return items.slice(0, 8).map((x) => ({
    deck: oneOf(x?.deck, ['out', 'in'], 'out'),
    band: oneOf(x?.band, EQ_BANDS, 'low'),
    fromDb: num(x?.fromDb, 0, -36, 6),
    toDb: num(x?.toDb, 0, -36, 6),
    start: num(x?.start ?? (Number(x?.at) - 0.22), 0.25, 0, 1),
    end: num(x?.end ?? x?.at, 0.55, 0, 1),
    shape: oneOf(x?.shape, AUTOMATION_SHAPES, 'smooth'),
  }));
}

function normalizeFilterAutomation(items, type) {
  if (!Array.isArray(items)) {
    if (type === 'filterSweep') {
      return [
        { deck: 'out', type: 'lowpass', fromHz: 22000, toHz: 420, start: 0.16, end: 0.88, shape: 'smooth' },
        { deck: 'in', type: 'highpass', fromHz: 900, toHz: 22, start: 0.16, end: 0.88, shape: 'smooth' },
      ];
    }
    if (type === 'echoOut') return [{ deck: 'out', type: 'lowpass', fromHz: 22000, toHz: 900, start: 0.42, end: 0.92, shape: 'smooth' }];
    return [];
  }
  return items.slice(0, 6).map((x) => ({
    deck: oneOf(x?.deck, ['out', 'in'], 'out'),
    type: oneOf(x?.type, FILTER_TYPES, 'lowpass'),
    fromHz: num(x?.fromHz, 22000, 20, 22000),
    toHz: num(x?.toHz, 900, 20, 22000),
    start: num(x?.start, 0.2, 0, 1),
    end: num(x?.end, 0.85, 0, 1),
    shape: oneOf(x?.shape, AUTOMATION_SHAPES, 'smooth'),
  }));
}

function normalizeEffectsAutomation(items, type) {
  if (!Array.isArray(items)) {
    if (type === 'echoOut') {
      return [
        { target: 'echoSend', deck: 'out', from: 0, to: 0.78, start: 0.24, end: 0.72, shape: 'smooth' },
        { target: 'delayFeedback', deck: 'master', from: 0.02, to: 0.5, start: 0.24, end: 0.72, shape: 'smooth' },
      ];
    }
    if (type === 'reverbWash') {
      return [
        { target: 'reverbSend', deck: 'out', from: 0, to: 0.85, start: 0.2, end: 0.8, shape: 'smooth' }
      ];
    }
    return [];
  }
  return items.slice(0, 6).map((x) => ({
    target: oneOf(x?.target, ['echoSend', 'delayFeedback', 'reverbSend'], 'echoSend'),
    deck: oneOf(x?.deck, ['out', 'in', 'master'], 'out'),
    from: num(x?.from, 0, 0, 1),
    to: num(x?.to, 0, 0, 1),
    start: num(x?.start, 0.2, 0, 1),
    end: num(x?.end, 0.8, 0, 1),
    shape: oneOf(x?.shape, AUTOMATION_SHAPES, 'smooth'),
  }));
}

function normalizeLoopAction(value) {
  const enabled = value?.enabled === true;
  return {
    enabled,
    deck: oneOf(value?.deck, ['out', 'in'], 'out'),
    lengthBeats: [1, 2, 4, 8, 16].includes(Number(value?.lengthBeats)) ? Number(value.lengthBeats) : 4,
    start: num(value?.start, 0.45, 0, 1),
    end: num(value?.end, 0.78, 0, 1),
    reason: str(value?.reason, enabled ? 'Short loop supports the transition.' : 'No loop needed.'),
  };
}

function defaultGainAutomation(type, curve) {
  if (type === 'cut') {
    const end = curve === 'sharp' ? 0.515 : 0.56;
    return [
      { deck: 'out', from: 1, to: 0, start: curve === 'sharp' ? 0.48 : 0.44, end, shape: curve === 'sharp' ? 'holdThenSnap' : 'sharp' },
      { deck: 'in', from: 0, to: 1, start: curve === 'sharp' ? 0.48 : 0.44, end, shape: curve === 'sharp' ? 'holdThenSnap' : 'sharp' },
    ];
  }
  if (type === 'echoOut') {
    return [
      { deck: 'out', from: 1, to: 0, start: 0.55, end: 1, shape: 'smooth' },
      { deck: 'in', from: 0, to: 1, start: 0.58, end: 0.72, shape: 'sharp' },
    ];
  }
  const sharp = curve === 'sharp';
  return [
    { deck: 'out', from: 1, to: 0, start: sharp ? 0.3 : 0, end: sharp ? 0.72 : 1, shape: curve === 'linear' ? 'linear' : 'smooth' },
    { deck: 'in', from: 0, to: 1, start: sharp ? 0.3 : 0, end: sharp ? 0.72 : 1, shape: curve === 'linear' ? 'linear' : 'smooth' },
  ];
}

function normalizeMove(x, { from, to, lo, hi }) {
  const start = num(x?.start, 0, 0, 1);
  const end = Math.max(start + 0.001, num(x?.end, 1, 0, 1));
  return {
    deck: oneOf(x?.deck, ['out', 'in'], 'out'),
    from: num(x?.from, from, lo, hi),
    to: num(x?.to, to, lo, hi),
    start,
    end: Math.min(1, end),
    shape: oneOf(x?.shape, AUTOMATION_SHAPES, 'smooth'),
  };
}

function uniqueQueries(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const q = cleanQuery(value, '');
    if (!q) continue;
    const key = normalizeTrackKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function cleanQuery(value, fb) {
  return str(value, fb).replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeTrackKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function memoryBrief(memory = {}) {
  const tracks = Array.isArray(memory.recentTracks) ? memory.recentTracks.slice(-6).map((s) => str(String(s), '').slice(0, 100)).filter(Boolean) : [];
  const moves = Array.isArray(memory.recentMoves) ? memory.recentMoves.slice(-4).map((s) => str(String(s), '').slice(0, 80)).filter(Boolean) : [];
  const parts = [];
  if (tracks.length) parts.push(`recent tracks: ${tracks.join(' | ')}`);
  if (moves.length) parts.push(`recent transition scores: ${moves.join(' | ')}`);
  if (Number(memory.lastTempoLane)) parts.push(`last tempo lane: ${Math.round(Number(memory.lastTempoLane))} BPM`);
  if (Number(memory.blockedMoves)) parts.push(`critic blocks so far: ${Math.round(Number(memory.blockedMoves))}`);
  return parts.join('; ');
}

function windowBrief(windows) {
  if (!Array.isArray(windows) || !windows.length) return 'none detected';
  return windows.slice(0, 3).map((w) => {
    const start = Math.round(num(w?.startSec, 0, 0, 6000));
    const end = Math.round(num(w?.endSec, start + 8, 0, 6000));
    const kind = str(w?.kind, 'window');
    const score = Math.round(num(w?.score, 0.5, 0, 1) * 100);
    return `${kind} ${start}-${end}s ${score}%`;
  }).join(', ');
}

function str(v, fb) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 240) : fb;
}

function oneOf(v, list, fb) {
  return list.includes(v) ? v : fb;
}

function num(v, fb, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
}

function clampInt(v, lo, hi, fb) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
}

const PERFORM_SCHEMA = {
  type: 'object',
  properties: {
    liveEvents: {
      type: 'array',
      description: 'List of performance events to execute during the track.',
      items: {
        type: 'object',
        properties: {
          beat: { type: 'number', description: 'The exact beat number to trigger the event (relative to the start of the track, 0-indexed).' },
          action: { type: 'string', enum: ['filterSweep', 'bassCut', 'stutterRoll', 'echoThrow', 'reverbWash', 'flangerSwoosh', 'pitchBend'], description: 'The DJ action to perform.' },
          durationBeats: { type: 'number', description: 'Duration of the effect in beats.' },
          targetHz: { type: 'number', description: 'For filterSweep, the target frequency (e.g. 4000).' }
        },
        required: ['beat', 'action', 'durationBeats']
      }
    }
  },
  required: ['liveEvents']
};

export async function generatePerformanceScript({ analysis, meta }, apiKey) {
  const bpm = analysis?.bpm || 120;
  const duration = analysis?.duration || 180;
  const totalBeats = Math.round(duration * (bpm / 60));
  
  const user = `Generate a live performance script for the track "${meta?.title || 'Unknown'}" by ${meta?.artist || 'Unknown'}.
  The track is ${Math.round(duration)} seconds long (~${totalBeats} beats) at ${Math.round(bpm)} BPM.
  Energy levels: ${Number(analysis?.energy).toFixed(2)}/1.0. 
  
  Add 3 to 6 live performance events (filterSweep, bassCut, stutterRoll, echoThrow, reverbWash, flangerSwoosh, pitchBend) that feel like a real human DJ playing with the music.
  Don't overdo it. Space them out. For buildups (e.g., around beat 64, 128, etc.), use filterSweep, flangerSwoosh, or pitchBend to build tension. Use reverbWash for epic spacey moments.
  Return the events as an array sorted by beat.`;

  const system = 'You are the NEXUS DJ Artist. You are actively performing this track live in the club. You ride the EQs and filters mid-song to hype the crowd without ruining the music.';

  try {
    const raw = await callTool(apiKey, PLANNER_MODEL, system, user, 'return_performance', PERFORM_SCHEMA, 800);
    if (!Array.isArray(raw?.liveEvents)) return [];
    
    return raw.liveEvents.map(e => ({
      beat: num(e.beat, 0, 0, totalBeats),
      action: oneOf(e.action, ['filterSweep', 'bassCut', 'stutterRoll', 'echoThrow', 'reverbWash', 'flangerSwoosh', 'pitchBend'], 'echoThrow'),
      durationBeats: num(e.durationBeats, 1, 0.25, 32),
      targetHz: num(e.targetHz, 4000, 20, 22000)
    })).sort((a, b) => a.beat - b.beat);
  } catch (err) {
    console.error('Performance script failed:', err);
    return [];
  }
}

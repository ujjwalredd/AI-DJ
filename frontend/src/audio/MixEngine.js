// Real-time DJ mix engine: two decks, key-locked time-stretch, 3-band EQ, a
// sweepable filter, an echo/delay send, and a crossfader. Every deck plays at the
// SET TEMPO (tempo = bpmTarget / trackBpm) so tracks are beatmatched by construction
// and key-locked (no pitch shift) when the SoundTouch worklet is available.
// Transitions are real DJ moves scheduled sample-accurately on the beat grid.
import { ensureSoundTouch, createStretchNode } from './timestretch.js';

const EPS = 0.0001;

function createReverbBuffer(ctx, duration = 3.0, decay = 3.0) {
  const length = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export function tempoRateFor(trackBpm, bpmTarget = 122) {
  const bpm = Math.max(1, Number(trackBpm) || Number(bpmTarget) || 122);
  const target = Math.max(70, Math.min(180, Number(bpmTarget) || 122));
  let rate = target / bpm;
  while (rate > 1.5) rate /= 2;
  while (rate < 0.6) rate *= 2;
  return Math.max(0.5, Math.min(2, rate));
}

export function nearestTempoLane(trackBpm, referenceBpm = 122) {
  const bpm = Math.max(1, Number(trackBpm) || Number(referenceBpm) || 122);
  const ref = Math.max(70, Math.min(180, Number(referenceBpm) || 122));
  const candidates = [bpm, bpm / 2, bpm * 2].filter((x) => x >= 60 && x <= 200);
  return candidates.reduce((best, value) => (Math.abs(value - ref) < Math.abs(best - ref) ? value : best), candidates[0] || bpm);
}

export function adaptiveTempoTarget(currentTarget, incomingBpm, recipeType = 'blend') {
  const current = Math.max(70, Math.min(180, Number(currentTarget) || 122));
  const lane = nearestTempoLane(incomingBpm, current);
  const maxMove = recipeType === 'cut'
    ? 8
    : ['filterSweep', 'echoOut'].includes(recipeType)
      ? 5
      : 3;
  const delta = Math.max(-maxMove, Math.min(maxMove, lane - current));
  return Math.round((current + delta) * 10) / 10;
}

export function dynamicTempoTarget(currentTarget, incomingBpm, recipe = {}) {
  const current = Math.max(70, Math.min(180, Number(currentTarget) || 122));
  const r = normalizeRecipe(recipe);
  const mode = r.tempoAutomation.mode;
  if (mode === 'hold') return current;
  const lane = Number.isFinite(r.tempoAutomation.targetBpm)
    ? r.tempoAutomation.targetBpm
    : nearestTempoLane(incomingBpm, current);
  if (mode === 'reset') return Math.round(Math.max(70, Math.min(180, lane)) * 10) / 10;
  const maxMove = Math.max(0, Math.min(10, Number(r.tempoAutomation.maxDeltaBpm) || 0));
  const delta = Math.max(-maxMove, Math.min(maxMove, lane - current));
  return Math.round((current + delta) * 10) / 10;
}

export function transitionStartGridBeats(recipe = {}) {
  const r = normalizeRecipe(recipe);
  if (r.tempoAutomation.mode === 'reset') return 16;
  if (r.startPolicy === 'cutOnOne' || r.type === 'cut') return 4;
  if (r.startPolicy === 'nowSafe') return 4;
  if (r.type === 'echoOut' || r.type === 'filterSweep') return 16;
  return 32;
}

export function recipeHandoffProgress(recipe = {}) {
  const r = normalizeRecipe(recipe);
  if (r.tempoAutomation.mode === 'reset') return 0.72;
  if (r.type === 'echoOut') return 0.72;
  if (r.type === 'cut') return 0.52;
  let best = 0.55;
  let bestGap = Infinity;
  for (let i = 1; i < 99; i++) {
    const p = i / 100;
    const out = mixFrame(r, p, 'out').gain;
    const inn = mixFrame(r, p, 'in').gain;
    const gap = Math.abs(out - inn);
    if (inn >= out && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

export function livePerformanceFrame(analysis = {}, position = 0, phase = 'build', levels = {}) {
  const duration = Math.max(1, Number(analysis.duration) || 1);
  const beatPeriod = Number(analysis.beatPeriod) > 0
    ? Number(analysis.beatPeriod)
    : Number(analysis.bpm) > 0
      ? 60 / Number(analysis.bpm)
      : 0.5;
  const firstBeat = Number(analysis.firstBeatSec) || 0;
  const beat = Math.max(0, (Number(position) - firstBeat) / beatPeriod);
  const bar = Math.floor(beat / 4);
  const phraseBars = Math.max(4, Number(analysis.phraseBars) || 16);
  const phrase16 = ((bar % phraseBars) + (beat % 4) / 4) / phraseBars; // 0..1 over one real phrase
  const phrase32 = ((bar % (phraseBars * 2)) + (beat % 4) / 4) / (phraseBars * 2); // over a double phrase
  const drop = Number(analysis.dropSec) || 0;
  const dropConf = clamp01(Number(analysis.dropConfidence) || 0);
  const beforeDrop = drop > 0 && dropConf > 0.25 && position < drop && position >= drop - beatPeriod * 8;
  const mixIn = Math.max(0, Number(analysis.mixInSec) || 0);
  const introEnd = Math.max(mixIn, Number(analysis.introEndSec) || mixIn + beatPeriod * 16);
  const mixOut = Math.max(introEnd, Number(analysis.mixOutSec) || duration * 0.72);
  const energy = clamp01(Number(analysis.energy) || 0);
  const groove = clamp01(Number(analysis.grooveScore) || 0);
  const bass = clamp01(Number(levels.bass) || 0);
  const treble = clamp01(Number(levels.treble) || 0);
  const phaseBoost = phase === 'peak' || phase === 'finale' ? 1 : phase === 'build' ? 0.72 : phase === 'warmup' ? 0.42 : 0.35;
  
  const intro = position < introEnd;
  const outro = position > Math.max(introEnd, mixOut - beatPeriod * 32);
  const breakdown = !intro && !outro && energy < 0.18 && bass < 0.16;
  const buildup = !intro && !outro && energy >= 0.18 && bass < 0.25; // Quiet bass but high energy = buildup/riser
  
  const phraseLift = smoothstep(edgeProgress(phrase32, 0.55, 0.92));
  const phraseReset = smoothstep(edgeProgress(phrase32, 0.92, 1));
  const barPump = Math.sin((beat % 4) * Math.PI * 0.5);
  const grooveLift = groove * phaseBoost;

  let low = lerp(-2.5, 1.8, grooveLift) + barPump * 0.35 * groove;
  let mid = -0.4 + phraseLift * 0.9 * phaseBoost;
  let high = lerp(0.25, 1.65, phaseBoost) * (0.45 + groove * 0.55) + phraseLift * 0.8;
  let filterHz = 22000;
  let filterType = 'lowpass';
  let echoSend = 0;
  let delayFeedback = 0;
  let delayBeats = 0.75;
  let technique = 'groove ride';
  let pitchSemitones = 0;
  let reverbSend = 0;

  if (intro) {
    const introProgress = clamp01((position - mixIn) / Math.max(beatPeriod * 16, introEnd - mixIn));
    low = lerp(-4.5, Math.max(-1, low), introProgress);
    high += lerp(0.8, 0, introProgress);
    filterHz = expLerp(9500, 22000, introProgress);
    technique = 'intro build';
  } else if (beforeDrop) {
    // Tasteful 2-bar riser into the detected drop: open a highpass, lift highs, dip lows.
    const riseP = clamp01((position - (drop - beatPeriod * 8)) / (beatPeriod * 8));
    filterType = 'highpass';
    filterHz = expLerp(60, 1300, riseP);
    high += 1.2 * riseP;
    low -= 2.2 * riseP;
    technique = 'drop riser';
  } else if (breakdown) {
    low = -5.5;
    mid = -1.2;
    high = 1.3 + phraseLift * 1.2;
    filterHz = expLerp(7800, 18500, phraseLift);
    technique = 'breakdown hold';
  } else if (outro) {
    const outProgress = clamp01((position - (mixOut - beatPeriod * 32)) / (beatPeriod * 32));
    low = lerp(low, -4.8, outProgress);
    mid = lerp(mid, -1.6, outProgress);
    high = lerp(high, 1.4, 1 - outProgress * 0.4);
    filterHz = expLerp(22000, 14000, outProgress * 0.5);
    technique = 'outro prep';
  } else if (phase === 'peak' || phase === 'finale') {
    low += 0.8 * (1 - phraseReset);
    high += 0.8 * phraseLift;
    mid += treble > 0.65 ? -0.7 : 0.25;
    technique = 'peak drive';
  }

  // Deterministic phrase "floor": always work the track a little across each phrase
  // (gentle filter open + high lift) so it never sounds like flat playback, even before
  // the AI performance script lands. Tasteful only - groove regions, no overrides.
  const inGroove = !intro && !outro && !breakdown && !beforeDrop;
  if (inGroove && filterType === 'lowpass' && filterHz >= 21999) {
    filterHz = expLerp(15500, 22000, smoothstep(phrase16));
    high += 0.55 * phraseLift;
    if (technique === 'groove ride') technique = 'phrase ride';
  }

  if (bass > 0.74) low -= 1.2;
  if (treble > 0.72) high -= 0.85;

  // Apply AI injected live events
  const aiEvent = analysis.liveEvents?.find(e => beat >= e.beat && beat < e.beat + e.durationBeats);
  if (aiEvent) {
    const eProgress = (beat - aiEvent.beat) / Math.max(0.1, aiEvent.durationBeats);
    technique = `AI: ${aiEvent.action}`;
    
    if (aiEvent.action === 'filterSweep') {
      filterType = 'highpass';
      filterHz = expLerp(20, aiEvent.targetHz || 4500, eProgress);
    } else if (aiEvent.action === 'bassCut') {
      low = -36;
    } else if (aiEvent.action === 'stutterRoll') {
      echoSend = 1;
      delayFeedback = 0.85;
      delayBeats = aiEvent.durationBeats;
      low = -36;
    } else if (aiEvent.action === 'echoThrow') {
      echoSend = 0.5;
      delayFeedback = 0.6;
      delayBeats = 0.75;
    } else if (aiEvent.action === 'reverbWash') {
      reverbSend = 0.7;
    } else if (aiEvent.action === 'flangerSwoosh') {
      echoSend = 0.6;
      delayFeedback = 0.8;
      delayBeats = 0.02 + Math.sin(eProgress * Math.PI * 2) * 0.08; // LFO style short delay creates flanging
    } else if (aiEvent.action === 'pitchBend') {
      pitchSemitones = -12 * eProgress; // Drop pitch by up to an octave
    }
  }

  // Only apply conservative clamping to natural/auto parameters, leave AI FX alone if they are extreme.
  const isBassCut = aiEvent?.action === 'bassCut' || aiEvent?.action === 'stutterRoll';
  const isReverbWash = aiEvent?.action === 'reverbWash';

  return {
    low: isBassCut ? low : Math.max(-7, Math.min(3, low)),
    mid: Math.max(-5, Math.min(3, mid)),
    high: Math.max(-5, Math.min(3, high)),
    filterHz: Math.max(20, Math.min(22000, filterHz)),
    filterType,
    echoSend: Math.max(0, Math.min(1.0, echoSend)),
    delayFeedback: Math.max(0, Math.min(0.95, delayFeedback)),
    reverbSend: isReverbWash ? reverbSend : 0,
    pitchSemitones,
    delayBeats,
    technique,
  };
}

export function mixFrame(recipe = {}, progress = 0, role = 'out') {
  const r = normalizeRecipe(recipe);
  const p = clamp01(progress);
  const incoming = role === 'in';
  const x = gainMoveProgress(r, p);
  const eq = { low: 0, mid: 0, high: 0 };
  let gain = automationValue(r.gainAutomation.filter((m) => m.deck === role), p, incoming ? x.in : x.out, { lo: 0, hi: 1 });
  let filterHz = 22000;
  let echoSend = 0;
  let delayFeedback = 0;
  let reverbSend = 0;

  const hasLowMove = r.eqAutomation.some((m) => m.deck === role && m.band === 'low');
  if ((r.bassSwap || r.type === 'bassSwap') && !hasLowMove) {
    const swap = smoothstep(edgeProgress(p, 0.34, r.type === 'bassSwap' ? 0.58 : 0.66));
    eq.low = incoming ? lerp(-28, 0, swap) : lerp(0, -28, swap);
  }

  const filterMoves = r.filterAutomation.filter((m) => m.deck === role);
  if (filterMoves.length) {
    filterHz = automationValue(filterMoves.map((m) => ({ ...m, from: m.fromHz, to: m.toHz })), p, filterHz, { lo: 20, hi: 22000, exponential: true });
  } else if (r.type === 'filterSweep') {
    const sweep = smoothstep(edgeProgress(p, 0.16, 0.88));
    filterHz = incoming ? expLerp(900, 22, sweep) : expLerp(22000, 420, sweep);
    if (incoming) eq.mid = lerp(-4, 0, smoothstep(edgeProgress(p, 0.25, 0.62)));
  }

  if (r.type === 'echoOut' && !incoming) {
    const throwAmt = smoothstep(edgeProgress(p, 0.24, 0.72));
    const clear = smoothstep(edgeProgress(p, 0.7, 1));
    echoSend = lerp(0, 0.82, throwAmt) * (1 - clear * 0.35);
    delayFeedback = lerp(0.04, 0.56, throwAmt) * (1 - clear * 0.55);
    filterHz = expLerp(22000, 900, smoothstep(edgeProgress(p, 0.42, 0.92)));
  }

  for (const move of r.eqAutomation || []) {
    if (move.deck !== role || !['low', 'mid', 'high'].includes(move.band)) continue;
    eq[move.band] = automationValue([{ ...move, from: move.fromDb, to: move.toDb }], p, eq[move.band], { lo: -36, hi: 6 });
  }

  echoSend = automationValue(
    r.effectsAutomation.filter((m) => m.target === 'echoSend' && m.deck === role),
    p,
    echoSend,
    { lo: 0, hi: 1 },
  );
  reverbSend = automationValue(
    r.effectsAutomation.filter((m) => m.target === 'reverbSend' && m.deck === role),
    p,
    reverbSend,
    { lo: 0, hi: 1 },
  );
  delayFeedback = automationValue(
    r.effectsAutomation.filter((m) => m.target === 'delayFeedback' && (m.deck === role || m.deck === 'master')),
    p,
    delayFeedback,
    { lo: 0, hi: 0.92 },
  );

  return { gain: clamp01(gain), ...eq, filterHz, echoSend, delayFeedback, reverbSend };
}

export function scheduleParamValue(param, value, at) {
  const time = finiteTime(at);
  param.cancelScheduledValues?.(time);
  param.setValueAtTime(finiteNumber(value, 0), time);
}

export function scheduleParamRamp(param, from, to, at, duration) {
  const time = finiteTime(at);
  const dur = finiteDuration(duration);
  param.cancelScheduledValues?.(time);
  param.setValueAtTime(finiteNumber(from, 0), time);
  param.linearRampToValueAtTime(finiteNumber(to, 0), time + dur);
}

export function scheduleParamCurve(param, values, at, duration) {
  const time = finiteTime(at);
  const dur = finiteDuration(duration);
  const arr = Float32Array.from(values || [], (v) => finiteNumber(v, 0));
  if (arr.length < 2) {
    scheduleParamValue(param, arr[0] || 0, time);
    return;
  }
  param.cancelScheduledValues?.(time);
  param.setValueCurveAtTime(arr, time, dur);
}

export class MixEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.95;
    // Master glue/limiter: catches overlap peaks when two decks play, soft knee = no pump.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 30;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.25;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    // Shared echo/delay (used by the echoOut transition).
    this.delay = this.ctx.createDelay(2.0);
    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.master);

    // Shared Reverb Wash
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = createReverbBuffer(this.ctx);
    this.reverb.connect(this.master);

    this.bpmTarget = 122;
    this.beatLen = 60 / 122;
    this.stretchReady = false;
    this.decks = { A: this._makeDeck('A'), B: this._makeDeck('B') };
    this.active = 'A';
    this.transitionState = null;
  }

  async resume() {
    await this.ctx.resume();
    try { this.stretchReady = await ensureSoundTouch(this.ctx); }
    catch { this.stretchReady = false; }
    return this.stretchReady;
  }

  setTempo(bpm) {
    this.bpmTarget = Math.max(70, Math.min(180, Number(bpm) || 122));
    this.beatLen = 60 / this.bpmTarget;
  }
  setTempoFrom(analysis) { if (analysis?.bpm) this.setTempo(Math.round(analysis.bpm)); }

  _makeDeck(name) {
    // Trim sits at the head of the deck so loud/quiet tracks are level-matched before EQ/faders.
    const trim = this.ctx.createGain(); trim.gain.value = 1;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 22000; filter.Q.value = 0.7;
    const low = this.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
    const mid = this.ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;
    const high = this.ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3500;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    const echoSend = this.ctx.createGain(); echoSend.gain.value = 0;
    const reverbSend = this.ctx.createGain(); reverbSend.gain.value = 0;
    trim.connect(filter);
    filter.connect(low); low.connect(mid); mid.connect(high);
    high.connect(gain); gain.connect(this.master);
    high.connect(echoSend); echoSend.connect(this.delay);
    high.connect(reverbSend); reverbSend.connect(this.reverb);
    return { name, state: 'idle', trim, filter, low, mid, high, gain, echoSend, reverbSend, source: null, stretch: null, analysis: null, meta: null, startCtx: 0, offset: 0, rate: 1, live: null };
  }

  // Effective playback rate = set tempo / track tempo, folding half/double so far-off
  // tempos still lock (e.g. 90 BPM rap under a 124 house set via double-time).
  _rate(analysis) {
    return tempoRateFor(analysis?.bpm, this.bpmTarget);
  }
  previewRate(analysis) { return this._rate(analysis); }
  previewTempoMove(analysis, recipe = {}) {
    return this._tempoMove(analysis, normalizeRecipe(recipe));
  }

  _tempoMove(analysis, recipe = {}) {
    const fromBpm = this.bpmTarget;
    const toBpm = dynamicTempoTarget(fromBpm, analysis?.bpm || fromBpm, recipe);
    const out = this.decks[this.active];
    return {
      fromBpm,
      toBpm,
      deltaBpm: Math.round((toBpm - fromBpm) * 10) / 10,
      outRateFrom: out?.rate || 1,
      outRateTo: tempoRateFor(out?.analysis?.bpm || fromBpm, toBpm),
      inRateTo: tempoRateFor(analysis?.bpm || toBpm, toBpm),
      mode: recipe?.tempoAutomation?.mode || 'nudge',
    };
  }

  _wireSource(deck, buffer, rate, at) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, at);
    const head = deck.trim || deck.filter;
    if (this.stretchReady) {
      const stretch = createStretchNode(this.ctx);
      stretch.playbackRate.setValueAtTime(rate, at); // key-lock: compensate pitch for tempo
      try { stretch.pitchSemitones.setValueAtTime(0, at); } catch { /* optional param */ }
      src.connect(stretch);
      stretch.connect(head);
      deck.stretch = stretch;
    } else {
      src.connect(head);
      deck.stretch = null;
    }
    deck.source = src;
  }

  _stopSource(deck, at) {
    if (deck.source) { try { deck.source.stop(at); } catch { /* already stopped */ } deck.source = null; }
    if (deck.stretch) { try { deck.stretch.disconnect(); } catch { /* ok */ } deck.stretch = null; }
  }

  load(name, analysis, meta) {
    const deck = this.decks[name];
    this._stopSource(deck, this.ctx.currentTime);
    deck.analysis = analysis; deck.meta = meta; deck.rate = this._rate(analysis); deck.state = 'loaded'; deck.live = null;
    const t = this.ctx.currentTime;
    this._wireSource(deck, analysis.buffer, deck.rate, t);
    // Gain staging: level-match this track to the shared target before EQ/faders.
    if (deck.trim) scheduleParamValue(deck.trim.gain, Math.max(0.4, Math.min(2.4, Number(analysis.gainTrim) || 1)), t);
    deck.filter.frequency.cancelScheduledValues(t); deck.filter.type = 'lowpass'; scheduleParamValue(deck.filter.frequency, 22000, t);
    scheduleParamValue(deck.low.gain, 0, t); scheduleParamValue(deck.mid.gain, 0, t); scheduleParamValue(deck.high.gain, 0, t);
    scheduleParamValue(deck.gain.gain, 0, t); scheduleParamValue(deck.echoSend.gain, 0, t); scheduleParamValue(deck.reverbSend.gain, 0, t);
  }

  startSet(analysis, meta, options = {}) {
    if (!options.keepTempo) this.setTempoFrom(analysis);
    this.active = 'A';
    this.transitionState = null;
    this.load('A', analysis, meta);
    const at = this.ctx.currentTime + 0.15;
    const offset = analysis.mixInSec ?? analysis.firstBeatSec ?? 0;
    this._start('A', at, Math.max(0, offset), 1);
  }

  _start(name, at, offset, gain = 1) {
    const deck = this.decks[name];
    deck.gain.gain.setValueAtTime(gain, at);
    deck.source.start(at, Math.max(0, offset));
    deck.startCtx = at; deck.offset = offset; deck.state = 'playing'; deck.live = null;
  }

  position(name) {
    const deck = this.decks[name];
    if (!deck.source || deck.state === 'idle' || deck.state === 'loaded') return 0;
    return Math.max(0, (this.ctx.currentTime - deck.startCtx) * deck.rate + deck.offset);
  }

  activeInfo() {
    this._refreshTransition();
    const deck = this.decks[this.active];
    if (!deck.analysis) return null;
    return { name: this.active, meta: deck.meta, analysis: deck.analysis, position: this.position(this.active), bpm: this.bpmTarget };
  }

  performLive(phase = 'build') {
    this._refreshTransition();
    if (this.transitionState) return null;
    const deck = this.decks[this.active];
    if (!deck?.source || !deck.analysis || deck.state !== 'playing') return null;
    const now = this.ctx.currentTime;
    const levels = { bass: this.bass(), treble: this.treble() };
    const frame = livePerformanceFrame(deck.analysis, this.position(this.active), phase, levels);
    this._scheduleLiveFrame(deck, frame, now);
    deck.live = frame;
    return { deck: this.active, ...frame };
  }

  _scheduleLiveFrame(deck, frame, now) {
    const ramp = 0.22;
    this._rampIfChanged(deck.low.gain, deck.live?.low ?? deck.low.gain.value, frame.low, now, ramp, 0.12);
    this._rampIfChanged(deck.mid.gain, deck.live?.mid ?? deck.mid.gain.value, frame.mid, now, ramp, 0.12);
    this._rampIfChanged(deck.high.gain, deck.live?.high ?? deck.high.gain.value, frame.high, now, ramp, 0.12);
    deck.filter.type = frame.filterType || 'lowpass';
    this._rampIfChanged(deck.filter.frequency, deck.live?.filterHz ?? deck.filter.frequency.value, frame.filterHz, now, ramp, 40);
    this._rampIfChanged(deck.echoSend.gain, deck.live?.echoSend ?? deck.echoSend.gain.value, frame.echoSend, now, ramp, 0.006);
    this._rampIfChanged(this.delayFb.gain, deck.live?.delayFeedback ?? this.delayFb.gain.value, frame.delayFeedback, now, ramp, 0.006);
    this._rampIfChanged(deck.reverbSend.gain, deck.live?.reverbSend ?? deck.reverbSend.gain.value, frame.reverbSend || 0, now, ramp, 0.006);
    if (deck.stretch) {
      this._rampIfChanged(deck.stretch.pitchSemitones, deck.live?.pitchSemitones ?? 0, frame.pitchSemitones || 0, now, ramp, 0.1);
    }
    if (frame.echoSend > 0.001) {
      const beats = frame.delayBeats || 0.75;
      scheduleParamValue(this.delay.delayTime, (this.beatLen * beats) / Math.max(EPS, deck.rate), now);
    }

    deck.live = {
      low: frame.low,
      mid: frame.mid,
      high: frame.high,
      filterHz: frame.filterHz,
      echoSend: frame.echoSend,
      delayFeedback: frame.delayFeedback,
      reverbSend: frame.reverbSend || 0,
      pitchSemitones: frame.pitchSemitones || 0,
    };
    return frame.technique;
  }

  _rampIfChanged(param, from, to, now, duration, threshold) {
    if (Math.abs((Number(from) || 0) - (Number(to) || 0)) < threshold) return;
    scheduleParamRamp(param, from, to, now, duration);
  }

  _firstBeatCtx(deck) {
    return deck.startCtx + ((deck.analysis?.firstBeatSec || 0) - deck.offset) / Math.max(EPS, deck.rate);
  }

  _transitionStartCtx(name, recipe) {
    const deck = this.decks[name];
    const phraseBeats = transitionStartGridBeats(recipe);
    const firstBeatCtx = this._firstBeatCtx(deck);
    const now = this.ctx.currentTime;
    const pos = this.position(name);
    const mixOut = deck.analysis?.mixOutSec ?? deck.analysis?.outroStartSec ?? (deck.analysis?.duration || 0) - 40;
    const secsToMixOut = Math.max(0, (mixOut - pos) / Math.max(EPS, deck.rate));
    const earliest = now + Math.min(secsToMixOut, this.beatLen * 8) + 0.2;
    const beatIndex = Math.ceil((earliest - firstBeatCtx) / this.beatLen);
    const phraseIndex = Math.ceil(Math.max(0, beatIndex) / phraseBeats) * phraseBeats;
    let at = firstBeatCtx + phraseIndex * this.beatLen;
    if (recipe.startPolicy === 'cutOnOne') at = firstBeatCtx + Math.ceil(Math.max(0, beatIndex) / 4) * 4 * this.beatLen;
    return Math.max(now + 0.2, at);
  }

  /**
   * Schedule a real DJ transition into `analysis`. The engine owns the choreography
   * per recipe.type so the move always runs; the agent only chooses type/length/curve.
   */
  mixInto(analysis, meta, recipe = {}) {
    this._refreshTransition();
    if (this.transitionState) return this.transitionState;
    const r = normalizeRecipe(recipe);
    const outName = this.active;
    const inName = outName === 'A' ? 'B' : 'A';
    const out = this.decks[outName];
    const tempo = this._tempoMove(analysis, r);
    this.load(inName, analysis, meta);
    const inn = this.decks[inName];

    const start = this._transitionStartCtx(outName, r);
    const lengthBars = r.type === 'cut' ? Math.max(4, Math.min(8, r.lengthBars)) : Math.max(4, r.lengthBars);
    const dur = lengthBars * 4 * this.beatLen;
    const end = start + dur;
    const inOffset = this._incomingOffset(analysis, r, dur);

    // Start incoming phrase-aligned so its drop lands on the downbeat.
    inn.source.start(start, inOffset);
    inn.startCtx = start; inn.offset = inOffset; inn.state = 'mixing';
    out.state = 'mixing';

    this._choreographTempo(out, inn, tempo, start, dur);
    this._choreograph(out, inn, r, start, dur);

    try { out.source.stop(end + 0.12); } catch { /* ok */ }
    this.transitionState = {
      outName, inName, start, end, handoff: start + dur * recipeHandoffProgress(r),
      recipe: r, tempo, incomingMeta: meta, outgoingMeta: out.meta, status: 'scheduled',
    };
    return this.transitionState;
  }

  // Phrase-align the incoming entry; when a confident drop exists, offset it so the
  // drop lands on the outgoing phrase boundary (the handoff) - classic "drop on the one".
  _incomingOffset(analysis = {}, recipe = {}, dur = 0) {
    const base = Math.max(0, analysis.mixInSec ?? analysis.introEndSec ?? analysis.firstBeatSec ?? 0);
    const firstBeat = Number(analysis.firstBeatSec) || 0;
    const beat = 60 / (Number(analysis.bpm) || this.bpmTarget || 122);
    const phraseSec = Math.max(beat * 4, (Number(analysis.phraseBars) || 16) * 4 * beat);
    const snapPhrase = (sec) => Math.max(0, firstBeat + Math.max(0, Math.round((sec - firstBeat) / phraseSec)) * phraseSec);
    const drop = Number(analysis.dropSec) || 0;
    const conf = Number(analysis.dropConfidence) || 0;
    if (drop > 0 && conf > 0.25 && dur > 0) {
      const inRate = tempoRateFor(analysis.bpm, this.bpmTarget) || 1;
      const handoffElapsed = dur * recipeHandoffProgress(recipe) * inRate; // track-time used by handoff
      const want = drop - handoffElapsed;
      if (want >= 0 && want < drop) return snapPhrase(want);
    }
    return snapPhrase(base);
  }

  _choreographTempo(out, inn, tempo, at, dur) {
    const outFrom = out.rate || 1;
    const outTo = tempo.outRateTo;
    const inFrom = inn.rate || 1;
    const inTo = tempo.inRateTo;
    if (tempo.mode === 'reset') {
      scheduleParamValue(out.source.playbackRate, outFrom, at);
      scheduleParamValue(inn.source.playbackRate, inTo, at);
      if (out.stretch?.playbackRate) scheduleParamValue(out.stretch.playbackRate, outFrom, at);
      if (inn.stretch?.playbackRate) scheduleParamValue(inn.stretch.playbackRate, inTo, at);
      return;
    }
    scheduleParamRamp(out.source.playbackRate, outFrom, outTo, at, dur);
    scheduleParamRamp(inn.source.playbackRate, inFrom, inTo, at, dur);
    if (out.stretch?.playbackRate) scheduleParamRamp(out.stretch.playbackRate, outFrom, outTo, at, dur);
    if (inn.stretch?.playbackRate) scheduleParamRamp(inn.stretch.playbackRate, inFrom, inTo, at, dur);
  }

  // Per-type real DJ choreography on the two decks' params.
  _choreograph(out, inn, r, at, dur) {
    const curve = (role, prop) => automationCurve((p) => mixFrame(r, p, role)[prop]);
    scheduleParamCurve(out.gain.gain, curve('out', 'gain'), at, dur);
    scheduleParamCurve(inn.gain.gain, curve('in', 'gain'), at, dur);

    for (const band of ['low', 'mid', 'high']) {
      scheduleParamCurve(out[band].gain, curve('out', band), at, dur);
      scheduleParamCurve(inn[band].gain, curve('in', band), at, dur);
    }

    const outFilterType = filterTypeFor(r, 'out');
    const inFilterType = filterTypeFor(r, 'in');
    if (outFilterType || inFilterType || r.type === 'filterSweep') {
      out.filter.type = outFilterType || 'lowpass';
      inn.filter.type = inFilterType || 'highpass';
      scheduleParamCurve(out.filter.frequency, curve('out', 'filterHz'), at, dur);
      scheduleParamCurve(inn.filter.frequency, curve('in', 'filterHz'), at, dur);
    } else if (r.type === 'echoOut' || outFilterType) {
      out.filter.type = outFilterType || 'lowpass';
      scheduleParamCurve(out.filter.frequency, curve('out', 'filterHz'), at, dur);
    }

    if (r.loopAction?.enabled) this._applyLoopAction(r.loopAction, out, inn, at, dur);

    if (r.type === 'vinylBrake') {
      if (out.stretch) {
        try { out.stretch.disconnect(); out.source.disconnect(); out.source.connect(out.filter); } catch { /* ignore */ }
        out.stretch = null;
      }
      scheduleParamRamp(out.source.playbackRate, out.rate, 0.001, at, dur);
      scheduleParamRamp(out.gain.gain, 1, 0, at + dur * 0.8, dur * 0.2);
    }

    if (r.type === 'echoOut' || r.effectsAutomation.length) {
      scheduleParamValue(this.delay.delayTime, (this.beatLen * 0.75) / Math.max(EPS, out.rate), at);
      scheduleParamCurve(out.echoSend.gain, curve('out', 'echoSend'), at, dur);
      scheduleParamCurve(inn.echoSend.gain, curve('in', 'echoSend'), at, dur);
      scheduleParamCurve(this.delayFb.gain, curve('out', 'delayFeedback'), at, dur);
      scheduleParamCurve(out.reverbSend.gain, curve('out', 'reverbSend'), at, dur);
      scheduleParamCurve(inn.reverbSend.gain, curve('in', 'reverbSend'), at, dur);
    } else {
      scheduleParamValue(out.echoSend.gain, 0, at);
      scheduleParamValue(inn.echoSend.gain, 0, at);
      scheduleParamValue(this.delayFb.gain, 0, at);
      scheduleParamValue(out.reverbSend.gain, 0, at);
      scheduleParamValue(inn.reverbSend.gain, 0, at);
    }
  }

  _applyLoopAction(action, out, inn, at, dur) {
    const deck = action.deck === 'in' ? inn : out;
    if (!deck?.source?.buffer) return;
    const atProgress = clamp01(action.start);
    const loopAtCtx = at + dur * atProgress;
    const loopStart = Math.max(0, deck.offset + (loopAtCtx - deck.startCtx) * Math.max(EPS, deck.rate));
    const beatSec = 60 / Math.max(1, deck.analysis?.bpm || this.bpmTarget);
    const loopEnd = Math.min(deck.source.buffer.duration, Math.max(loopStart + 0.1, loopStart + action.lengthBeats * beatSec));
    if (loopEnd <= loopStart + 0.05) return;
    deck.source.loop = true;
    deck.source.loopStart = loopStart;
    deck.source.loopEnd = loopEnd;
  }

  _refreshTransition() {
    const t = this.transitionState;
    if (!t) return;
    const now = this.ctx.currentTime;
    if (now >= t.start && t.status === 'scheduled') t.status = 'mixing';
    if (now >= t.handoff && this.active !== t.inName) {
      this.active = t.inName;
      this.decks[t.inName].state = 'playing';
      this.decks[t.outName].state = 'ending';
    }
    if (now >= t.end) {
      const out = this.decks[t.outName]; const inn = this.decks[t.inName];
      if (t.tempo?.toBpm) this.setTempo(t.tempo.toBpm);
      this._stopSource(out, now);
      // reset echo + reverb + filter on the freed deck
      scheduleParamValue(out.echoSend.gain, 0, now); scheduleParamValue(this.delayFb.gain, 0, now);
      scheduleParamValue(out.reverbSend.gain, 0, now);
      out.filter.type = 'lowpass'; scheduleParamValue(out.filter.frequency, 22000, now);
      out.state = 'idle'; out.analysis = null; out.meta = null; out.live = null;
      scheduleParamValue(out.gain.gain, 0, now);
      scheduleParamValue(out.low.gain, 0, now); scheduleParamValue(out.mid.gain, 0, now); scheduleParamValue(out.high.gain, 0, now);
      inn.state = 'playing';
      inn.rate = t.tempo?.inRateTo || inn.rate;
      inn.live = null;
      scheduleParamValue(inn.gain.gain, 1, now);
      scheduleParamValue(inn.low.gain, 0, now); scheduleParamValue(inn.mid.gain, 0, now); scheduleParamValue(inn.high.gain, 0, now);
      scheduleParamValue(inn.echoSend.gain, 0, now);
      scheduleParamValue(inn.reverbSend.gain, 0, now);
      inn.filter.type = 'lowpass'; scheduleParamValue(inn.filter.frequency, 22000, now);
      this.transitionState = null;
    }
  }

  transitionInfo() {
    this._refreshTransition();
    const t = this.transitionState;
    if (!t) return null;
    const progress = clamp01((this.ctx.currentTime - t.start) / Math.max(EPS, t.end - t.start));
    return { ...t, progress, secondsRemaining: Math.max(0, t.end - this.ctx.currentTime) };
  }

  deckState(name) {
    this._refreshTransition();
    const d = this.decks[name];
    const auto = this._computedAutomation(name, d);
    return {
      name, state: d.state, meta: d.meta, analysis: d.analysis, active: this.active === name,
      gain: auto.gain, low: auto.low, mid: auto.mid, high: auto.high,
      filterHz: auto.filterHz, rate: this._computedDeckRate(name, d),
      position: d.source ? this.position(name) : 0,
      spinning: ['playing', 'cueing', 'mixing', 'ending'].includes(d.state),
    };
  }

  _computedAutomation(name, deck) {
    const base = {
      gain: deck.gain.gain.value,
      low: deck.live?.low ?? deck.low.gain.value,
      mid: deck.live?.mid ?? deck.mid.gain.value,
      high: deck.live?.high ?? deck.high.gain.value,
      filterHz: deck.live?.filterHz ?? deck.filter.frequency.value,
    };
    const t = this.transitionState;
    if (!t || (name !== t.outName && name !== t.inName)) return base;
    const progress = clamp01((this.ctx.currentTime - t.start) / Math.max(EPS, t.end - t.start));
    const role = name === t.inName ? 'in' : 'out';
    const frame = mixFrame(t.recipe || {}, progress, role);
    return { ...base, ...frame };
  }

  _computedDeckRate(name, deck) {
    const t = this.transitionState;
    if (!t?.tempo || (name !== t.outName && name !== t.inName)) return deck.rate;
    if (t.tempo.mode === 'reset') return name === t.inName ? t.tempo.inRateTo : t.tempo.outRateFrom;
    const progress = clamp01((this.ctx.currentTime - t.start) / Math.max(EPS, t.end - t.start));
    if (name === t.outName) return lerp(t.tempo.outRateFrom, t.tempo.outRateTo, progress);
    return lerp(deck.rate, t.tempo.inRateTo, progress);
  }

  levels() { this.analyser.getByteFrequencyData(this.freq); return this.freq; }
  bass() {
    this.analyser.getByteFrequencyData(this.freq);
    const bins = Math.max(1, Math.floor(this.freq.length * 0.1));
    let s = 0; for (let i = 0; i < bins; i++) s += this.freq[i];
    return s / (bins * 255);
  }
  mid() {
    this.analyser.getByteFrequencyData(this.freq);
    const start = Math.max(1, Math.floor(this.freq.length * 0.1));
    const end = Math.floor(this.freq.length * 0.55);
    let s = 0; for (let i = start; i < end; i++) s += this.freq[i];
    return s / (Math.max(1, end - start) * 255);
  }
  treble() {
    this.analyser.getByteFrequencyData(this.freq);
    const start = Math.floor(this.freq.length * 0.55);
    let s = 0; for (let i = start; i < this.freq.length; i++) s += this.freq[i];
    return s / (Math.max(1, this.freq.length - start) * 255);
  }

  dispose() {
    for (const d of Object.values(this.decks)) this._stopSource(d, this.ctx.currentTime);
    try { this.ctx.close(); } catch { /* ok */ }
  }
}

export function normalizeRecipe(recipe = {}) {
  const type = ['blend', 'bassSwap', 'filterSweep', 'cut', 'echoOut'].includes(recipe.type) ? recipe.type : 'blend';
  const curve = ['equalPower', 'linear', 'sharp'].includes(recipe.curve) ? recipe.curve : 'equalPower';
  const bassSwap = typeof recipe.bassSwap === 'boolean' ? recipe.bassSwap : type === 'bassSwap';
  return {
    type,
    lengthBars: [2, 4, 8, 16, 32].includes(Number(recipe.lengthBars)) ? Number(recipe.lengthBars) : 16,
    startPolicy: ['nextPhrase', 'outroPhrase', 'nowSafe', 'cutOnOne'].includes(recipe.startPolicy) ? recipe.startPolicy : 'outroPhrase',
    curve,
    bassSwap,
    tempoAutomation: normalizeTempoAutomation(recipe.tempoAutomation, type),
    gainAutomation: normalizeGainAutomation(recipe.gainAutomation, type, curve),
    eqAutomation: normalizeEqAutomation(recipe.eqAutomation),
    filterAutomation: normalizeFilterAutomation(recipe.filterAutomation),
    effectsAutomation: normalizeEffectsAutomation(recipe.effectsAutomation),
    loopAction: normalizeLoopAction(recipe.loopAction),
    stages: Array.isArray(recipe.stages) ? recipe.stages.slice(0, 6).map((s) => String(s).slice(0, 80)) : [],
    criticNotes: Array.isArray(recipe.criticNotes) ? recipe.criticNotes.slice(0, 6).map((s) => String(s).slice(0, 120)) : [],
    fallback: recipe.fallback || { type: 'blend', lengthBars: 8, curve: 'linear', bassSwap: true },
  };
}

export function transitionMs(recipe, bpmTarget = 122) {
  const r = normalizeRecipe(recipe);
  return (r.lengthBars * 4 * 60 * 1000) / Math.max(1, bpmTarget);
}

function normalizeTempoAutomation(value, type) {
  const mode = ['hold', 'nudge', 'bridge', 'reset'].includes(value?.mode)
    ? value.mode
    : type === 'cut' || type === 'echoOut'
      ? 'bridge'
      : 'nudge';
  const target = Number(value?.targetBpm);
  return {
    mode,
    targetBpm: Number.isFinite(target) ? Math.max(70, Math.min(180, target)) : undefined,
    maxDeltaBpm: Math.max(0, Math.min(mode === 'reset' ? 60 : 10, finiteNumber(value?.maxDeltaBpm, mode === 'hold' ? 0 : mode === 'reset' ? 60 : type === 'cut' ? 8 : ['filterSweep', 'echoOut'].includes(type) ? 5 : 3))),
  };
}

function normalizeGainAutomation(items, type, curve) {
  const fallback = defaultGainAutomation(type, curve);
  if (!Array.isArray(items) || items.length < 2) return fallback;
  const out = items.slice(0, 8).map((m) => normalizeMove(m, 0, 1, 0, 1));
  return out.some((m) => m.deck === 'out') && out.some((m) => m.deck === 'in') ? out : fallback;
}

function normalizeEqAutomation(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 10).map((m) => ({
    ...normalizeMove({ ...m, from: m.fromDb, to: m.toDb }, 0, 0, -36, 6),
    band: ['low', 'mid', 'high'].includes(m?.band) ? m.band : 'low',
    fromDb: Math.max(-36, Math.min(6, finiteNumber(m?.fromDb, 0))),
    toDb: Math.max(-36, Math.min(6, finiteNumber(m?.toDb, 0))),
  }));
}

function normalizeFilterAutomation(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 6).map((m) => ({
    ...normalizeMove({ ...m, from: m.fromHz, to: m.toHz }, 22000, 900, 20, 22000),
    type: ['lowpass', 'highpass'].includes(m?.type) ? m.type : 'lowpass',
    fromHz: Math.max(20, Math.min(22000, finiteNumber(m?.fromHz, 22000))),
    toHz: Math.max(20, Math.min(22000, finiteNumber(m?.toHz, 900))),
  }));
}

function normalizeEffectsAutomation(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 6).map((m) => ({
    ...normalizeMove(m, 0, 0, 0, 1),
    target: ['echoSend', 'delayFeedback'].includes(m?.target) ? m.target : 'echoSend',
    deck: ['out', 'in', 'master'].includes(m?.deck) ? m.deck : 'out',
  }));
}

function normalizeLoopAction(value) {
  return {
    enabled: value?.enabled === true,
    deck: ['out', 'in'].includes(value?.deck) ? value.deck : 'out',
    lengthBeats: [1, 2, 4, 8, 16].includes(Number(value?.lengthBeats)) ? Number(value.lengthBeats) : 4,
    start: clamp01(finiteNumber(value?.start, 0.45)),
    end: clamp01(finiteNumber(value?.end, 0.78)),
  };
}

function normalizeMove(m, fromDefault, toDefault, lo, hi) {
  const start = clamp01(finiteNumber(m?.start, 0));
  const end = Math.min(1, Math.max(start + 0.001, clamp01(finiteNumber(m?.end, 1))));
  return {
    deck: ['out', 'in'].includes(m?.deck) ? m.deck : 'out',
    from: Math.max(lo, Math.min(hi, finiteNumber(m?.from, fromDefault))),
    to: Math.max(lo, Math.min(hi, finiteNumber(m?.to, toDefault))),
    start,
    end,
    shape: ['linear', 'smooth', 'sharp', 'holdThenSnap'].includes(m?.shape) ? m.shape : 'smooth',
  };
}

function defaultGainAutomation(type, curve) {
  if (type === 'cut') {
    const start = curve === 'sharp' ? 0.48 : 0.44;
    const end = curve === 'sharp' ? 0.515 : 0.56;
    return [
      { deck: 'out', from: 1, to: 0, start, end, shape: curve === 'sharp' ? 'holdThenSnap' : 'sharp' },
      { deck: 'in', from: 0, to: 1, start, end, shape: curve === 'sharp' ? 'holdThenSnap' : 'sharp' },
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

function automationValue(moves, progress, fallback, options = {}) {
  const sorted = [...(moves || [])].sort((a, b) => a.start - b.start);
  let value = sorted.length ? finiteNumber(sorted[0].from, fallback) : fallback;
  for (const move of sorted) {
    if (progress < move.start) continue;
    if (progress > move.end) {
      value = finiteNumber(move.to, value);
      continue;
    }
    const t = shapedProgress(edgeProgress(progress, move.start, move.end), move.shape);
    value = options.exponential ? expLerp(move.from, move.to, t) : lerp(move.from, move.to, t);
  }
  const lo = finiteNumber(options.lo, -Infinity);
  const hi = finiteNumber(options.hi, Infinity);
  return Math.max(lo, Math.min(hi, finiteNumber(value, fallback)));
}

function shapedProgress(x, shape = 'smooth') {
  if (shape === 'linear') return clamp01(x);
  if (shape === 'sharp') return Math.pow(clamp01(x), 0.55);
  if (shape === 'holdThenSnap') return smoothstep(edgeProgress(clamp01(x), 0.72, 1));
  return smoothstep(x);
}

function filterTypeFor(recipe, role) {
  const move = recipe.filterAutomation.find((m) => m.deck === role);
  if (move?.type) return move.type;
  if (recipe.type === 'filterSweep') return role === 'in' ? 'highpass' : 'lowpass';
  if (recipe.type === 'echoOut' && role === 'out') return 'lowpass';
  return null;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const smoothstep = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const edgeProgress = (x, start, end) => (clamp01(x) - start) / Math.max(EPS, end - start);
const expLerp = (a, b, t) => Math.exp(lerp(Math.log(Math.max(EPS, a)), Math.log(Math.max(EPS, b)), t));
const finiteNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const finiteTime = (value) => Math.max(0, finiteNumber(value, 0));
const finiteDuration = (value) => Math.max(0.001, finiteNumber(value, 0.001));

function gainMoveProgress(recipe, p) {
  const r = normalizeRecipe(recipe);
  if (r.type === 'cut') {
    const snap = r.curve === 'sharp' ? edgeProgress(p, 0.48, 0.515) : edgeProgress(p, 0.44, 0.56);
    const x = smoothstep(snap);
    return { out: 1 - x, in: x };
  }
  if (r.type === 'echoOut') {
    const drop = smoothstep(edgeProgress(p, 0.55, 0.75));
    const clear = smoothstep(edgeProgress(p, 0.83, 1));
    const hit = smoothstep(edgeProgress(p, 0.58, 0.72));
    return { out: Math.max(0, (1 - drop * 0.72) * (1 - clear)), in: hit };
  }
  if (r.type === 'filterSweep') {
    const x = smoothstep(edgeProgress(p, r.curve === 'sharp' ? 0.28 : 0.18, 0.9));
    return { out: Math.cos(x * Math.PI / 2), in: Math.sin(x * Math.PI / 2) };
  }
  if (r.curve === 'linear') return { out: 1 - p, in: p };
  if (r.curve === 'sharp') {
    const x = smoothstep(edgeProgress(p, 0.3, 0.72));
    return { out: 1 - x, in: x };
  }
  return { out: Math.cos(p * Math.PI / 2), in: Math.sin(p * Math.PI / 2) };
}

function automationCurve(fn, samples = 72) {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = finiteNumber(fn(i / (samples - 1)), 0);
  return out;
}

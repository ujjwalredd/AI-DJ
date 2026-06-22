import { useRef } from 'react';
import { postJSON } from '../api.js';
import { keyHeader } from '../config/apiKey.js';
import { analyzeTrack } from '../audio/analysis.js';
import { MixEngine, nearestTempoLane, tempoRateFor } from '../audio/MixEngine.js';
import { useDJ } from '../store.js';

const PREP_LEAD = 16;           // seconds before mix-out to force the next handoff
const EARLY_PREFETCH_DELAY = 4; // seconds after mix-in before the AI starts digging the next record
const MIN_PERFORMANCE_WINDOW = 24;
const MAX_PERFORMANCE_WINDOW = 58;
const PHASES = ['warmup', 'build', 'build', 'peak', 'peak', 'release', 'finale'];
const BAD_UPLOAD_TERMS = [
  /\bslowed\b/i,
  /\breverb(?:ed)?\b/i,
  /\bsped\s*up\b/i,
  /\bnightcore\b/i,
  /\blo-?fi\b/i,
  /\bacoustic\b/i,
  /\bpiano\s+(?:cover|version)\b/i,
  /\bkaraoke\b/i,
  /\binstrumental\b/i,
  /\bcover\b/i,
  /\b8d\s+audio\b/i,
];
const ALT_UPLOAD_ALLOWED = /\b(sl(?:ow|owed)|reverb|acoustic|cover|karaoke|instrumental|lo-?fi|chill|ambient|sleep|study|piano)\b/i;
const DEFAULT_PHASE_ENERGY = { warmup: 0.4, build: 0.62, peak: 0.86, release: 0.55, finale: 0.74 };
const clamp01u = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// Arc-driven phase: follow the planned phase curve when present, else the default ramp.
const phaseFor = (n, plan = null) => {
  const phases = Array.isArray(plan) ? plan : Array.isArray(plan?.phases) ? plan.phases : null;
  if (phases && phases.length) {
    const name = phases[Math.min(Math.max(0, n), phases.length - 1)]?.name;
    if (name) return String(name).toLowerCase();
  }
  return PHASES[n] || ['build', 'peak', 'peak', 'release'][n % 4];
};

// Target energy at this point of the set, from the planned curve (with a sensible fallback).
export function arcTargetEnergy(n, plan = null) {
  const phases = Array.isArray(plan) ? plan : Array.isArray(plan?.phases) ? plan.phases : null;
  if (phases && phases.length) {
    const p = phases[Math.min(Math.max(0, n), phases.length - 1)];
    const e = Number(p?.targetEnergy ?? p?.energy);
    if (Number.isFinite(e)) return clamp01u(e);
  }
  return DEFAULT_PHASE_ENERGY[phaseFor(n, plan)] ?? 0.6;
}

// One-line lookahead instruction for the Selector: should the next track rise/hold/dip?
export function arcLookahead(n, plan = null) {
  const now = arcTargetEnergy(n, plan);
  const next = arcTargetEnergy(n + 1, plan);
  const delta = next - now;
  const dir = delta > 0.06 ? 'rise' : delta < -0.06 ? 'dip' : 'hold';
  return { now: round2(now), next: round2(next), direction: dir };
}

// How far BPM may drift from the running set lane before it breaks the flow.
export function laneWindowFor(phase = 'build') {
  if (/reset|finale/.test(phase)) return 22;
  if (/warmup|release/.test(phase)) return 12;
  return 8; // build/peak: keep a tight lane
}

export function nextMixTriggerSec(analysis = {}) {
  const mixIn = Math.max(0, Number(analysis.mixInSec) || 0);
  const duration = Math.max(0, Number(analysis.duration) || 0);
  const explicitMixOut = Number(analysis.mixOutSec);
  const outroStart = Number(analysis.outroStartSec);
  const mixOut = Number.isFinite(explicitMixOut)
    ? explicitMixOut
    : Number.isFinite(outroStart)
      ? outroStart
      : Math.max(mixIn, duration - 30);
  const safeOutroLead = Math.max(mixIn, mixOut - PREP_LEAD);
  const performanceWindow = mixIn + livePerformanceWindowSec(analysis);
  return Math.min(performanceWindow, safeOutroLead);
}

export function livePerformanceWindowSec(analysis = {}) {
  const beatPeriod = Number(analysis.beatPeriod) > 0
    ? Number(analysis.beatPeriod)
    : Number(analysis.bpm) > 0
      ? 60 / Number(analysis.bpm)
      : 0.5;
  const groove = Number(analysis.grooveScore) || 0;
  const energy = Number(analysis.energy) || 0;
  const duration = Math.max(0, Number(analysis.duration) || 0);
  const bars = duration && duration < 135
    ? 8
    : groove > 0.55 || energy > 0.5
      ? 16
      : 32;
  const phraseSec = bars * 4 * beatPeriod;
  return Math.max(MIN_PERFORMANCE_WINDOW, Math.min(MAX_PERFORMANCE_WINDOW, phraseSec));
}

export function shouldPrepareNextMix(info) {
  if (!info?.analysis) return false;
  const position = Number(info.position) || 0;
  return position >= nextMixTriggerSec(info.analysis);
}

export function nextPreloadTriggerSec(analysis = {}) {
  const mixIn = Math.max(0, Number(analysis.mixInSec) || 0);
  const mixTrigger = nextMixTriggerSec(analysis);
  // Start digging the next record a few seconds after mix-in (never past the mix point).
  return Math.max(mixIn, Math.min(mixIn + EARLY_PREFETCH_DELAY, mixTrigger));
}

export function shouldPreloadNextMix(info) {
  if (!info?.analysis) return false;
  const position = Number(info.position) || 0;
  return position >= nextPreloadTriggerSec(info.analysis);
}

export function trackSuitability(result, options = {}) {
  const meta = result?.meta || {};
  const analysis = result?.analysis || {};
  const genre = String(options.genre || '');
  const vibe = String(options.vibe || '');
  const phase = String(options.phase || 'build');
  const requestText = `${genre} ${vibe}`;
  const titleText = `${meta.title || ''} ${meta.artist || ''} ${meta.query || ''}`;
  const allowAltUpload = ALT_UPLOAD_ALLOWED.test(requestText);
  if (!allowAltUpload) {
    const bad = BAD_UPLOAD_TERMS.find((pattern) => pattern.test(titleText));
    if (bad) return { ok: false, reason: 'rejected altered/low-DJ-value upload' };
  }

  const clubIntent = !ALT_UPLOAD_ALLOWED.test(requestText);
  const highEnergyPhase = ['build', 'peak', 'finale'].includes(phase);
  const groove = Number(analysis.grooveScore) || 0;
  const density = Number(analysis.onsetDensity) || 0;
  const confidence = Number(analysis.bpmConfidence) || 0;
  const energy = Number(analysis.energy) || 0;
  const minGroove = highEnergyPhase ? 0.34 : clubIntent ? 0.27 : 0.16;

  const rate = Number(options.rate) || 1;
  const rateDistance = Math.abs(1 - rate);
  const resetRate = Number(options.resetRate) || rate;
  const canResetTempo = options.allowTempoReset && resetRate >= 0.84 && resetRate <= 1.16 && (energy >= 0.12 || groove >= 0.38);
  if (options.preferMixable && (rate < 0.84 || rate > 1.16) && !canResetTempo) {
    return { ok: false, reason: `tempo ride too wide (${Math.round(rate * 100)}%)` };
  }

  if (clubIntent && confidence < 0.035 && groove < 0.42) {
    return { ok: false, reason: 'weak beatgrid confidence for live mixing' };
  }
  if (clubIntent && groove < minGroove) {
    return { ok: false, reason: `weak groove score (${groove.toFixed(2)})` };
  }
  if (clubIntent && energy < 0.08 && density < 0.035) {
    return { ok: false, reason: 'too low-energy for this set lane' };
  }
  // Tempo-lane discipline: keep BPM (half/double aware) near the running set lane.
  // BPM detection is octave-noisy, so when a reset bridge is allowed we only block
  // truly absurd jumps; everything else rides in via a tempo reset (never a stall).
  const laneBpm = Number(options.laneBpm) || 0;
  if (clubIntent && laneBpm > 0 && !/reset|finale/.test(phase)) {
    const laneAdjusted = nearestTempoLane(Number(analysis.bpm) || laneBpm, laneBpm);
    const drift = Math.abs(laneAdjusted - laneBpm);
    const window = Number(options.laneWindow) || laneWindowFor(phase);
    const hardLimit = options.allowTempoReset ? Math.max(60, laneBpm * 0.5) : window;
    if (drift > hardLimit) {
      return { ok: false, reason: `out of set lane (${Math.round(laneAdjusted)} vs ${Math.round(laneBpm)} BPM)` };
    }
    if (drift > window && options.allowTempoReset) {
      return { ok: true, reason: `tempo reset bridge into lane (${Math.round(laneAdjusted)} -> ${Math.round(laneBpm)} BPM)` };
    }
  }
  if (options.preferMixable && rateDistance > 0.1 && groove < 0.52 && !canResetTempo) {
    return { ok: false, reason: `wide tempo ride needs stronger groove (${Math.round(rate * 100)}%)` };
  }
  if (canResetTempo && rateDistance > 0.16) return { ok: true, reason: `tempo reset bridge (${Math.round(rate * 100)}% -> ${Math.round(resetRate * 100)}%)` };
  return { ok: true, reason: 'mixable' };
}

export function useDJController() {
  const engineRef = useRef(null);
  const timer = useRef(null);
  const preparing = useRef(false);
  const pendingNext = useRef(null);
  const played = useRef([]);
  const stopped = useRef(false);
  const scheduled = useRef(null);
  const liveRide = useRef({ at: 0, technique: '' });
  const memory = useRef(createDJMemory());

  async function fetchTrack(query) {
    const track = await postJSON('/api/dj/track', { query });
    const analysis = await analyzeTrack(engineRef.current.ctx, track.audioUrl);
    const meta = {
      id: track.id,
      query,
      title: track.title,
      artist: track.artist,
      camelot: analysis.camelot,
      keyConfidence: analysis.keyConfidence,
      bpm: Math.round(analysis.bpm),
      bpmConfidence: analysis.bpmConfidence,
      phraseConfidence: analysis.phraseConfidence,
      mixabilityScore: analysis.mixabilityScore,
      vocalDensity: analysis.vocalDensity,
      duration: analysis.duration,
    };
    return { analysis, meta, track };
  }

  async function fetchFirstAvailable(queries, label, options = {}) {
    const errors = [];
    let fallback = null;
    for (const query of uniqueQueries(queries)) {
      try {
        const result = await fetchTrack(query);
        const tempoMove = engineRef.current?.previewTempoMove?.(result.analysis, options.recipe) || null;
        const rate = tempoMove?.inRateTo ?? engineRef.current?.previewRate?.(result.analysis) ?? 1;
        const resetBpm = nearestTempoLane(result.analysis?.bpm, engineRef.current?.bpmTarget || result.analysis?.bpm);
        const resetRate = tempoRateFor(result.analysis?.bpm, resetBpm);
        const suitability = trackSuitability(result, { ...options, rate, resetRate, resetBpm, tempoMove });
        if (!suitability.ok) {
          fallback ||= result;
          errors.push(`${query}: ${suitability.reason}`);
          useDJ.getState().pushFeed(`${label} rejected: ${result.meta.title || query} - ${suitability.reason}. Trying another crate pick.`, 'warn');
          played.current.push(query);
          continue;
        }
        if (suitability.reason !== 'mixable') {
          useDJ.getState().pushFeed(`${label} accepted: ${result.meta.title || query} needs ${suitability.reason}. DJ Artist will reset/bridge it.`, 'info');
        }
        return result;
      } catch (err) {
        errors.push(`${query}: ${err.message || 'failed'}`);
        useDJ.getState().pushFeed(`${label} unavailable: ${query}`, 'warn');
        played.current.push(query);
      }
    }
    if (fallback) useDJ.getState().pushFeed(`No safe ${label} found in this candidate batch. Asking the agent for a better crate pick next.`, 'warn');
    throw new Error(errors.at(-1) || `No ${label} track could be fetched.`);
  }

  function triggerPerformanceScript(analysis, meta) {
    if (!analysis || !meta) return;
    postJSON('/api/dj/perform', { analysis, meta }, keyHeader())
      .then(res => {
        if (!stopped.current && Array.isArray(res.liveEvents)) {
          analysis.liveEvents = res.liveEvents;
          useDJ.getState().pushFeed(`AI scripted ${res.liveEvents.length} live performance actions for ${meta.title}`, 'info');
        }
      })
      .catch(err => console.error('Performance script failed', err));
  }

  async function start({ vibe, genre = 'Open format', bpmTarget }) {
    stopped.current = false;
    preparing.current = false;
    pendingNext.current = null;
    scheduled.current = null;
    liveRide.current = { at: 0, technique: '' };
    played.current = [];
    memory.current = createDJMemory();
    const store = useDJ.getState();
    store.reset();
    store.setView('dj');
    store.setPhase('loading');

    try {
      const engine = new MixEngine();
      engineRef.current = engine;
      store.setEngine(engine);
      await engine.resume();

      store.setStatus('Planning the set...');
      const plan = await postJSON('/api/dj/plan', { vibe, genre, bpmTarget }, keyHeader());
      store.setPlan(plan);
      engine.setTempo(plan.bpmTarget);
      store.pushFeed(plan.opener.say, 'plan');
      store.pushFeed(`${plan.genre || genre} crate: real YouTube songs, no long DJ mixes.`, 'info');
      store.pushFeed(plan.crateStrategy, 'info');

      store.setStatus('Loading the opener...');
      const openerQueries = [plan.opener.query, ...(plan.opener.fallbackQueries || [])];
      const { analysis, meta } = await fetchFirstAvailable(openerQueries, 'opener', {
        preferMixable: true,
        allowTempoReset: true,
        role: 'opener',
        genre: plan.genre || genre,
        vibe: plan.vibe || vibe,
        phase: 'warmup',
      });
      if (stopped.current) return;
      const openerLane = nearestTempoLane(analysis.bpm, plan.bpmTarget || analysis.bpm);
      engine.setTempo(openerLane);
      const openerMove = engine.previewTempoMove(analysis, { type: 'blend', tempoAutomation: { mode: 'hold', maxDeltaBpm: 0, targetBpm: openerLane } });
      engine.startSet(analysis, meta, { keepTempo: true });
      useDJ.setState({ bpmTarget: engine.bpmTarget });
      played.current.push(meta.query || plan.opener.query);
      rememberTrack(memory.current, meta, analysis, 'opener');
      store.setNowPlaying(meta);
      triggerPerformanceScript(analysis, meta);
      store.pushFeed(tempoMoveLine('Opener tempo ride', meta, { ...openerMove, toBpm: engine.bpmTarget, inRateTo: engine.previewRate(analysis) }), 'info');
      store.setStatus('AI is listening and digging the next record...');
      store.setPhase('playing');
      timer.current = setInterval(monitor, 250);
    } catch (err) {
      store.setError(err.message || 'The DJ could not start.');
      stop();
    }
  }

  async function monitor() {
    const engine = engineRef.current;
    if (!engine || stopped.current) return;

    const transition = engine.transitionInfo();
    if (transition) {
      handleTransitionProgress(transition);
      return;
    }
    if (scheduled.current?.committed) {
      finishScheduledMix(scheduled.current);
      scheduled.current = null;
      useDJ.getState().setTransition(null);
    }

    const info = engine.activeInfo();
    if (!info) return;
    const store = useDJ.getState();
    const setPhase = phaseFor(store.trackCount, store.phases);
    const live = engine.performLive(setPhase);
    if (live) maybeReportLiveRide(live, info);

    if (pendingNext.current && shouldPrepareNextMix(info)) {
      if (preparing.current) return;
      preparing.current = true;
      try {
        await schedulePendingNext(info);
      } catch (err) {
        useDJ.getState().pushFeed(`Recovery: ${(err.message || 'mix schedule failed').slice(0, 90)}`, 'error');
        pendingNext.current = null;
      } finally {
        preparing.current = false;
      }
      return;
    }

    if (preparing.current || pendingNext.current) return;

    if (shouldPreloadNextMix(info)) {
      preparing.current = true;
      try {
        pendingNext.current = await preloadNext(info);
        const latest = engine.activeInfo();
        if (latest && shouldPrepareNextMix(latest) && !stopped.current) {
          await schedulePendingNext(latest);
        }
      } catch (err) {
        useDJ.getState().pushFeed(`Recovery: ${(err.message || 'next deck failed').slice(0, 90)}`, 'error');
      } finally {
        preparing.current = false;
      }
      return;
    }

    if (shouldPrepareNextMix(info)) {
      preparing.current = true;
      try {
        pendingNext.current = await preloadNext(info);
        if (!stopped.current) await schedulePendingNext(engine.activeInfo() || info);
      } catch (err) {
        useDJ.getState().pushFeed(`Recovery: ${(err.message || 'mix failed').slice(0, 90)}`, 'error');
      } finally {
        preparing.current = false;
      }
    }
  }

  function handleTransitionProgress(transition) {
    const store = useDJ.getState();
    store.setTransition({
      progress: transition.progress,
      secondsRemaining: transition.secondsRemaining,
      recipe: transition.recipe,
      tempo: transition.tempo,
      outName: transition.outName,
      inName: transition.inName,
    });
    if (scheduled.current && !scheduled.current.committed && transition.progress >= transitionHandoffRatio(transition)) {
      scheduled.current.committed = true;
      if (transition.tempo?.toBpm) useDJ.setState({ bpmTarget: transition.tempo.toBpm });
      store.setNowPlaying(scheduled.current.meta);
      store.setUpNext(null);
      store.pushFeed(scheduled.current.summary, 'info');
      triggerPerformanceScript(scheduled.current.analysis, scheduled.current.meta);
    }
  }

  async function preloadNext(info) {
    const store = useDJ.getState();
    const current = {
      title: info.meta?.title,
      artist: info.meta?.artist,
      bpm: Math.round(info.analysis.bpm),
      camelot: info.analysis.camelot,
      energy: info.analysis.energy,
      grooveScore: info.analysis.grooveScore,
      bpmConfidence: info.analysis.bpmConfidence,
      phraseConfidence: info.analysis.phraseConfidence,
      mixabilityScore: info.analysis.mixabilityScore,
      vocalDensity: info.analysis.vocalDensity,
    };
    const setPhase = phaseFor(store.trackCount, store.phases);
    const laneBpm = Math.round(memory.current?.lastTempoLane || store.bpmTarget || 122);
    const lookahead = arcLookahead(store.trackCount, store.phases);
    store.setStatus('Selecting the next record...');
    store.pushFeed(`Set arc: ${setPhase} · energy target ${lookahead.now}→${lookahead.next} (${lookahead.direction}) · lane ${laneBpm} BPM.`, 'info');
    const mix = await postJSON('/api/dj/next', {
      current,
      setPhase,
      bpmTarget: store.bpmTarget,
      laneBpm,
      laneWindow: laneWindowFor(setPhase),
      arcTarget: lookahead.next,
      arcDirection: lookahead.direction,
      genre: store.genre,
      played: played.current,
      memory: memoryBrief(memory.current),
    }, keyHeader());
    if (stopped.current) return;

    const candidateQueries = [mix.query, mix.selectedQuery, ...(mix.candidates || []).map((c) => c.query)];
    store.setUpNext({ query: mix.query, reason: mix.trackReason });
    store.pushFeed(mix.say, 'mix');
    store.pushFeed(mix.trackReason, 'info');
    if (mix.performanceBrief) store.pushFeed(`Set Director -> DJ Artist: ${mix.performanceBrief}`, 'info');
    store.setStatus('Fetching and analyzing the next deck...');

    const { analysis, meta } = await fetchFirstAvailable(candidateQueries, 'next pick', {
      preferMixable: true,
      genre: store.genre,
      vibe: store.vibe,
      phase: setPhase,
      laneBpm,
      laneWindow: laneWindowFor(setPhase),
      allowTempoReset: true,
    });
    if (stopped.current) return;

    const currentInfo = engineRef.current.activeInfo() || info;
    const recipe = await designLiveRecipe(currentInfo, analysis, meta, mix, setPhase);
    const tempoMove = engineRef.current.previewTempoMove(analysis, recipe);

    store.setUpNext({ ...meta, reason: mix.trackReason });
    store.setStatus('Next deck armed. Waiting for the mix window.');
    store.pushFeed(tempoMoveLine('Next deck tempo ride', meta, tempoMove), 'info');

    return { mix, analysis, meta, recipe, tempoMove, setPhase, trackReason: mix.trackReason };
  }

  async function designLiveRecipe(info, analysis, meta, mix, setPhase) {
    const store = useDJ.getState();
    const current = {
      title: info.meta?.title,
      bpm: Math.round(info.analysis.bpm),
      camelot: info.analysis.camelot,
      energy: info.analysis.energy,
    };
    const rate = engineRef.current.decks[info.name]?.rate || 1;
    const secondsLeft = Math.max(0, (info.analysis.duration - info.position) / Math.max(0.001, rate));

    // Ground the transition in BOTH tracks' REAL analyzed audio (key/tempo/energy/cues).
    let recipe = safetyRecipe(info.analysis, analysis, secondsLeft);
    if (secondsLeft >= 12) {
      try {
        recipe = await postJSON('/api/dj/transition', {
          outgoing: {
            title: info.meta?.title, bpm: Math.round(info.analysis.bpm), camelot: info.analysis.camelot,
            energy: info.analysis.energy, grooveScore: info.analysis.grooveScore, duration: info.analysis.duration, mixOutSec: info.analysis.mixOutSec,
            secondsRemaining: secondsLeft, bpmConfidence: info.analysis.bpmConfidence,
            phraseConfidence: info.analysis.phraseConfidence, downbeatConfidence: info.analysis.downbeatConfidence,
            vocalDensity: info.analysis.vocalDensity, mixabilityScore: info.analysis.mixabilityScore,
            bestExitWindows: info.analysis.bestExitWindows, phraseBars: info.analysis.phraseBars,
          },
          incoming: {
            title: meta.title, bpm: meta.bpm, camelot: analysis.camelot, energy: analysis.energy, grooveScore: analysis.grooveScore, mixInSec: analysis.mixInSec,
            bpmConfidence: analysis.bpmConfidence, performanceBrief: mix.performanceBrief,
            phraseConfidence: analysis.phraseConfidence, downbeatConfidence: analysis.downbeatConfidence,
            vocalDensity: analysis.vocalDensity, mixabilityScore: analysis.mixabilityScore,
            bestEntryWindows: analysis.bestEntryWindows, dropSec: analysis.dropSec, phraseBars: analysis.phraseBars,
          },
          setPhase, bpmTarget: store.bpmTarget, memory: memoryBrief(memory.current),
        }, keyHeader());
        recipe = professionalizeRecipe(recipe, info.analysis, analysis, secondsLeft, store.bpmTarget, memory.current, setPhase);
        store.pushFeed(`DJ Artist plan: ${recipe.type}${recipe.bassSwap ? ' + bass swap' : ''} over ${recipe.lengthBars} bars (${current.camelot}->${meta.camelot}).`, 'info');
        if (recipe.criticNotes?.length) store.pushFeed(`Mix Critic: ${recipe.criticNotes.slice(0, 2).join(' ')}`, 'warn');
      } catch {
        store.pushFeed('DJ Artist fallback: using local safety automation because live planning failed.', 'warn');
        recipe = safetyRecipe(info.analysis, analysis, secondsLeft);
      }
    }
    return professionalizeRecipe(recipe, info.analysis, analysis, secondsLeft, store.bpmTarget, memory.current, setPhase);
  }

  async function schedulePendingNext(info) {
    const pending = pendingNext.current;
    if (!pending) return;
    const store = useDJ.getState();
    const rate = engineRef.current.decks[info.name]?.rate || 1;
    const secondsLeft = Math.max(0, (info.analysis.duration - info.position) / Math.max(0.001, rate));
    const recipe = professionalizeRecipe(pending.recipe, info.analysis, pending.analysis, secondsLeft, store.bpmTarget, memory.current, phaseFor(store.trackCount, store.phases));
    const transition = engineRef.current.mixInto(pending.analysis, pending.meta, recipe);
    played.current.push(pending.meta.query || pending.mix.query);
    store.setStatus('Mix scheduled on the next phrase.');
    store.pushFeed(`AI move: ${performanceMoveLine(recipe)}; ${tempoTransitionLine(transition.tempo)}.`, 'mix');
    scheduled.current = {
      query: pending.meta.query,
      meta: pending.meta,
      transition,
      recipe,
      outgoing: info.meta,
      outgoingAnalysis: info.analysis,
      incomingAnalysis: pending.analysis,
      arcTarget: arcTargetEnergy(store.trackCount, store.phases),
      committed: false,
      summary: `${pending.meta.title} - ${pending.meta.bpm} BPM / ${pending.meta.camelot} / ${recipe.type}${recipe.bassSwap ? ' + bass swap' : ''}`,
    };
    pendingNext.current = null;
    store.setTransition({ progress: 0, secondsRemaining: Math.max(0, transition.end - engineRef.current.ctx.currentTime), recipe, tempo: transition.tempo });
  }

  function stop() {
    stopped.current = true;
    preparing.current = false;
    pendingNext.current = null;
    scheduled.current = null;
    liveRide.current = { at: 0, technique: '' };
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    const store = useDJ.getState();
    store.setEngine(null);
    store.setTransition(null);
    store.setUpNext(null);
    if (store.phase !== 'error') store.setPhase('idle');
  }

  function finishScheduledMix(record) {
    rememberTrack(memory.current, record.meta, record.incomingAnalysis, 'mix');
    const score = scoreCompletedTransition(record);
    rememberTransition(memory.current, score);
    const label = score.score >= 0.78 ? 'clean' : score.score >= 0.58 ? 'usable' : 'rough';
    useDJ.getState().pushFeed(`Mix review: ${label} ${Math.round(score.score * 100)}% - ${score.notes.join(' ')}`, score.score >= 0.58 ? 'info' : 'warn');
  }

  return { start, stop };

  function maybeReportLiveRide(live, info) {
    const now = Date.now();
    const changed = live.technique !== liveRide.current.technique;
    if (!changed && now - liveRide.current.at < 12000) return;
    liveRide.current = { at: now, technique: live.technique };
    useDJ.getState().pushFeed(
      `Live ride: ${live.technique} on ${info.meta?.title || 'deck'} | EQ ${fmtDb(live.low)}/${fmtDb(live.mid)}/${fmtDb(live.high)} dB`,
      'mix',
    );
  }
}

export function safetyRecipe(outgoing = {}, incoming = {}, secondsLeft = 60) {
  const tempoGap = Math.abs((Number(incoming.bpm) || 0) - (Number(outgoing.bpm) || 0));
  const keyMatch = camelotCompatible(outgoing.camelot, incoming.camelot);
  const groove = Math.min(Number(outgoing.grooveScore) || 0.4, Number(incoming.grooveScore) || 0.4);
  const type = secondsLeft < 12
    ? 'cut'
    : keyMatch && tempoGap <= 6 && groove > 0.35
      ? 'bassSwap'
      : tempoGap > 10
        ? 'echoOut'
        : 'filterSweep';
  const lengthBars = type === 'cut' ? 4 : type === 'echoOut' ? 16 : keyMatch ? 16 : 8;
  const curve = type === 'cut' ? 'sharp' : keyMatch ? 'equalPower' : 'linear';
  return {
    type,
    lengthBars,
    startPolicy: type === 'cut' ? 'cutOnOne' : 'nextPhrase',
    curve,
    bassSwap: type === 'bassSwap',
    tempoAutomation: { mode: type === 'cut' || type === 'echoOut' || tempoGap > 10 ? 'reset' : 'nudge', maxDeltaBpm: type === 'cut' || type === 'echoOut' || tempoGap > 10 ? 60 : 3 },
    gainAutomation: type === 'cut'
      ? [
          { deck: 'out', from: 1, to: 0, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
          { deck: 'in', from: 0, to: 1, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
        ]
      : [
          { deck: 'out', from: 1, to: 0, start: type === 'echoOut' ? 0.46 : 0, end: 1, shape: 'smooth' },
          { deck: 'in', from: 0, to: 1, start: type === 'echoOut' ? 0.52 : 0, end: type === 'echoOut' ? 0.86 : 1, shape: type === 'echoOut' ? 'smooth' : 'smooth' },
        ],
    eqAutomation: type === 'bassSwap'
      ? [
          { deck: 'out', band: 'low', fromDb: 0, toDb: -28, start: 0.34, end: 0.58, shape: 'smooth' },
          { deck: 'in', band: 'low', fromDb: -28, toDb: 0, start: 0.34, end: 0.58, shape: 'smooth' },
        ]
      : [],
    filterAutomation: type === 'filterSweep'
      ? [
          { deck: 'out', type: 'lowpass', fromHz: 22000, toHz: 520, start: 0.15, end: 0.86, shape: 'smooth' },
          { deck: 'in', type: 'highpass', fromHz: 900, toHz: 24, start: 0.15, end: 0.86, shape: 'smooth' },
        ]
      : [],
    effectsAutomation: type === 'echoOut'
      ? resetBridgeEffects()
      : [],
    loopAction: { enabled: false, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'Safety recipe avoids unnecessary loops.' },
    commentary: 'Safety handoff: phrase-aligned, no random loop.',
    fallback: { type: 'cut', lengthBars: 4, curve: 'sharp', bassSwap: false },
  };
}

export function withTempoResetIfNeeded(recipe, incoming = {}, currentBpm = 122) {
  const base = recipe && typeof recipe === 'object' ? recipe : safetyRecipe({}, incoming, 60);
  const resetBpm = nearestTempoLane(incoming.bpm, currentBpm);
  const currentRate = tempoRateFor(incoming.bpm, currentBpm);
  const resetRate = tempoRateFor(incoming.bpm, resetBpm);
  if (currentRate >= 0.84 && currentRate <= 1.16) return base;
  if (resetRate < 0.84 || resetRate > 1.16) return base;
  const type = base.type === 'cut' ? 'echoOut' : ['echoOut', 'filterSweep'].includes(base.type) ? base.type : 'echoOut';
  const lengthBars = Math.max(8, Math.min(16, Number(base.lengthBars) || 16));
  const resetRecipe = {
    ...base,
    type,
    curve: type === 'filterSweep' ? 'linear' : 'linear',
    bassSwap: false,
    lengthBars,
    startPolicy: 'nextPhrase',
    gainAutomation: resetBridgeGain(),
    eqAutomation: resetBridgeEq(),
    filterAutomation: resetBridgeFilters(type),
    effectsAutomation: resetBridgeEffects(),
    loopAction: { enabled: false, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'Tempo reset bridge uses echo/filter, not a loop.' },
    tempoAutomation: {
      ...(base.tempoAutomation || {}),
      mode: 'reset',
      targetBpm: resetBpm,
      maxDeltaBpm: 60,
      reason: 'Incoming track needs a proper tempo-lane reset instead of an ugly stretch.',
    },
  };
  return resetRecipe;
}

export function professionalizeRecipe(recipe, outgoing = {}, incoming = {}, secondsLeft = 60, currentBpm = 122, memory = null, phase = '') {
  const base = recipe && typeof recipe === 'object' ? recipe : safetyRecipe(outgoing, incoming, secondsLeft);
  let tuned = withTempoResetIfNeeded(base, incoming, currentBpm);
  if (tuned.tempoAutomation?.mode === 'reset') {
    return critiqueRecipe(tuned, { outgoing, incoming, secondsLeft, currentBpm, memory, phase });
  }
  if (secondsLeft < 10) {
    tuned = {
      ...safetyRecipe(outgoing, incoming, secondsLeft),
      type: 'echoOut',
      lengthBars: 8,
      startPolicy: 'nextPhrase',
      curve: 'linear',
      gainAutomation: resetBridgeGain(0.42, 0.78),
      filterAutomation: resetBridgeFilters('echoOut'),
      effectsAutomation: resetBridgeEffects(0.18, 0.62),
      loopAction: { enabled: false, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'Late recovery bridge avoids abrupt cut.' },
    };
    return critiqueRecipe(tuned, { outgoing, incoming, secondsLeft, currentBpm, memory, phase });
  }
  if (tuned.type === 'cut' && secondsLeft >= 16) {
    tuned = {
      ...tuned,
      type: 'echoOut',
      lengthBars: Math.max(8, Number(tuned.lengthBars) || 8),
      curve: 'linear',
      startPolicy: 'nextPhrase',
      gainAutomation: resetBridgeGain(0.42, 0.8),
      filterAutomation: resetBridgeFilters('echoOut'),
      effectsAutomation: resetBridgeEffects(0.18, 0.64),
      loopAction: { enabled: false, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'Converted hard cut into smoother bridge.' },
    };
  }
  return critiqueRecipe(tuned, { outgoing, incoming, secondsLeft, currentBpm, memory, phase });
}

export function critiqueRecipe(recipe = {}, context = {}) {
  const outgoing = context.outgoing || {};
  const incoming = context.incoming || {};
  const secondsLeft = Number(context.secondsLeft) || 60;
  const currentBpm = Number(context.currentBpm) || 122;
  const notes = [];
  let r = { ...recipe };
  const tempoGap = Math.abs(nearestTempoLane(incoming.bpm, currentBpm) - currentBpm);
  const relation = harmonicRelation(outgoing.camelot, incoming.camelot);
  const keyMatch = camelotCompatible(outgoing.camelot, incoming.camelot);
  const phase = String(context.phase || '').toLowerCase();
  // A deliberate energy-boost key jump is a legit DJ move when lifting into build/peak.
  const intentionalBoost = relation.kind === 'energyBoost'
    && /build|peak|finale/.test(phase)
    && Number(incoming.energy) >= Number(outgoing.energy || 0)
    && tempoGap <= 6;
  const vocalClash = Number(outgoing.vocalDensity) > 0.58 && Number(incoming.vocalDensity) > 0.58 && !keyMatch;
  const lowPhraseConfidence = Math.min(Number(outgoing.phraseConfidence) || 0.4, Number(incoming.phraseConfidence) || 0.4) < 0.18;
  const groove = Math.min(Number(outgoing.grooveScore) || 0.4, Number(incoming.grooveScore) || 0.4);

  if (r.loopAction?.enabled && !loopIsJustified(r.loopAction, r, secondsLeft)) {
    r = { ...r, loopAction: { ...r.loopAction, enabled: false, reason: 'Mix Critic blocked an unnecessary loop.' } };
    notes.push('Blocked unnecessary loop.');
  }

  if (r.type === 'blend' && !intentionalBoost && (vocalClash || (!keyMatch && tempoGap > 5))) {
    r = {
      ...r,
      type: 'filterSweep',
      curve: 'linear',
      bassSwap: false,
      lengthBars: Math.max(8, Math.min(16, Number(r.lengthBars) || 16)),
      filterAutomation: resetBridgeFilters('filterSweep'),
      gainAutomation: resetBridgeGain(0.18, 0.9),
    };
    notes.push('Changed risky blend into a filter bridge.');
  } else if (r.type === 'blend' && intentionalBoost) {
    notes.push(`Kept intentional energy-boost key lift (${outgoing.camelot}->${incoming.camelot}).`);
  }

  if ((r.type === 'bassSwap' || r.bassSwap) && (!keyMatch || groove < 0.32)) {
    r = {
      ...r,
      type: 'filterSweep',
      curve: 'linear',
      bassSwap: false,
      lengthBars: Math.max(8, Math.min(16, Number(r.lengthBars) || 16)),
      filterAutomation: resetBridgeFilters('filterSweep'),
      gainAutomation: resetBridgeGain(0.2, 0.9),
    };
    notes.push('Blocked bass swap on weak compatibility.');
  }

  if (r.type === 'cut' && secondsLeft > 10 && (lowPhraseConfidence || !impactCutIsClean(outgoing, incoming, currentBpm))) {
    r = {
      ...r,
      type: 'echoOut',
      curve: 'linear',
      lengthBars: Math.max(8, Math.min(16, Number(r.lengthBars) || 8)),
      startPolicy: 'nextPhrase',
      gainAutomation: resetBridgeGain(0.42, 0.82),
      filterAutomation: resetBridgeFilters('echoOut'),
      effectsAutomation: resetBridgeEffects(0.18, 0.66),
      loopAction: { enabled: false, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'Mix Critic converted a risky cut into an echo bridge.' },
    };
    notes.push('Converted risky cut into echo bridge.');
  }

  if (r.type === 'echoOut') {
    if (!hasDeckMoves(r.gainAutomation)) r.gainAutomation = resetBridgeGain();
    if (!hasMove(r.filterAutomation, 'out')) r.filterAutomation = resetBridgeFilters('echoOut');
    if (!Array.isArray(r.effectsAutomation) || r.effectsAutomation.length === 0) r.effectsAutomation = resetBridgeEffects();
    r.lengthBars = Math.max(8, Math.min(16, Number(r.lengthBars) || 16));
  }

  if (r.type === 'filterSweep') {
    if (!hasDeckMoves(r.gainAutomation)) r.gainAutomation = resetBridgeGain(0.16, 0.9);
    if (!hasMove(r.filterAutomation, 'in') || !hasMove(r.filterAutomation, 'out')) r.filterAutomation = resetBridgeFilters('filterSweep');
    r.lengthBars = Math.max(8, Math.min(16, Number(r.lengthBars) || 16));
  }

  if (r.type === 'bassSwap' || r.bassSwap) {
    r.eqAutomation = hasEqSwap(r.eqAutomation)
      ? r.eqAutomation
      : [
          { deck: 'out', band: 'low', fromDb: 0, toDb: -28, start: 0.34, end: 0.58, shape: 'smooth' },
          { deck: 'in', band: 'low', fromDb: -28, toDb: 0, start: 0.34, end: 0.58, shape: 'smooth' },
          { deck: 'out', band: 'mid', fromDb: 0, toDb: -2, start: 0.48, end: 0.76, shape: 'smooth' },
        ];
  }

  r.stages = buildTransitionStages(r);
  r.criticNotes = [...(Array.isArray(r.criticNotes) ? r.criticNotes : []), ...notes];
  return r;
}

export function buildTransitionStages(recipe = {}) {
  const type = recipe.type || 'blend';
  if (type === 'cut') return ['hold outgoing on phrase', 'snap incoming on the one', 'reset controller'];
  if (type === 'echoOut') return ['prepare outgoing tail', 'throw echo and reduce lows', 'drop incoming clean', 'reset EQ'];
  if (type === 'filterSweep') return ['high-pass incoming', 'sweep tension', 'handoff on phrase', 'open full range'];
  if (type === 'bassSwap' || recipe.bassSwap) return ['blend highs', 'swap low EQ', 'commit bass on phrase', 'clear outgoing'];
  return ['align phrases', 'equal-power blend', 'commit on crossover', 'reset EQ'];
}

export function createDJMemory() {
  return {
    tracks: [],
    transitions: [],
    blockedMoves: 0,
    lastTempoLane: 122,
  };
}

export function rememberTrack(memory, meta = {}, analysis = {}, role = 'mix') {
  if (!memory) return memory;
  memory.tracks = [
    ...(memory.tracks || []),
    {
      role,
      key: normalizeTrackKey(meta.query || meta.title || ''),
      title: meta.title || meta.query || 'Unknown',
      artist: meta.artist || '',
      bpm: Math.round(Number(analysis.bpm || meta.bpm) || 0),
      camelot: analysis.camelot || meta.camelot || '',
      energy: round2(analysis.energy),
      groove: round2(analysis.grooveScore),
      mixability: round2(analysis.mixabilityScore),
    },
  ].slice(-16);
  memory.lastTempoLane = Math.round(Number(analysis.bpm || meta.bpm || memory.lastTempoLane) || memory.lastTempoLane);
  return memory;
}

export function rememberTransition(memory, score = {}) {
  if (!memory) return memory;
  memory.transitions = [
    ...(memory.transitions || []),
    {
      type: score.type || 'blend',
      score: round2(score.score),
      notes: (score.notes || []).slice(0, 3),
    },
  ].slice(-10);
  if (score.notes?.some((n) => /blocked|converted|rough/i.test(n))) memory.blockedMoves = (memory.blockedMoves || 0) + 1;
  return memory;
}

export function memoryBrief(memory = {}) {
  const recentTracks = (memory.tracks || []).slice(-6).map((t) => `${t.title}${t.camelot ? ` ${t.camelot}` : ''}${t.bpm ? ` ${t.bpm}BPM` : ''}`);
  const recentMoves = (memory.transitions || []).slice(-4).map((t) => `${t.type}:${Math.round((t.score || 0) * 100)}%`);
  return {
    recentTracks,
    recentMoves,
    lastTempoLane: memory.lastTempoLane || 122,
    blockedMoves: memory.blockedMoves || 0,
  };
}

export function scoreCompletedTransition(record = {}) {
  const recipe = record.recipe || record.transition?.recipe || {};
  const tempo = record.transition?.tempo || {};
  const out = record.outgoingAnalysis || {};
  const inn = record.incomingAnalysis || {};
  const notes = [];
  let score = 0.72;

  if (recipe.type === 'cut') {
    score += impactCutIsClean(out, inn, tempo.toBpm || inn.bpm || 122) ? 0.08 : -0.18;
    notes.push('cut checked');
  }
  if (recipe.tempoAutomation?.mode === 'reset') {
    score += ['echoOut', 'filterSweep'].includes(recipe.type) ? 0.08 : -0.2;
    notes.push('tempo reset bridged');
  }
  if (recipe.loopAction?.enabled) {
    score += loopIsJustified(recipe.loopAction, recipe, 0) ? 0.03 : -0.16;
    notes.push('loop audited');
  }
  if ((recipe.type === 'bassSwap' || recipe.bassSwap) && !hasEqSwap(recipe.eqAutomation)) {
    score -= 0.12;
    notes.push('missing bass swap EQ');
  }
  if (Math.abs(Number(tempo.deltaBpm) || 0) > 6 && recipe.tempoAutomation?.mode !== 'reset') {
    score -= 0.12;
    notes.push('wide tempo nudge');
  }
  if ((Number(inn.mixabilityScore) || 0.5) < 0.22 || (Number(inn.phraseConfidence) || 0.5) < 0.12) {
    score -= 0.1;
    notes.push('weak incoming analysis');
  }
  // Reward staying on the planned energy arc (realized incoming energy near the target).
  if (Number.isFinite(Number(record.arcTarget))) {
    const arcMiss = Math.abs((Number(inn.energy) || 0.5) - Number(record.arcTarget));
    if (arcMiss < 0.15) { score += 0.06; notes.push('on energy arc'); }
    else if (arcMiss > 0.35) { score -= 0.06; notes.push('off energy arc'); }
  }
  if (!notes.length) notes.push('phrase and controller plan completed');
  return { type: recipe.type || 'blend', score: Math.max(0, Math.min(1, score)), notes };
}

export function transitionHandoffRatio(transition = {}) {
  const start = Number(transition.start);
  const end = Number(transition.end);
  const handoff = Number(transition.handoff);
  if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(handoff) && end > start) {
    return Math.max(0.45, Math.min(0.86, (handoff - start) / (end - start)));
  }
  return 0.55;
}

function resetBridgeGain(outStart = 0.46, inEnd = 0.86) {
  return [
    { deck: 'out', from: 1, to: 0, start: outStart, end: 1, shape: 'smooth' },
    { deck: 'in', from: 0, to: 1, start: Math.min(0.58, outStart + 0.08), end: inEnd, shape: 'smooth' },
  ];
}

function resetBridgeEq() {
  return [
    { deck: 'out', band: 'low', fromDb: 0, toDb: -20, start: 0.28, end: 0.7, shape: 'smooth' },
    { deck: 'out', band: 'mid', fromDb: 0, toDb: -4, start: 0.48, end: 0.88, shape: 'smooth' },
    { deck: 'in', band: 'low', fromDb: -18, toDb: 0, start: 0.56, end: 0.9, shape: 'smooth' },
  ];
}

function resetBridgeFilters(type = 'echoOut') {
  if (type === 'filterSweep') {
    return [
      { deck: 'out', type: 'lowpass', fromHz: 22000, toHz: 700, start: 0.18, end: 0.88, shape: 'smooth' },
      { deck: 'in', type: 'highpass', fromHz: 1200, toHz: 24, start: 0.3, end: 0.92, shape: 'smooth' },
    ];
  }
  return [
    { deck: 'out', type: 'lowpass', fromHz: 22000, toHz: 900, start: 0.38, end: 0.92, shape: 'smooth' },
    { deck: 'in', type: 'highpass', fromHz: 950, toHz: 24, start: 0.48, end: 0.9, shape: 'smooth' },
  ];
}

function resetBridgeEffects(start = 0.22, end = 0.72) {
  return [
    { target: 'echoSend', deck: 'out', from: 0, to: 0.58, start, end, shape: 'smooth' },
    { target: 'delayFeedback', deck: 'master', from: 0.02, to: 0.38, start, end, shape: 'smooth' },
  ];
}

function hasDeckMoves(moves) {
  return Array.isArray(moves) && moves.some((m) => m.deck === 'out') && moves.some((m) => m.deck === 'in');
}

function hasMove(moves, deck) {
  return Array.isArray(moves) && moves.some((m) => m.deck === deck);
}

function hasEqSwap(moves) {
  return Array.isArray(moves) &&
    moves.some((m) => m.deck === 'out' && m.band === 'low' && Number(m.toDb) < -10) &&
    moves.some((m) => m.deck === 'in' && m.band === 'low' && Number(m.fromDb) < -10);
}

function loopIsJustified(action = {}, recipe = {}, secondsLeft = 60) {
  if (!action.enabled) return true;
  const reason = String(action.reason || '').toLowerCase();
  const shortLoop = Number(action.lengthBeats) <= 4;
  const late = secondsLeft < 10;
  const usefulReason = /\b(late|extend|outro|phrase|rescue|recovery|incoming|deck)\b/.test(reason);
  return shortLoop && usefulReason && recipe.type !== 'echoOut' && recipe.tempoAutomation?.mode !== 'reset' && late;
}

function impactCutIsClean(outgoing = {}, incoming = {}, currentBpm = 122) {
  const tempoRate = tempoRateFor(incoming.bpm, currentBpm);
  const keyOk = camelotCompatible(outgoing.camelot, incoming.camelot);
  const grooveOk = Math.min(Number(outgoing.grooveScore) || 0, Number(incoming.grooveScore) || 0) > 0.52;
  const phraseOk = Math.min(Number(outgoing.downbeatConfidence) || 0.4, Number(incoming.downbeatConfidence) || 0.4) > 0.24;
  return tempoRate >= 0.92 && tempoRate <= 1.08 && grooveOk && phraseOk && (keyOk || Number(incoming.energy) > Number(outgoing.energy || 0) + 0.18);
}

// Scored harmonic relationship between two Camelot keys (real-DJ harmonic mixing).
// Returns { kind, score (0..1), compatible }. Higher score = smoother blend.
// kinds: perfect | adjacent | relative | dominant | energyBoost | clash.
export function harmonicRelation(a, b) {
  const ma = /^(\d{1,2})([AB])$/.exec(String(a || '').trim().toUpperCase());
  const mb = /^(\d{1,2})([AB])$/.exec(String(b || '').trim().toUpperCase());
  if (!ma || !mb) return { kind: 'unknown', score: 0.4, compatible: false };
  const na = Number(ma[1]);
  const nb = Number(mb[1]);
  const la = ma[2];
  const lb = mb[2];
  const diff = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb)); // wheel distance
  if (la === lb && diff === 0) return { kind: 'perfect', score: 1, compatible: true };
  if (na === nb && la !== lb) return { kind: 'relative', score: 0.92, compatible: true };
  if (la === lb && diff === 1) return { kind: 'adjacent', score: 0.9, compatible: true }; // ±1 = ±a fifth
  if (la === lb && diff === 2) return { kind: 'dominant', score: 0.66, compatible: true }; // +2 whole tone, common boost
  // +7 on the wheel (a +1 semitone modal shift) reads as a deliberate energy lift.
  const semitoneUp = (na % 12) + 7 <= 0 ? false : (((na + 7 - 1) % 12) + 1) === nb && la === lb;
  if (semitoneUp || (la === lb && diff === 3)) return { kind: 'energyBoost', score: 0.5, compatible: true };
  return { kind: 'clash', score: 0.2, compatible: false };
}

function camelotCompatible(a, b) {
  return harmonicRelation(a, b).compatible && harmonicRelation(a, b).kind !== 'energyBoost';
}

function normalizeTrackKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function tempoMoveLine(prefix, meta, move) {
  return `${prefix}: ${meta.title || meta.query} pulls set ${Math.round(move.fromBpm)}->${Math.round(move.toBpm)} BPM, deck ride ${Math.round(move.inRateTo * 100)}%.`;
}

function tempoTransitionLine(move) {
  if (!move) return 'tempo locked';
  const delta = Math.abs(move.deltaBpm) < 0.05 ? 'locked' : move.deltaBpm > 0 ? `up ${move.deltaBpm} BPM` : `down ${Math.abs(move.deltaBpm)} BPM`;
  return `tempo ${Math.round(move.fromBpm)}->${Math.round(move.toBpm)} BPM (${delta})`;
}

function performanceMoveLine(recipe = {}) {
  const bars = recipe.lengthBars ? `${recipe.lengthBars} bars` : 'phrase';
  if (recipe.type === 'cut') return `snap cut on the one over ${bars}`;
  if (recipe.type === 'echoOut') return `echo drop, hold then hit over ${bars}`;
  if (recipe.type === 'filterSweep') return `filter bridge with staged faders over ${bars}`;
  if (recipe.type === 'bassSwap' || recipe.bassSwap) return `bass swap with phrase handoff over ${bars}`;
  return `${recipe.curve || 'smooth'} blend over ${bars}`;
}

function fmtDb(value) {
  const n = Math.round((Number(value) || 0) * 10) / 10;
  return n > 0 ? `+${n}` : `${n}`;
}

function uniqueQueries(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const q = String(value || '').trim();
    if (!q) continue;
    const key = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

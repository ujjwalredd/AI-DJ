import { describe, expect, it } from 'vitest';
import { buildTransitionStages, createDJMemory, critiqueRecipe, livePerformanceWindowSec, memoryBrief, nextMixTriggerSec, nextPreloadTriggerSec, professionalizeRecipe, rememberTrack, scoreCompletedTransition, shouldPrepareNextMix, shouldPreloadNextMix, trackSuitability, transitionHandoffRatio, withTempoResetIfNeeded } from './useDJController.js';

describe('DJ mix trigger timing', () => {
  it('prepares and performs around the first live phrase window on long tracks', () => {
    const analysis = { duration: 300, mixInSec: 0, mixOutSec: 255, beatPeriod: 0.5, grooveScore: 0.7, energy: 0.6 };

    expect(livePerformanceWindowSec(analysis)).toBe(32);
    expect(nextPreloadTriggerSec(analysis)).toBe(4);
    expect(nextMixTriggerSec(analysis)).toBe(32);
    expect(shouldPreloadNextMix({ analysis, position: 3.9 })).toBe(false);
    expect(shouldPreloadNextMix({ analysis, position: 4 })).toBe(true);
    expect(shouldPrepareNextMix({ analysis, position: 31.9 })).toBe(false);
    expect(shouldPrepareNextMix({ analysis, position: 32 })).toBe(true);
  });

  it('uses the outro lead when a track reaches the safe mix-out sooner', () => {
    const analysis = { duration: 105, mixInSec: 0, mixOutSec: 35, beatPeriod: 0.5 };

    expect(nextMixTriggerSec(analysis)).toBe(19);
    expect(shouldPrepareNextMix({ analysis, position: 18.9 })).toBe(false);
    expect(shouldPrepareNextMix({ analysis, position: 19 })).toBe(true);
  });

  it('respects a non-zero mix-in cue', () => {
    const analysis = { duration: 320, mixInSec: 12, mixOutSec: 260, beatPeriod: 0.5, grooveScore: 0.2, energy: 0.2 };

    expect(livePerformanceWindowSec(analysis)).toBe(58);
    expect(nextPreloadTriggerSec(analysis)).toBe(16);
    expect(nextMixTriggerSec(analysis)).toBe(70);
    expect(shouldPrepareNextMix({ analysis, position: 69.9 })).toBe(false);
    expect(shouldPrepareNextMix({ analysis, position: 70 })).toBe(true);
  });
});

describe('DJ track suitability gate', () => {
  it('rejects altered uploads unless explicitly requested', () => {
    const result = {
      meta: { title: 'Big Song slowed reverb', query: 'Artist - Big Song slowed reverb' },
      analysis: { bpmConfidence: 0.4, grooveScore: 0.8, onsetDensity: 0.1, energy: 0.5 },
    };

    expect(trackSuitability(result, { genre: 'Open format', vibe: 'club', rate: 1, preferMixable: true }).ok).toBe(false);
    expect(trackSuitability(result, { genre: 'lofi slowed reverb', vibe: 'slowed reverb', rate: 1, preferMixable: true }).ok).toBe(true);
  });

  it('rejects weak-groove low-energy tracks for a build or peak lane', () => {
    const result = {
      meta: { title: 'Artist - sleepy album cut', query: 'Artist - sleepy album cut' },
      analysis: { bpmConfidence: 0.02, grooveScore: 0.12, onsetDensity: 0.01, energy: 0.03 },
    };

    expect(trackSuitability(result, { genre: 'Open format', vibe: 'club set', phase: 'peak', rate: 1, preferMixable: true })).toEqual({
      ok: false,
      reason: 'weak beatgrid confidence for live mixing',
    });
  });

  it('accepts strong analyzed club tracks in the tempo lane', () => {
    const result = {
      meta: { title: 'Artist - Club Record', query: 'Artist - Club Record' },
      analysis: { bpmConfidence: 0.28, grooveScore: 0.68, onsetDensity: 0.08, energy: 0.32 },
    };

    expect(trackSuitability(result, { genre: 'House', vibe: 'club set', phase: 'build', rate: 1.03, preferMixable: true }).ok).toBe(true);
  });

  it('accepts strong songs that need a tempo reset instead of rejecting them for wide stretch', () => {
    const result = {
      meta: { title: 'The Weeknd - Blinding Lights', query: 'The Weeknd - Blinding Lights' },
      analysis: { bpmConfidence: 0.24, grooveScore: 0.74, onsetDensity: 0.09, energy: 0.42 },
    };

    expect(trackSuitability(result, {
      genre: 'Pop',
      vibe: 'club set',
      phase: 'build',
      rate: 1.29,
      resetRate: 1,
      allowTempoReset: true,
      preferMixable: true,
    })).toEqual({
      ok: true,
      reason: 'tempo reset bridge (129% -> 100%)',
    });
  });
});

describe('DJ artist transition policy', () => {
  const outgoing = {
    bpm: 124,
    camelot: '8A',
    energy: 0.65,
    grooveScore: 0.7,
  };
  const incomingReset = {
    bpm: 95,
    camelot: '10B',
    energy: 0.72,
    grooveScore: 0.78,
  };

  it('turns a wide tempo mismatch into a controlled reset bridge, not a sudden cut', () => {
    const recipe = withTempoResetIfNeeded({
      type: 'cut',
      lengthBars: 4,
      curve: 'sharp',
      tempoAutomation: { mode: 'bridge', maxDeltaBpm: 8 },
      gainAutomation: [],
      filterAutomation: [],
      effectsAutomation: [],
      loopAction: { enabled: true, deck: 'out', lengthBeats: 4, start: 0.4, end: 0.8, reason: 'test' },
    }, incomingReset, 124);

    expect(recipe.type).toBe('echoOut');
    expect(recipe.lengthBars).toBe(8);
    expect(recipe.startPolicy).toBe('nextPhrase');
    expect(recipe.tempoAutomation.mode).toBe('reset');
    expect(recipe.tempoAutomation.targetBpm).toBe(95);
    expect(recipe.gainAutomation.find((m) => m.deck === 'in').end).toBeCloseTo(0.86, 2);
    expect(recipe.filterAutomation.some((m) => m.deck === 'in' && m.type === 'highpass')).toBe(true);
    expect(recipe.effectsAutomation.length).toBeGreaterThan(0);
    expect(recipe.loopAction.enabled).toBe(false);
  });

  it('converts unnecessary hard cuts into smoother bridges when there is runway', () => {
    const recipe = professionalizeRecipe({
      type: 'cut',
      lengthBars: 4,
      curve: 'sharp',
      tempoAutomation: { mode: 'bridge', maxDeltaBpm: 8 },
      gainAutomation: [
        { deck: 'out', from: 1, to: 0, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
        { deck: 'in', from: 0, to: 1, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
      ],
      loopAction: { enabled: true, deck: 'out', lengthBeats: 4, start: 0.4, end: 0.8, reason: 'test' },
    }, outgoing, { ...outgoing, bpm: 126 }, 24, 124);

    expect(recipe.type).toBe('echoOut');
    expect(recipe.lengthBars).toBe(8);
    expect(recipe.curve).toBe('linear');
    expect(recipe.gainAutomation.find((m) => m.deck === 'out').start).toBeCloseTo(0.42, 2);
    expect(recipe.effectsAutomation.length).toBeGreaterThan(0);
    expect(recipe.loopAction.enabled).toBe(false);
  });

  it('uses a short musical recovery bridge when the next deck is late', () => {
    const recipe = professionalizeRecipe({
      type: 'blend',
      lengthBars: 16,
      curve: 'equalPower',
      tempoAutomation: { mode: 'nudge', maxDeltaBpm: 3 },
      gainAutomation: [],
    }, outgoing, { ...outgoing, bpm: 126 }, 7, 124);

    expect(recipe.type).toBe('echoOut');
    expect(recipe.lengthBars).toBe(8);
    expect(recipe.startPolicy).toBe('nextPhrase');
    expect(recipe.gainAutomation.find((m) => m.deck === 'in').end).toBeCloseTo(0.78, 2);
    expect(recipe.loopAction.enabled).toBe(false);
  });

  it('blocks random loops and converts risky vocal-clash blends into filter bridges', () => {
    const recipe = critiqueRecipe({
      type: 'blend',
      lengthBars: 32,
      curve: 'equalPower',
      bassSwap: false,
      gainAutomation: [],
      loopAction: { enabled: true, deck: 'out', lengthBeats: 8, start: 0.2, end: 0.8, reason: 'sounds cool' },
    }, {
      outgoing: { bpm: 124, camelot: '8A', vocalDensity: 0.8, phraseConfidence: 0.5, grooveScore: 0.7 },
      incoming: { bpm: 131, camelot: '2B', vocalDensity: 0.82, phraseConfidence: 0.5, grooveScore: 0.68 },
      secondsLeft: 42,
      currentBpm: 124,
    });

    expect(recipe.type).toBe('filterSweep');
    expect(recipe.loopAction.enabled).toBe(false);
    expect(recipe.filterAutomation.some((m) => m.deck === 'in')).toBe(true);
    expect(recipe.criticNotes.join(' ')).toMatch(/Blocked unnecessary loop/);
  });

  it('keeps staged transition labels for controller/debug state', () => {
    expect(buildTransitionStages({ type: 'bassSwap', bassSwap: true })).toContain('swap low EQ');
    expect(buildTransitionStages({ type: 'echoOut' })).toContain('throw echo and reduce lows');
  });

  it('uses actual engine handoff timing instead of a fixed 55 percent UI commit', () => {
    expect(transitionHandoffRatio({ start: 10, handoff: 24.4, end: 30 })).toBeCloseTo(0.72, 2);
    expect(transitionHandoffRatio({ start: 10, handoff: 80, end: 30 })).toBe(0.86);
  });

  it('tracks DJ memory and scores completed transitions', () => {
    const memory = createDJMemory();
    rememberTrack(memory, { title: 'Artist - Record', query: 'Artist - Record' }, { bpm: 124, camelot: '8A', energy: 0.6, grooveScore: 0.7, mixabilityScore: 0.8 }, 'mix');
    expect(memoryBrief(memory).recentTracks[0]).toContain('Artist - Record');

    const score = scoreCompletedTransition({
      recipe: {
        type: 'echoOut',
        tempoAutomation: { mode: 'reset' },
        loopAction: { enabled: false },
      },
      transition: { tempo: { deltaBpm: -29, toBpm: 95 } },
      incomingAnalysis: { mixabilityScore: 0.7, phraseConfidence: 0.6 },
    });
    expect(score.score).toBeGreaterThan(0.75);
    expect(score.notes.join(' ')).toContain('tempo reset bridged');
  });
});

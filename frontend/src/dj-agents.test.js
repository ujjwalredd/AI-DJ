import { describe, expect, it } from 'vitest';
import { normalizeMix, normalizePlan, normalizeTransition } from '../../lib/dj-agents.js';

describe('DJ agent normalization', () => {
  it('normalizes plan payloads with fallbacks', () => {
    const plan = normalizePlan({ opener: { query: 'Disclosure - Latch', fallbackQueries: ['Disclosure - Latch', 'Kaytranada - Lite Spots'] } }, { vibe: 'house', genre: 'House', bpmTarget: 123 });
    expect(plan.bpmTarget).toBe(123);
    expect(plan.genre).toBe('House');
    expect(plan.opener.fallbackQueries).toContain('Kaytranada - Lite Spots');
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
  });

  it('stays in the requested scene with no hardcoded songs (last resort = scene search)', () => {
    const plan = normalizePlan({}, { scene: 'Kannada hits', genre: 'Kannada' });
    const mix = normalizeMix({}, { genre: 'Kannada hits', played: [] });
    // Free-form scene is preserved, never remapped to a fixed catalog.
    expect(plan.genre).toBe('Kannada');
    expect(plan.opener.query.toLowerCase()).toContain('kannada');
    expect(plan.opener.fallbackQueries.join(' ').toLowerCase()).toContain('kannada');
    expect(mix.query.toLowerCase()).toContain('kannada');
  });

  it('uses the AI candidates verbatim when provided', () => {
    const mix = normalizeMix({
      selectedQuery: 'Vijay Prakash - Anisuthide',
      performanceBrief: 'harmonic lift for the DJ Artist',
      candidates: [
        { query: 'Vijay Prakash - Anisuthide', why: 'in scene', risk: 'low' },
        { query: 'Sonu Nigam - Neene Neene', why: 'harmonic', risk: 'low' },
      ],
    }, { genre: 'Kannada', played: [] });
    expect(mix.query).toBe('Vijay Prakash - Anisuthide');
    expect(mix.candidates.map((c) => c.query)).toContain('Sonu Nigam - Neene Neene');
    expect(mix.performanceBrief).toContain('harmonic');
    expect(mix.transition).toBeUndefined();
  });

  it('removes duplicate played tracks from next candidates', () => {
    const mix = normalizeMix({
      selectedQuery: 'Daft Punk - One More Time',
      candidates: [
        { query: 'Daft Punk - One More Time', why: 'played', risk: 'repeat' },
        { query: 'Disclosure - Latch', why: 'works', risk: 'low' },
      ],
      transition: { lengthBars: 8, curve: 'linear' },
    }, { played: ['Daft Punk - One More Time'] });
    expect(mix.query).toBe('Disclosure - Latch');
    expect(mix.candidates.some((c) => c.query === 'Daft Punk - One More Time')).toBe(false);
  });

  it('clamps transition automation values', () => {
    const transition = normalizeTransition({
      type: 'bassSwap',
      lengthBars: 32,
      tempoAutomation: { mode: 'bridge', targetBpm: 240, maxDeltaBpm: 40 },
      gainAutomation: [
        { deck: 'out', from: 2, to: -1, start: -2, end: 0.3, shape: 'wild' },
        { deck: 'in', from: -1, to: 2, start: 0.3, end: 8, shape: 'smooth' },
      ],
      eqAutomation: [{ deck: 'in', band: 'low', fromDb: -80, toDb: 20, start: -1, end: 2, shape: 'smooth' }],
      filterAutomation: [{ deck: 'out', type: 'highpass', fromHz: 1, toHz: 99999, start: 0, end: 1, shape: 'smooth' }],
      effectsAutomation: [{ target: 'echoSend', deck: 'out', from: -3, to: 9, start: 0, end: 1, shape: 'smooth' }],
      loopAction: { enabled: true, deck: 'out', lengthBeats: 64, start: -1, end: 2, reason: 'test' },
    });
    expect(transition.tempoAutomation.targetBpm).toBe(180);
    expect(transition.tempoAutomation.maxDeltaBpm).toBe(10);
    expect(transition.gainAutomation[0].from).toBe(1);
    expect(transition.gainAutomation[0].to).toBe(0);
    expect(transition.eqAutomation[0].fromDb).toBe(-36);
    expect(transition.eqAutomation[0].toDb).toBe(6);
    expect(transition.filterAutomation[0].fromHz).toBe(20);
    expect(transition.filterAutomation[0].toHz).toBe(22000);
    expect(transition.effectsAutomation[0].to).toBe(1);
    expect(transition.loopAction.lengthBeats).toBe(4);
  });

  it('normalizes reset cuts into musical bridge transitions', () => {
    const transition = normalizeTransition({
      type: 'cut',
      lengthBars: 4,
      curve: 'sharp',
      tempoAutomation: { mode: 'reset', targetBpm: 95, maxDeltaBpm: 60 },
      gainAutomation: [
        { deck: 'out', from: 1, to: 0, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
        { deck: 'in', from: 0, to: 1, start: 0.48, end: 0.515, shape: 'holdThenSnap' },
      ],
      eqAutomation: [],
      filterAutomation: [],
      effectsAutomation: [],
      loopAction: { enabled: true, deck: 'out', lengthBeats: 4, start: 0.45, end: 0.78, reason: 'test' },
      commentary: 'hard switch',
      fallback: { type: 'cut', lengthBars: 4, curve: 'sharp', bassSwap: false },
    });

    expect(transition.type).toBe('echoOut');
    expect(transition.lengthBars).toBe(16);
    expect(transition.tempoAutomation.mode).toBe('reset');
    expect(transition.gainAutomation.find((m) => m.deck === 'out').start).toBeCloseTo(0.55, 2);
    expect(transition.gainAutomation.find((m) => m.deck === 'in').end).toBeCloseTo(0.72, 2);
    expect(transition.filterAutomation.length).toBeGreaterThan(0);
    expect(transition.effectsAutomation.length).toBeGreaterThan(0);
  });
});

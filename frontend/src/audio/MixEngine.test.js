import { describe, expect, it } from 'vitest';
import { adaptiveTempoTarget, dynamicTempoTarget, livePerformanceFrame, mixFrame, nearestTempoLane, normalizeRecipe, recipeHandoffProgress, scheduleParamCurve, scheduleParamRamp, scheduleParamValue, tempoRateFor, transitionMs, transitionStartGridBeats } from './MixEngine.js';

describe('mix scheduling helpers', () => {
  it('normalizes malformed transition recipes safely', () => {
    const recipe = normalizeRecipe({ lengthBars: 999, curve: 'wild', startPolicy: 'bad' });
    expect(recipe.lengthBars).toBe(16);
    expect(recipe.curve).toBe('equalPower');
    expect(recipe.startPolicy).toBe('outroPhrase');
    expect(recipe.bassSwap).toBe(false);
  });

  it('computes transition duration from bars and target BPM', () => {
    expect(transitionMs({ lengthBars: 8 }, 120)).toBe(16000);
    expect(transitionMs({ lengthBars: 16 }, 120)).toBe(32000);
  });

  it('starts transitions on practical phrase grids independent of transition length', () => {
    expect(transitionStartGridBeats({ type: 'blend', lengthBars: 32 })).toBe(32);
    expect(transitionStartGridBeats({ type: 'filterSweep', lengthBars: 32 })).toBe(16);
    expect(transitionStartGridBeats({ type: 'cut', lengthBars: 16 })).toBe(4);
    expect(transitionStartGridBeats({ type: 'echoOut', tempoAutomation: { mode: 'reset' } })).toBe(16);
    expect(transitionStartGridBeats({ type: 'cut', tempoAutomation: { mode: 'reset' } })).toBe(16);
  });

  it('hands off only after the audible fader crossover for bridge transitions', () => {
    const bridge = {
      type: 'echoOut',
      tempoAutomation: { mode: 'reset', maxDeltaBpm: 60 },
      gainAutomation: [
        { deck: 'out', from: 1, to: 0, start: 0.46, end: 1, shape: 'smooth' },
        { deck: 'in', from: 0, to: 1, start: 0.54, end: 0.86, shape: 'smooth' },
      ],
    };
    const blend = {
      type: 'blend',
      gainAutomation: [
        { deck: 'out', from: 1, to: 0, start: 0, end: 1, shape: 'smooth' },
        { deck: 'in', from: 0, to: 1, start: 0, end: 1, shape: 'smooth' },
      ],
    };

    expect(recipeHandoffProgress(bridge)).toBeCloseTo(0.72, 2);
    expect(recipeHandoffProgress({ type: 'cut' })).toBeCloseTo(0.52, 2);
    expect(recipeHandoffProgress(blend)).toBeCloseTo(0.5, 1);
  });

  it('computes deck tempo rides against the set tempo', () => {
    expect(tempoRateFor(120, 126)).toBeCloseTo(1.05, 3);
    expect(tempoRateFor(128, 120)).toBeCloseTo(0.9375, 4);
    expect(tempoRateFor(70, 122)).toBeCloseTo(0.8714, 3);
  });

  it('moves the set tempo dynamically instead of pinning it to the starting lane', () => {
    expect(nearestTempoLane(128, 124)).toBe(128);
    expect(adaptiveTempoTarget(124, 128, 'blend')).toBe(127);
    expect(adaptiveTempoTarget(124, 132, 'cut')).toBe(132);
    expect(adaptiveTempoTarget(124, 118, 'filterSweep')).toBe(119);
    expect(dynamicTempoTarget(124, 132, { tempoAutomation: { mode: 'hold', maxDeltaBpm: 0 } })).toBe(124);
    expect(dynamicTempoTarget(124, 132, { tempoAutomation: { mode: 'bridge', maxDeltaBpm: 6 } })).toBe(130);
    expect(dynamicTempoTarget(124, 95, { tempoAutomation: { mode: 'reset', targetBpm: 95, maxDeltaBpm: 60 } })).toBe(95);
  });

  it('uses distinct human-style mixer curves per transition type', () => {
    const cutEarly = mixFrame({ type: 'cut', curve: 'sharp', lengthBars: 4 }, 0.3, 'out');
    const cutDrop = mixFrame({ type: 'cut', curve: 'sharp', lengthBars: 4 }, 0.54, 'out');
    const echoInEarly = mixFrame({ type: 'echoOut', lengthBars: 8, bassSwap: false }, 0.45, 'in');
    const echoInDrop = mixFrame({ type: 'echoOut', lengthBars: 8, bassSwap: false }, 0.75, 'in');
    const bassOut = mixFrame({ type: 'bassSwap', lengthBars: 16, bassSwap: true }, 0.52, 'out');
    const bassIn = mixFrame({ type: 'bassSwap', lengthBars: 16, bassSwap: true }, 0.52, 'in');

    expect(cutEarly.gain).toBeCloseTo(1, 2);
    expect(cutDrop.gain).toBeLessThan(0.05);
    expect(echoInEarly.gain).toBeLessThan(0.1);
    expect(echoInDrop.gain).toBeGreaterThan(0.9);
    expect(bassOut.low).toBeLessThan(-18);
    expect(bassIn.low).toBeGreaterThan(-10);
  });

  it('lets artist automation override canned fader shapes safely', () => {
    const recipe = {
      type: 'blend',
      gainAutomation: [
        { deck: 'out', from: 1, to: 0.25, start: 0.1, end: 0.3, shape: 'sharp' },
        { deck: 'in', from: 0, to: 1, start: 0.62, end: 0.8, shape: 'smooth' },
      ],
      eqAutomation: [
        { deck: 'out', band: 'mid', fromDb: 0, toDb: -5, start: 0.2, end: 0.45, shape: 'smooth' },
      ],
    };
    expect(mixFrame(recipe, 0.35, 'out').gain).toBeCloseTo(0.25, 2);
    expect(mixFrame(recipe, 0.5, 'in').gain).toBeCloseTo(0, 2);
    expect(mixFrame(recipe, 0.7, 'in').gain).toBeGreaterThan(0.25);
    expect(mixFrame(recipe, 0.5, 'out').mid).toBeCloseTo(-5, 1);
  });

  it('rides the current playing song before transitions', () => {
    const analysis = {
      duration: 240,
      bpm: 124,
      beatPeriod: 60 / 124,
      firstBeatSec: 0,
      mixInSec: 0,
      introEndSec: 18,
      mixOutSec: 190,
      energy: 0.62,
      grooveScore: 0.72,
    };
    const intro = livePerformanceFrame(analysis, 4, 'build', { bass: 0.18, treble: 0.35 });
    const peak = livePerformanceFrame(analysis, 72, 'peak', { bass: 0.42, treble: 0.4 });
    const outro = livePerformanceFrame(analysis, 178, 'release', { bass: 0.5, treble: 0.45 });

    expect(intro.technique).toBe('intro build');
    expect(intro.low).toBeLessThan(0);
    expect(peak.technique).toBe('peak drive');
    expect(peak.low).toBeGreaterThan(intro.low);
    expect(outro.technique).toBe('outro prep');
    expect(outro.low).toBeLessThan(peak.low);
  });

  it('sanitizes AudioParam automation scheduling', () => {
    const param = fakeParam();
    scheduleParamCurve(param, [0, 0.5, 1], 12, 4);
    scheduleParamRamp(param, 1, 0, 20, 2);
    scheduleParamValue(param, 0, 24);

    expect(param.events).toEqual([
      ['cancel', 12],
      ['curve', 12, 4, 3],
      ['cancel', 20],
      ['set', 20, 1],
      ['linear', 22, 0],
      ['cancel', 24],
      ['set', 24, 0],
    ]);
  });
});

function fakeParam() {
  return {
    events: [],
    cancelScheduledValues(time) { this.events.push(['cancel', time]); },
    setValueAtTime(value, time) { this.events.push(['set', time, value]); },
    linearRampToValueAtTime(value, time) { this.events.push(['linear', time, value]); },
    setValueCurveAtTime(values, time, duration) { this.events.push(['curve', time, duration, values.length]); },
  };
}

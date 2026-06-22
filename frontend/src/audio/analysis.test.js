import { describe, expect, it } from 'vitest';
import { camelotFromChroma, cuePointsFromEnvelope, detectDrop, detectPhraseBars, estimateBpmFromEnvelope, grooveMetrics, integratedLoudness, smoothEnvelope, trackStructureFromEnvelope } from './analysis.js';

function clickEnvelope({ bpm = 120, seconds = 24, fps = 100 }) {
  const total = seconds * fps;
  const period = Math.round((60 / bpm) * fps);
  const env = new Array(total).fill(0.02);
  for (let i = 0; i < total; i += period) env[i] = 1;
  return smoothEnvelope(env, 1);
}

describe('analysis helpers', () => {
  it('estimates BPM from a synthetic onset grid', () => {
    const env = clickEnvelope({ bpm: 124 });
    const result = estimateBpmFromEnvelope(env);
    expect(result.bpm).toBeGreaterThan(121);
    expect(result.bpm).toBeLessThan(127);
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  it('finds cue points inside track bounds', () => {
    const env = new Array(6000).fill(0.02);
    for (let i = 800; i < 5200; i++) env[i] = 0.35;
    const cues = cuePointsFromEnvelope(smoothEnvelope(env, 4), 0.1, 60, 0.5, 0);
    expect(cues.mixInSec).toBeGreaterThanOrEqual(0);
    expect(cues.mixOutSec).toBeGreaterThan(cues.mixInSec);
    expect(cues.outroStartSec).toBeLessThan(60);
  });

  it('maps strong chroma to a stable Camelot key', () => {
    const chroma = new Array(12).fill(0);
    chroma[0] = 10;
    chroma[4] = 8;
    chroma[7] = 7;
    const key = camelotFromChroma(chroma);
    expect(key.camelot).toBe('8B');
    expect(key.confidence).toBeGreaterThan(0.5);
  });

  it('scores a clear onset grid as more groove-ready than a flat bed', () => {
    const groovy = clickEnvelope({ bpm: 124 });
    const flat = new Array(groovy.length).fill(0.02);

    expect(grooveMetrics(groovy, undefined, 0.2).grooveScore).toBeGreaterThan(0.45);
    expect(grooveMetrics(flat, undefined, 0.01).grooveScore).toBeLessThan(0.25);
  });

  it('extracts structure signals and ranked mix windows from the envelope', () => {
    const env = clickEnvelope({ bpm: 124, seconds: 96 });
    for (let i = 0; i < env.length; i++) {
      if (i > 2800 && i < 3600) env[i] *= 0.25;
      if (i > 6200) env[i] *= 0.52;
    }
    const onset = env.map((v, i) => Math.max(0, v - (env[i - 1] || v)));
    const structure = trackStructureFromEnvelope(env, onset, 0.08, 96, 60 / 124, 0, grooveMetrics(env, onset, 0.25), 0.25);

    expect(structure.phraseConfidence).toBeGreaterThan(0.3);
    expect(structure.downbeatConfidence).toBeGreaterThan(0.3);
    expect(structure.mixabilityScore).toBeGreaterThan(0.25);
    expect(structure.sections.length).toBeGreaterThan(3);
    expect(structure.bestEntryWindows.length).toBeGreaterThan(0);
    expect(structure.bestExitWindows.length).toBeGreaterThan(0);
  });

  it('detects a drop where energy jumps after a quiet build', () => {
    const fps = 100;
    const beatPeriod = 60 / 124;
    // 80s: quiet intro/build for ~28s, then a loud drop body.
    const env = new Array(80 * fps).fill(0.05);
    for (let i = 28 * fps; i < env.length; i++) env[i] = 0.6;
    const sm = smoothEnvelope(env, 4);
    const drop = detectDrop(sm, sm, 0.2, beatPeriod, 0, 80);
    expect(drop.dropSec).toBeGreaterThan(20);
    expect(drop.dropSec).toBeLessThan(40);
    expect(drop.confidence).toBeGreaterThan(0);
  });

  it('detects a repeating phrase length from the bar series', () => {
    const fps = 100;
    const beatPeriod = 60 / 120; // bar = 2s
    const env = new Array(120 * fps).fill(0.1);
    // Lift one bar every 16 bars (every 32s) to imply a 16-bar phrase.
    for (let bar = 0; bar * 32 < 120; bar++) {
      const s = Math.round(bar * 32 * fps);
      for (let i = s; i < s + 2 * fps && i < env.length; i++) env[i] = 0.5;
    }
    const res = detectPhraseBars(smoothEnvelope(env, 2), beatPeriod, 0);
    expect([8, 16, 32]).toContain(res.phraseBars);
  });

  it('computes a gain trim that lifts quiet tracks and tames loud ones', () => {
    const quiet = new Array(2000).fill(0.04);
    const loud = new Array(2000).fill(0.4);
    expect(integratedLoudness(quiet).gainTrim).toBeGreaterThan(1);
    expect(integratedLoudness(loud).gainTrim).toBeLessThan(1);
  });
});

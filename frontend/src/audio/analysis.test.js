import { describe, expect, it } from 'vitest';
import { camelotFromChroma, cuePointsFromEnvelope, estimateBpmFromEnvelope, grooveMetrics, smoothEnvelope, trackStructureFromEnvelope } from './analysis.js';

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
});

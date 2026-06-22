const FRAME = 0.01;

export async function analyzeTrack(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load audio (${res.status}).`);
  const bytes = await res.arrayBuffer();
  const buffer = await ctx.decodeAudioData(bytes);
  return analyzeBuffer(buffer);
}

export function analyzeBuffer(buffer) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const env = smoothEnvelope(energyEnvelope(data, sr), 7);
  const mean = avg(env);
  const bpmInfo = estimateBpmFromEnvelope(env, mean);
  const onset = onsetEnvelope(env, mean);
  const groove = grooveMetrics(env, onset, bpmInfo.confidence);
  const firstBeatSec = beatPhase(env, mean, bpmInfo.periodFrames) * FRAME;
  const beatPeriod = 60 / bpmInfo.bpm;
  const cues = cuePointsFromEnvelope(env, mean, buffer.duration, beatPeriod, firstBeatSec);
  const structure = trackStructureFromEnvelope(env, onset, mean, buffer.duration, beatPeriod, firstBeatSec, groove, bpmInfo.confidence);
  const key = camelotKey(data, sr);
  const energy = clamp01(mean * 3.4);
  const peaks = waveformPeaks(data, 1400);

  return {
    buffer,
    duration: buffer.duration,
    bpm: bpmInfo.bpm,
    bpmConfidence: bpmInfo.confidence,
    onsetDensity: groove.onsetDensity,
    onsetContrast: groove.onsetContrast,
    grooveScore: groove.grooveScore,
    phraseConfidence: structure.phraseConfidence,
    downbeatConfidence: structure.downbeatConfidence,
    vocalDensity: structure.vocalDensity,
    mixabilityScore: structure.mixabilityScore,
    sections: structure.sections,
    bestEntryWindows: structure.bestEntryWindows,
    bestExitWindows: structure.bestExitWindows,
    beatPeriod,
    firstBeatSec,
    camelot: key.camelot,
    keyConfidence: key.confidence,
    energy,
    peaks,
    introEndSec: cues.introEndSec,
    outroStartSec: cues.outroStartSec,
    mixInSec: cues.mixInSec,
    mixOutSec: cues.mixOutSec,
  };
}

export function trackStructureFromEnvelope(env, onset = onsetEnvelope(env, avg(env)), mean = avg(env), duration = env.length * FRAME, beatPeriod = 0.5, firstBeatSec = 0, groove = {}, bpmConfidence = 0) {
  const phraseSec = Math.max(beatPeriod * 16, 8);
  const windowFrames = Math.max(8, Math.round(phraseSec / FRAME));
  const sections = [];
  const onsetMid = percentile(onset, 0.55);
  const env82 = percentile(env, 0.82);
  let sustained = 0;
  let active = 0;

  for (let start = 0; start < env.length; start += windowFrames) {
    const end = Math.min(env.length, start + windowFrames);
    const envSlice = env.slice(start, end);
    const onsetSlice = onset.slice(start, end);
    const energy = clamp01(avg(envSlice) / Math.max(0.000001, env82));
    const density = onsetSlice.filter((v) => v > onsetMid).length / Math.max(1, onsetSlice.length);
    const startSec = snapToBeat(start * FRAME, beatPeriod, firstBeatSec);
    const endSec = Math.min(duration, snapToBeat(end * FRAME, beatPeriod, firstBeatSec));
    const intro = startSec < Math.min(duration * 0.18, 32);
    const outro = endSec > duration * 0.72;
    const kind = intro
      ? 'intro'
      : outro
        ? 'outro'
        : energy < 0.34 && density < 0.24
          ? 'breakdown'
          : energy > 0.66 && density > 0.28
            ? 'drop'
            : 'groove';
    sections.push({ startSec, endSec, energy, onsetDensity: density, kind });

    for (let i = start; i < end; i++) {
      if (env[i] > mean * 0.78) {
        active++;
        if ((onset[i] || 0) < onsetMid) sustained++;
      }
    }
  }

  const vocalDensity = clamp01((sustained / Math.max(1, active)) * 1.35);
  const phraseConfidence = clamp01((Number(bpmConfidence) || 0) * 1.8 + (Number(groove.onsetContrast) || 0) * 0.34);
  const downbeatConfidence = clamp01((Number(bpmConfidence) || 0) * 1.6 + (Number(groove.grooveScore) || 0) * 0.28);
  const mixabilityScore = clamp01(
    (Number(groove.grooveScore) || 0) * 0.42 +
    phraseConfidence * 0.24 +
    downbeatConfidence * 0.2 +
    (1 - vocalDensity) * 0.14
  );

  const bestEntryWindows = rankWindows(sections, 'entry').slice(0, 4);
  const bestExitWindows = rankWindows(sections, 'exit').slice(0, 4);
  return { phraseConfidence, downbeatConfidence, vocalDensity, mixabilityScore, sections, bestEntryWindows, bestExitWindows };
}

// Downsampled normalized amplitude peaks for a scrolling waveform display.
export function waveformPeaks(data, count = 1400) {
  const peaks = new Float32Array(count);
  const bucket = Math.max(1, Math.floor(data.length / count));
  let max = 0;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * bucket;
    const end = Math.min(data.length, start + bucket);
    for (let j = start; j < end; j += 4) { const v = Math.abs(data[j]); if (v > peak) peak = v; }
    peaks[i] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let i = 0; i < count; i++) peaks[i] = clamp01(peaks[i] / max);
  return peaks;
}

export function energyEnvelope(data, sr) {
  const frame = Math.max(1, Math.floor(sr * FRAME));
  const env = [];
  for (let i = 0; i < data.length; i += frame) {
    let s = 0;
    const end = Math.min(i + frame, data.length);
    for (let j = i; j < end; j++) s += data[j] * data[j];
    env.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  return env;
}

export function smoothEnvelope(env, radius = 5) {
  const out = new Array(env.length).fill(0);
  for (let i = 0; i < env.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(env.length - 1, i + radius); j++) {
      sum += env[j];
      count++;
    }
    out[i] = sum / Math.max(1, count);
  }
  return out;
}

export function estimateBpmFromEnvelope(env, mean = avg(env)) {
  const onset = onsetEnvelope(env, mean);
  const fps = 1 / FRAME;
  const minLag = Math.floor((60 / 190) * fps);
  const maxLag = Math.floor((60 / 60) * fps);
  let bestLag = minLag;
  let best = -Infinity;
  let total = 0;
  let samples = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i + lag < onset.length; i++) score += onset[i] * onset[i + lag];
    score /= Math.max(1, onset.length - lag);
    total += score;
    samples++;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }

  let bpm = (60 * fps) / bestLag;
  let periodFrames = bestLag;
  while (bpm < 90) {
    bpm *= 2;
    periodFrames /= 2;
  }
  while (bpm > 180) {
    bpm /= 2;
    periodFrames *= 2;
  }

  const confidence = clamp01((best - total / Math.max(1, samples)) / Math.max(best, 0.000001));
  return {
    bpm: Math.max(60, Math.min(190, bpm)),
    periodFrames: Math.max(1, Math.round(periodFrames)),
    confidence,
  };
}

export function beatPhase(env, mean, period) {
  const onset = onsetEnvelope(env, mean);
  const pmax = Math.max(1, Math.round(period));
  let bestP = 0;
  let best = -Infinity;
  for (let p = 0; p < pmax; p++) {
    let score = 0;
    for (let k = p; k < onset.length; k += pmax) score += onset[k];
    if (score > best) {
      best = score;
      bestP = p;
    }
  }
  return bestP;
}

export function grooveMetrics(env, onset = onsetEnvelope(env, avg(env)), bpmConfidence = 0) {
  const envP82 = percentile(env, 0.82);
  const onsetP50 = percentile(onset, 0.5);
  const onsetP80 = percentile(onset, 0.8);
  const onsetP95 = percentile(onset, 0.95);
  const activeThreshold = Math.max(onsetP80, onsetP95 * 0.38, 0.00001);
  let active = 0;
  for (const value of onset) if (value >= activeThreshold) active++;
  const onsetDensity = active / Math.max(1, onset.length);
  const onsetContrast = onsetP95 <= 0 ? 0 : clamp01((onsetP95 - onsetP50) / onsetP95);
  const densityScore = clamp01(onsetDensity * 18);
  const confidenceScore = clamp01((Number(bpmConfidence) || 0) / 0.18);
  const energyScore = clamp01(envP82 * 5.5);
  const grooveScore = clamp01(
    confidenceScore * 0.38 +
    densityScore * 0.26 +
    onsetContrast * 0.22 +
    energyScore * 0.14
  );
  return { onsetDensity, onsetContrast, grooveScore };
}

export function cuePointsFromEnvelope(env, mean, duration, beatPeriod = 0.5, firstBeatSec = 0) {
  const threshold = Math.max(mean * 0.62, percentile(env, 0.18));
  let firstEnergy = 0;
  let lastEnergy = env.length - 1;
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= threshold) {
      firstEnergy = i;
      break;
    }
  }
  for (let i = env.length - 1; i >= 0; i--) {
    if (env[i] >= threshold) {
      lastEnergy = i;
      break;
    }
  }

  const introEndSec = snapToBeat(Math.min(duration * 0.25, firstEnergy * FRAME + 8), beatPeriod, firstBeatSec);
  const outroStartSec = snapToBeat(
    Math.min(duration - beatPeriod * 16, Math.max(duration * 0.55, lastEnergy * FRAME - 16)),
    beatPeriod,
    firstBeatSec
  );
  const mixInSec = snapToBeat(Math.max(0, introEndSec - beatPeriod * 8), beatPeriod, firstBeatSec);
  const mixOutSec = snapToBeat(Math.max(duration * 0.45, outroStartSec), beatPeriod, firstBeatSec);
  return {
    introEndSec: clamp(introEndSec, 0, Math.max(0, duration - 1)),
    outroStartSec: clamp(outroStartSec, 0, Math.max(0, duration - 1)),
    mixInSec: clamp(mixInSec, 0, Math.max(0, duration - 1)),
    mixOutSec: clamp(mixOutSec, 0, Math.max(0, duration - 1)),
  };
}

const MAJOR_CAMELOT = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const MINOR_CAMELOT = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

export function camelotKey(data, sr) {
  const windows = [0.25, 0.45, 0.65, 0.82];
  const chroma = new Array(12).fill(0);
  for (const pct of windows) {
    const part = chromaWindow(data, sr, pct);
    for (let i = 0; i < 12; i++) chroma[i] += part[i];
  }
  return camelotFromChroma(chroma);
}

export function camelotFromChroma(chroma) {
  const weights = chroma.map((v) => Math.max(0, Number(v) || 0));
  let best = { score: -Infinity, root: 0, mode: 'major' };
  for (let root = 0; root < 12; root++) {
    const maj = weights[root] * 1.2 + weights[(root + 4) % 12] + weights[(root + 7) % 12] * 0.9 + weights[(root + 2) % 12] * 0.25;
    const min = weights[root] * 1.2 + weights[(root + 3) % 12] + weights[(root + 7) % 12] * 0.9 + weights[(root + 10) % 12] * 0.25;
    if (maj > best.score) best = { score: maj, root, mode: 'major' };
    if (min > best.score) best = { score: min, root, mode: 'minor' };
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const confidence = clamp01(best.score / total);
  return {
    camelot: best.mode === 'major' ? MAJOR_CAMELOT[best.root] : MINOR_CAMELOT[best.root],
    confidence,
  };
}

function chromaWindow(data, sr, pct) {
  const N = 8192;
  const center = Math.floor(data.length * pct);
  const start = Math.max(0, Math.min(data.length - N, center - Math.floor(N / 2)));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const sample = data[start + i] || 0;
    re[i] = sample * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  fft(re, im);
  const chroma = new Array(12).fill(0);
  for (let k = 1; k < N / 2; k++) {
    const freq = (k * sr) / N;
    if (freq < 55 || freq > 2400) continue;
    const pc = ((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12;
    chroma[pc] += Math.hypot(re[k], im[k]);
  }
  return chroma;
}

function onsetEnvelope(env, mean) {
  const onset = new Array(env.length).fill(0);
  for (let i = 1; i < env.length; i++) {
    const rise = env[i] - env[i - 1];
    const accented = env[i] > mean * 1.15 ? env[i] - mean : 0;
    onset[i] = Math.max(0, rise, accented);
  }
  return onset;
}

function snapToBeat(sec, beatPeriod, firstBeatSec) {
  if (!Number.isFinite(sec) || !Number.isFinite(beatPeriod) || beatPeriod <= 0) return sec || 0;
  const beats = Math.round((sec - firstBeatSec) / beatPeriod);
  return Math.max(0, firstBeatSec + beats * beatPeriod);
}

function avg(values) {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
}

function rankWindows(sections, mode) {
  return [...sections]
    .filter((s) => mode === 'entry' ? s.startSec < Math.max(90, sections.at(-1)?.endSec * 0.55 || 90) : s.startSec > Math.max(24, sections.at(-1)?.endSec * 0.28 || 24))
    .map((s) => {
      const grooveFit = clamp01(s.onsetDensity * 2.2);
      const energyFit = mode === 'entry'
        ? 1 - Math.abs(s.energy - 0.48)
        : 1 - Math.abs(s.energy - 0.42);
      const kindFit = mode === 'entry'
        ? (s.kind === 'intro' || s.kind === 'groove' ? 0.24 : s.kind === 'breakdown' ? 0.08 : -0.06)
        : (s.kind === 'outro' || s.kind === 'groove' || s.kind === 'breakdown' ? 0.24 : -0.04);
      return { startSec: s.startSec, endSec: s.endSec, kind: s.kind, score: clamp01(grooveFit * 0.38 + energyFit * 0.38 + kindFit) };
    })
    .sort((a, b) => b.score - a.score || a.startSec - b.startSec);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wre = Math.cos(ang);
    const wim = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cre = 1;
      let cim = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tre = re[b] * cre - im[b] * cim;
        const tim = re[b] * cim + im[b] * cre;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
        const ncre = cre * wre - cim * wim;
        cim = cre * wim + cim * wre;
        cre = ncre;
      }
    }
  }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x) => clamp(x, 0, 1);

import { useEffect, useRef } from 'react';

// Scrolling deck waveform (Rekordbox/Serato style): amplitude peaks, a playhead,
// and a shaded mix-out region. Redraws when `position` changes.
export default function Waveform({ analysis, position = 0, color = '#2dd4bf' }) {
  const ref = useRef();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const w = (canvas.width = canvas.clientWidth * 2);
    const h = (canvas.height = canvas.clientHeight * 2);
    g.clearRect(0, 0, w, h);
    const peaks = analysis?.peaks;
    const dur = analysis?.duration || 0;
    if (!peaks || !dur) return;

    const mid = h / 2;
    const n = peaks.length;
    const prog = Math.min(1, Math.max(0, position / dur));
    const playX = prog * w;
    const mixOut = analysis.mixOutSec ? (analysis.mixOutSec / dur) * w : w;

    // Mix-out region shading
    g.fillStyle = 'rgba(168,85,247,0.14)';
    g.fillRect(mixOut, 0, w - mixOut, h);

    // Bars: played = bright color, upcoming = dim
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w;
      const amp = peaks[i] * mid * 0.94;
      g.fillStyle = x <= playX ? color : 'rgba(255,255,255,0.18)';
      g.fillRect(x, mid - amp, Math.max(1, w / n - 0.5), amp * 2);
    }

    // Playhead
    g.fillStyle = '#ffffff';
    g.fillRect(playX - 1, 0, 2, h);
  }, [analysis, position, color]);

  return <canvas ref={ref} className="h-12 w-full" aria-hidden="true" />;
}

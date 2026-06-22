import { useEffect, useRef } from 'react';
import { useDJ } from '../store.js';

// Full-width reactive spectrum filling the space around the controller. Reads the
// master analyser each frame; subtle so the booth feels alive without clutter.
export default function SpectrumBackdrop() {
  const engine = useDJ((s) => s.engine);
  const ref = useRef();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    let raf;
    const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      g.clearRect(0, 0, W, H);
      const data = engine?.levels?.();
      if (data) {
        const bars = 96;
        const bw = W / bars;
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * data.length * 0.66)] / 255;
          const bh = v * H * 0.7;
          const hue = 168 - i * 0.5; // teal → violet drift
          g.fillStyle = `hsla(${hue}, 70%, 60%, ${0.05 + v * 0.32})`;
          g.fillRect(i * bw, H - bh, bw - 1, bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [engine]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 z-stage h-1/2 w-full opacity-70" aria-hidden="true" />;
}

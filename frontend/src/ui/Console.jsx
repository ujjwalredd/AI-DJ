import { Activity, AudioLines, CircleStop, Disc3, Gauge, Radio, SlidersHorizontal, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDJ } from '../store.js';
import Waveform from './Waveform.jsx';

const fmt = (s) => {
  const v = Math.max(0, Number.isFinite(s) ? Math.floor(s) : 0);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
const eqFill = (db) => Math.max(0, Math.min(1, (db + 30) / 30));

export default function Console({ onStop }) {
  const engine = useDJ((s) => s.engine);
  const setName = useDJ((s) => s.setName);
  const vibe = useDJ((s) => s.vibe);
  const genre = useDJ((s) => s.genre);
  const bpmTarget = useDJ((s) => s.bpmTarget);
  const targetBpmRange = useDJ((s) => s.targetBpmRange);
  const trackCount = useDJ((s) => s.trackCount);
  const status = useDJ((s) => s.status);
  const upNext = useDJ((s) => s.upNext);
  const transition = useDJ((s) => s.transition);
  const [, force] = useState(0);

  useEffect(() => {
    let raf;
    let last = 0;
    const tick = (t) => {
      if (t - last > 90) {
        last = t;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const A = engine?.deckState('A');
  const B = engine?.deckState('B');
  const cross = transition?.progress ?? (A && B ? (B.gain || 0) / Math.max(0.001, (A.gain || 0) + (B.gain || 0)) : 0);
  const bpmRange = targetBpmRange ? `${targetBpmRange.min}-${targetBpmRange.max}` : `${bpmTarget}`;

  return (
    <section className="pointer-events-none absolute inset-0 z-hud flex min-h-dvh flex-col justify-between p-4 sm:p-6">
      <header className="pointer-events-auto flex items-start justify-between gap-4">
        <div className="max-w-[70vw]">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-mint">
            <Radio size={15} aria-hidden="true" />
            Live autonomous set
          </div>
          <h1 className="mt-1 truncate font-display text-2xl font-bold sm:text-4xl">{setName || 'NEXUS Live'}</h1>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-white/[0.62]">
            <span className="rounded-md border border-mint/30 bg-mint/[0.12] px-2 py-1 text-mint">{genre || 'Open format'}</span>
            <span className="rounded-md border border-white/[0.12] bg-black/[0.28] px-2 py-1">YouTube crate</span>
            <span className="rounded-md border border-white/[0.12] bg-black/[0.28] px-2 py-1">{vibe || 'ready'}</span>
            <span className="rounded-md border border-white/[0.12] bg-black/[0.28] px-2 py-1">{bpmRange} BPM</span>
            <span className="rounded-md border border-white/[0.12] bg-black/[0.28] px-2 py-1">{trackCount} tracks</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onStop}
          className="focusable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-red-300/30 bg-red-500/10 px-4 font-mono text-xs uppercase text-red-100 backdrop-blur transition hover:border-red-200/60"
        >
          <CircleStop size={17} aria-hidden="true" />
          Stop
        </button>
      </header>

      <div className="pointer-events-auto grid gap-3 lg:grid-cols-[minmax(220px,320px)_1fr_minmax(220px,320px)] lg:items-end">
        <DeckPanel deck={A} label="Deck A" side="A" target={bpmTarget} />
        <MixerStrip cross={cross} transition={transition} status={status} upNext={upNext} />
        <DeckPanel deck={B} label="Deck B" side="B" target={bpmTarget} />
      </div>
    </section>
  );
}

function DeckPanel({ deck, label, side, target }) {
  const live = deck?.meta && deck?.analysis;
  const pos = live ? deck.position : 0;
  const dur = live ? deck.analysis.duration : 0;
  const prog = dur ? Math.min(1, pos / dur) : 0;
  return (
    <article className={`glass rounded-md p-4 ${deck?.active ? '!border-mint/70' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Disc3 className={deck?.active ? 'text-mint' : 'text-white/[0.45]'} size={19} aria-hidden="true" />
          <h2 className="font-display text-lg font-bold">{label}</h2>
        </div>
        <span className="rounded-md border border-white/[0.12] px-2 py-1 font-mono text-[11px] uppercase text-white/[0.56]">{deck?.state || 'idle'}</span>
      </div>

      <div className="mt-4 min-h-16">
        <div className="line-clamp-2 font-display text-xl font-bold leading-tight">{live ? deck.meta.title : side === 'A' ? 'No record loaded' : 'Cue deck empty'}</div>
        <div className="mt-1 truncate text-sm text-white/[0.55]">{live ? deck.meta.artist || deck.meta.query : 'Waiting for the agent'}</div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
        <Metric icon={Gauge} label="BPM" value={live ? `${deck.meta.bpm}->${target} / ${Math.round((deck.rate || 1) * 100)}%` : '--'} />
        <Metric icon={AudioLines} label="Key" value={live ? deck.meta.camelot : '--'} />
        <Metric icon={Timer} label="Time" value={`${fmt(pos)}`} />
      </div>

      {live && deck.analysis?.peaks ? (
        <div className="mt-3"><Waveform analysis={deck.analysis} position={pos} color={side === 'A' ? '#2dd4bf' : '#a78bfa'} /></div>
      ) : (
        <div className="mt-4 h-2 overflow-hidden rounded-md bg-white/10">
          <div className="h-full rounded-md bg-mint" style={{ width: `${(prog * 100).toFixed(1)}%` }} />
        </div>
      )}
      <div className="mt-2 flex justify-between font-mono text-[11px] text-white/[0.42]">
        <span>{fmt(pos)}</span>
        <span>{fmt(dur)}</span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <EqMeter label="Gain" value={deck?.gain ?? 0} gain />
        <EqMeter label="Low" value={deck?.low ?? 0} />
        <EqMeter label="Mid" value={deck?.mid ?? 0} />
        <EqMeter label="High" value={deck?.high ?? 0} />
      </div>
    </article>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 bg-white/[0.035] p-2">
      <div className="mb-1 flex items-center gap-1 text-white/[0.38]">
        <Icon size={13} aria-hidden="true" />
        {label}
      </div>
      <div className="truncate text-white/[0.82]">{value}</div>
    </div>
  );
}

function EqMeter({ label, value, gain = false }) {
  const height = gain ? Math.max(0, Math.min(1, value)) : eqFill(value);
  return (
    <div>
      <div className="flex h-16 items-end rounded-md bg-white/[0.08] p-1">
        <div className="w-full rounded-sm bg-mint" style={{ height: `${Math.round(height * 100)}%`, opacity: 0.48 + height * 0.52 }} />
      </div>
      <div className="mt-1 text-center font-mono text-[10px] uppercase text-white/[0.45]">{label}</div>
    </div>
  );
}

function MixerStrip({ cross, transition, status, upNext }) {
  return (
    <div className="glass rounded-md p-4">
      <div className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase text-white/[0.42]">
        <span>Deck A</span>
        <span className="flex items-center gap-2 text-mint"><SlidersHorizontal size={15} aria-hidden="true" /> Mixer</span>
        <span>Deck B</span>
      </div>
      <div className="relative h-3 rounded-md bg-white/[0.12]">
        <div
          className="absolute top-1/2 h-7 w-8 -translate-y-1/2 rounded-md bg-mint shadow-[0_0_24px_rgba(45,212,191,0.55)] transition-[left] duration-150"
          style={{ left: `calc(${(cross * 100).toFixed(1)}% - 16px)` }}
        />
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-white/70"><Activity size={16} className="text-mint" aria-hidden="true" /> Transition</span>
          <span className="font-mono text-xs uppercase text-mint">
            {transition?.recipe ? `${transition.recipe.type}${transition.recipe.bassSwap ? ' + bass' : ''} - ${transition.recipe.lengthBars} bars - ${transition.recipe.curve}` : 'armed'}
          </span>
        </div>
        {transition?.tempo && (
          <div className="mb-2 text-center font-mono text-[11px] uppercase text-white/[0.5]">
            Tempo ride {Math.round(transition.tempo.fromBpm)}-&gt;{Math.round(transition.tempo.toBpm)} BPM
          </div>
        )}
        <div className="h-2 overflow-hidden rounded-md bg-white/10">
          <div className="h-full rounded-md bg-mint transition-[width] duration-150" style={{ width: `${transition ? Math.round(transition.progress * 100) : 0}%` }} />
        </div>
        {transition && (
          <div className="mt-1 flex justify-between font-mono text-[11px] text-white/45">
            <span>{Math.round(transition.progress * 100)}%</span>
            <span>{Math.max(0, Math.round(transition.secondsRemaining || 0))}s left</span>
          </div>
        )}
      </div>
      <p className="mt-4 min-h-6 truncate text-center text-sm text-white/[0.58]">
        {upNext ? `Cueing: ${upNext.title || upNext.query}` : status || 'Next mix: 90s or first safe outro phrase'}
      </p>
    </div>
  );
}

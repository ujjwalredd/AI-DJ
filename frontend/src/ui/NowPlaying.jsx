import { useDJ } from '../store.js';
import AITelemetry from './AITelemetry.jsx';

export default function NowPlaying({ onStop }) {
  const nowPlaying = useDJ((s) => s.nowPlaying);
  const upNext = useDJ((s) => s.upNext);

  return (
    <div className="absolute inset-0 pointer-events-none p-8 md:p-12 flex justify-between">
      {/* Left side: Now Playing & Stop */}
      <div className="flex flex-col justify-end">
        <div className="mb-6">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-ink/60 mb-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ink opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-ink"></span>
            </span>
            Live
          </p>
          <h2 className="font-display text-5xl md:text-7xl font-black tracking-tighter text-ink mb-1 drop-shadow-md">
            {nowPlaying?.title || 'Mixing...'}
          </h2>
          <p className="font-display text-xl md:text-2xl font-medium text-ink/80 drop-shadow-sm">
            {nowPlaying?.artist || 'Autonomous AI DJ'}
          </p>
        </div>

        <button
          onClick={onStop}
          className="pointer-events-auto focusable inline-flex h-12 w-fit items-center justify-center rounded-full border-2 border-ink px-6 font-display text-sm font-bold text-ink transition-colors hover:bg-ink hover:text-white backdrop-blur-md bg-white/30"
        >
          Stop Session
        </button>
      </div>

      {/* Right side: Up Next & Telemetry */}
      <div className="flex flex-col justify-between items-end">
        {upNext ? (
          <div className="text-right">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-ink/60 mb-1">Up Next</p>
            <p className="font-display text-lg font-bold text-ink drop-shadow-sm">{upNext.title}</p>
            <p className="font-display text-sm font-medium text-ink/70 drop-shadow-sm">{upNext.artist || 'YouTube crate'}</p>
          </div>
        ) : (
          <div /> // Spacer
        )}
        
        <div className="mt-auto">
          <AITelemetry />
        </div>
      </div>
    </div>
  );
}

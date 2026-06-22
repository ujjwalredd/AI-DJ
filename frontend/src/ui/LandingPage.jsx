import { ArrowRight, Search, Sparkles, Sliders } from 'lucide-react';

const STEPS = [
  { icon: Search, title: 'Search', text: 'Agent finds real tracks on YouTube for your crate.' },
  { icon: Sparkles, title: 'Analyze', text: 'Detects BPM, key and energy, then plans the arc.' },
  { icon: Sliders, title: 'Mix', text: 'Beatmatches and rides the transition like a human.' },
];

export default function LandingPage({ onEnter }) {
  return (
    <div className="flex w-full flex-col px-8 py-10 md:px-16 md:py-16 min-h-full">
      {/* Top bar */}
      <header className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-3">
          <span className="font-display text-xl font-bold tracking-tight text-ink">NEXUS</span>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col justify-center" aria-labelledby="hero-title">
        <div className="max-w-xl">
          <h1 id="hero-title" className="font-display text-6xl font-black leading-[1.05] tracking-tighter sm:text-7xl text-ink">
            Autonomous<br />AI on the decks.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/70 font-medium">
            Pick a crate. NEXUS searches YouTube, analyzes each track, and mixes a continuous,
            beatmatched set — hands on the controller like a real DJ.
          </p>
          <button
            type="button"
            onClick={onEnter}
            className="focusable mt-10 inline-flex min-h-14 cursor-pointer items-center justify-center gap-3 rounded-full bg-ink px-8 font-display text-lg font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Enter the booth
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* How it works */}
      <section aria-label="How it works" className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex flex-col items-start gap-3">
            <span className="text-ink/40">
              <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div>
              <div className="font-display text-sm font-bold tracking-tight text-ink">
                {title}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink/60">{text}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

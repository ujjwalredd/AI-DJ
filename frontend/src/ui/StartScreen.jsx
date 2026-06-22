import { ArrowLeft, Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { useDJ } from '../store.js';
import { loadKey, saveKey } from '../config/apiKey.js';

const GENRES = [
  { label: 'Open format', bpm: 122, prompt: 'open format club set, pop rap house afrobeat, real recognizable songs' },
  { label: 'Pop', bpm: 124, prompt: 'modern pop dance hits, clean radio-friendly energy, real chart songs' },
  { label: 'Rap', bpm: 95, prompt: 'rap and hip-hop club set, hard drums, real released songs' },
  { label: 'House', bpm: 124, prompt: 'deep house and piano house, warm club groove, real released songs' },
  { label: 'Afrobeats', bpm: 105, prompt: 'afrobeats and amapiano party set, smooth percussion, real released songs' },
  { label: 'EDM', bpm: 128, prompt: 'festival EDM and progressive house, peak-time energy, real released songs' },
  { label: 'Latin', bpm: 100, prompt: 'latin club, reggaeton and dance pop, real released songs' },
  { label: 'R&B', bpm: 92, prompt: 'r&b and melodic rap afterparty, smooth but danceable, real released songs' },
];

export default function StartScreen({ onStart, onBack }) {
  const phase = useDJ((s) => s.phase);
  const error = useDJ((s) => s.error);
  const status = useDJ((s) => s.status);
  const [selected, setSelected] = useState(GENRES[0]);
  const [vibe, setVibe] = useState(GENRES[0].prompt);
  const [apiKey, setApiKey] = useState(loadKey);
  const busy = phase === 'loading';

  const onKey = (value) => {
    setApiKey(value);
    saveKey(value.trim());
  };
  const go = () => {
    if (vibe.trim() && !busy) onStart({ vibe: vibe.trim(), genre: selected.label, bpmTarget: selected.bpm });
  };
  const chooseGenre = (item) => {
    setSelected(item);
    setVibe(item.prompt);
  };

  return (
    <div className="flex w-full flex-col px-8 py-10 md:px-16 md:py-16 min-h-full">
      <div className="mb-12 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold text-ink/60 transition-colors hover:bg-black/5 hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <div className="font-mono text-xs font-bold uppercase tracking-widest text-ink/40">Studio Setup</div>
      </div>

      <div className="space-y-10 max-w-xl">
        {/* Genre Selection */}
        <div>
          <div className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
            Pick a crate
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GENRES.map((item) => {
              const active = selected.label === item.label;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => chooseGenre(item)}
                  disabled={busy}
                  aria-pressed={active}
                  className={`min-h-16 rounded-xl border-subtle px-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-ink disabled:cursor-progress disabled:opacity-50 ${
                    active
                      ? 'border-transparent bg-ink text-white shadow-md'
                      : 'bg-white text-ink hover:border-ink/30 hover:bg-platinum'
                  }`}
                >
                  <span className="block font-display text-sm font-bold">{item.label}</span>
                  <span className={`mt-0.5 block font-mono text-[10px] ${active ? 'text-white/60' : 'text-ink/40'}`}>{item.bpm} BPM</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt Direction */}
        <div>
          <label htmlFor="vibe" className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
            Set direction
          </label>
          <input
            id="vibe"
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="pop rap house, real YouTube songs"
            disabled={busy}
            className="min-h-14 w-full rounded-xl border-subtle bg-platinum px-4 text-base text-ink outline-none transition-all placeholder:text-ink/30 focus:border-ink focus:bg-white focus:ring-2 focus:ring-ink disabled:cursor-progress disabled:opacity-50"
          />
          <p className="mt-3 text-sm leading-relaxed text-ink/50">
            The agent searches YouTube with `yt-dlp` for real Artist - Title songs and avoids long DJ mixes.
          </p>
        </div>

        {/* API Key */}
        <div>
          <label htmlFor="apiKey" className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
            Anthropic key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => onKey(e.target.value)}
            placeholder="sk-ant-..."
            autoComplete="off"
            disabled={busy}
            className="min-h-14 w-full rounded-xl border-subtle bg-platinum px-4 font-mono text-sm text-ink outline-none transition-all placeholder:text-ink/30 focus:border-ink focus:bg-white focus:ring-2 focus:ring-ink disabled:cursor-progress disabled:opacity-50"
          />
          <p className="mt-3 text-sm leading-relaxed text-ink/50">
            Leave blank to run the built-in default DJ (curated songs per genre). Add a key for the full AI DJ that digs real in-scene songs and designs every transition. Browser keys stay in session storage.
          </p>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={go}
          disabled={busy || !vibe.trim()}
          className="focusable mt-4 inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-ink px-6 font-display text-lg font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-progress disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? <Loader2 size={20} className="animate-spin text-white/70" aria-hidden="true" /> : <Play size={20} className="fill-white" aria-hidden="true" />}
          {busy ? status || 'Starting set' : 'Start autonomous set'}
        </button>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-800">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

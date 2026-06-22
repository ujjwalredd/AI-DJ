import { Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDJ } from '../store.js';

const STYLE = {
  plan: 'text-ink font-bold',
  mix: 'text-ink/80',
  info: 'text-ink/60',
  warn: 'text-amber-600',
  error: 'text-red-600 font-bold',
};

export default function AITelemetry() {
  const feed = useDJ((s) => s.feed);
  const ref = useRef();
  
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [feed]);

  return (
    <aside className="pointer-events-auto flex w-[320px] flex-col rounded-xl bg-white/70 backdrop-blur-md border border-ink/10 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-ink/40">
        <Terminal size={14} className="text-ink/40" aria-hidden="true" />
        Agent Telemetry
      </div>
      <div ref={ref} className="max-h-[300px] space-y-2 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-ink/10">
        {feed.length === 0 ? (
          <p className="font-mono text-xs text-ink/40">awaiting agent instructions...</p>
        ) : (
          feed.map((item) => <FeedItem key={item.id} item={item} />)
        )}
      </div>
    </aside>
  );
}

function FeedItem({ item }) {
  return (
    <div className={`font-mono text-[11px] leading-5 ${STYLE[item.kind] || 'text-ink/70'}`}>
      <span className="mr-2 opacity-50">&gt;</span>
      {item.text}
    </div>
  );
}

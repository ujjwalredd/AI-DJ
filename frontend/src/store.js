import { create } from 'zustand';

let feedId = 0;

export const useDJ = create((set) => ({
  view: 'landing',
  phase: 'idle',
  status: '',
  error: '',
  engine: null,

  setName: '',
  vibe: '',
  genre: 'Open format',
  bpmTarget: 122,
  targetBpmRange: null,
  arc: '',
  crateStrategy: '',
  phases: [],

  nowPlaying: null,
  upNext: null,
  transition: null,
  trackCount: 0,
  feed: [],

  setView: (view) => set({ view }),
  setEngine: (engine) => set({ engine }),
  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error, phase: 'error' }),
  setPlan: ({ setName, vibe, genre, bpmTarget, targetBpmRange, arc, energyArc, crateStrategy, phases }) =>
    set({ setName, vibe, genre: genre || 'Open format', bpmTarget, targetBpmRange, arc: arc || energyArc || '', crateStrategy, phases: phases || [] }),
  setNowPlaying: (nowPlaying) => set((s) => ({ nowPlaying, trackCount: s.trackCount + 1 })),
  setUpNext: (upNext) => set({ upNext }),
  setTransition: (transition) => set({ transition }),
  pushFeed: (text, kind = 'mix') =>
    set((s) => ({ feed: [...s.feed.slice(-40), { id: ++feedId, text, kind, at: Date.now() }] })),

  reset: () => set({
    phase: 'idle',
    status: '',
    error: '',
    setName: '',
    vibe: '',
    genre: 'Open format',
    bpmTarget: 122,
    targetBpmRange: null,
    arc: '',
    crateStrategy: '',
    phases: [],
    nowPlaying: null,
    upNext: null,
    transition: null,
    trackCount: 0,
    feed: [],
  }),
}));

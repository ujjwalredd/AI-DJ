import { lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
import { useDJ } from './store.js';
import { useDJController } from './dj/useDJController.js';
import LandingPage from './ui/LandingPage.jsx';
import StartScreen from './ui/StartScreen.jsx';
import NowPlaying from './ui/NowPlaying.jsx';

const DJStage3D = lazy(() => import('./three/DJStage3D.jsx'));

export default function App() {
  const view = useDJ((s) => s.view);
  const phase = useDJ((s) => s.phase);
  const setViewStore = useDJ((s) => s.setView);
  const dj = useDJController();
  const live = phase === 'playing' || phase === 'loading';

  const transitionView = (newView) => {
    if (!document.startViewTransition) {
      setViewStore(newView);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => {
        setViewStore(newView);
      });
    });
  };

  return (
    <div className="relative min-h-dvh w-full flex bg-white text-ink overflow-hidden">
      {/* 3D Stage - Persistent right column or Full Screen */}
      <div 
        className={`absolute right-0 top-0 bottom-0 transition-all duration-700 ease-in-out ${
          live ? 'w-full z-0 bg-platinum' : 'hidden md:block md:w-1/2 bg-platinum z-0'
        }`}
        style={{ viewTransitionName: 'dj-stage' }}
      >
        <Suspense fallback={<div className="absolute inset-0 bg-platinum" />}>
          <DJStage3D cameraPhase={view === 'landing' ? 'landing' : !live ? 'setup' : 'live'} />
        </Suspense>
      </div>

      {/* UI Layer - Left column or Full Screen Overlay */}
      <main 
        className={`relative z-hud flex flex-col h-dvh overflow-y-auto ${
          live ? 'w-full items-center justify-center pointer-events-none' : 'w-full md:w-1/2 bg-white/70 backdrop-blur-2xl border-r border-ink/5 shadow-2xl'
        }`} 
        style={{ viewTransitionName: 'main-ui' }}
      >
        {view === 'landing' && <LandingPage onEnter={() => transitionView('dj')} />}
        {view === 'dj' && !live && <StartScreen onStart={(opts) => dj.start(opts)} onBack={() => transitionView('landing')} />}
        {live && <NowPlaying onStop={() => dj.stop()} />}
      </main>
    </div>
  );
}

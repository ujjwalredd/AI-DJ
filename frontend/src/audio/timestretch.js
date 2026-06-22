// Key-locked time-stretch via SoundTouch AudioWorklet. A BufferSource at
// playbackRate = tempo feeding a SoundTouchNode at playbackRate = tempo yields a
// tempo change with the original pitch preserved (CDJ-style master tempo). If the
// worklet can't register (older browser / load error / non-DOM test env), callers
// fall back to a plain BufferSource (pitch shifts, but still beatmatched).
//
// The processor URL is a static `?url` import (just a string — safe in tests and
// emitted by Vite as a standalone asset for AudioWorklet.addModule). The library
// itself is imported dynamically so test/SSR environments without AudioWorkletNode
// don't evaluate it at load time.
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';

const registered = new WeakSet();
let SoundTouchNode = null;

export async function ensureSoundTouch(ctx) {
  if (typeof AudioWorkletNode === 'undefined') return false;
  if (!SoundTouchNode) ({ SoundTouchNode } = await import('@soundtouchjs/audio-worklet'));
  if (!registered.has(ctx)) {
    await SoundTouchNode.register(ctx, processorUrl);
    registered.add(ctx);
  }
  return true;
}

export function createStretchNode(ctx) {
  return new SoundTouchNode({ context: ctx });
}

---
name: ai-dj-artist
description: Professional autonomous DJ performance guidance for DECK9. Use when improving or debugging AI DJ behavior, track selection, beatmatching, phrasing, harmonic mixing, EQ/bass-swap/filter/echo transitions, Web Audio scheduling, real-time controller visuals, or DJ-agent prompts.
---

# AI DJ Artist

## Core Workflow

Load `references/dj-performance-rules.md` before changing DECK9 DJ logic, prompts, audio scheduling, or 3D controller behavior.

Use the reference as a hard constraint set:
- Choose real, released, findable songs in the requested crate.
- Keep tempo rides musical and avoid extreme stretching.
- Preload the next deck early; never wait until silence or the full song outro.
- Mix on phrase boundaries, normally after a 60-90 second performance segment.
- Use bass swap, EQ, filters, echo, or cuts for a clear musical reason.
- Keep the visual controller aligned with the actual model; do not place fake jog wheels over a real controller GLB.

## Verification

After changes, run unit tests, build, and visual tests. For audio-engine changes, include a focused regression test for timing, tempo-rate, or AudioParam scheduling behavior.

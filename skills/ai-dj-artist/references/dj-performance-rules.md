# AI DJ Performance Rules

Use these rules inside the AI DJ Claude agents and while editing the mix engine.

## Research Anchors

- Native Instruments transition guidance: count beats/bars, use eight-bar sections, phrase match, bass swap to prevent muddy low end, and filter fade for busy tracks.
- DJ.Studio mix-structure guidance: tempo/groove compatibility is the base layer, harmonic mixing prevents clashes, and live DJ software depends on preparation plus situational awareness.
- Beatmatching practice: sync tempo and beat phase, cue the incoming deck, keep kicks/percussion aligned, and ride EQ/faders while the mix is live.
- Web Audio scheduling: `setValueAtTime` and `setValueCurveAtTime` need finite non-negative times and valid durations/values; do not schedule overlapping automation events on the same AudioParam.

## Set Identity

The AI is a live DJ, not a playlist generator.

- Use two agent roles:
  - Set Director / crate orchestrator: picks real songs, candidates, energy direction, and a short performance brief only.
  - DJ Artist: never picks songs; it designs live tempo, gain, EQ, filter, effects, bass, phrase, and optional loop automation from real analyzed audio.
- Every selected track must be a real released song query in `Artist - Title` form when possible.
- Avoid long DJ mixes, full albums, interviews, type beats, slowed/reverb uploads, karaoke, covers, and unrelated remixes unless the user asks for them.
- The opener should not be sleepy unless the requested crate is explicitly chill, lounge, ambient, or after-hours.
- Default energy should feel club-ready:
  - Open format, pop, house: 122-126 BPM.
  - EDM: 126-130 BPM.
  - Afrobeats, amapiano, latin: 96-112 BPM, or compatible double-time if needed.
  - Rap and R&B: 88-104 BPM, or compatible double-time if the current set lane is faster.

## Track Selection

Score candidates in this order:

1. Scene fit: language, era, genre, and popularity must match the user request.
2. Fetchability: choose simple YouTube-searchable queries.
3. Tempo ride: ideal playback rate is 0.94-1.06; acceptable is 0.90-1.10; emergency is 0.84-1.16.
4. Harmonic fit: same Camelot code, +/-1 number with same A/B letter, or same number A/B relative major-minor.
5. Energy direction: warmup -> build -> peak -> release, but do not drop energy randomly.
6. Contrast: allow deliberate key/tempo jumps only with filter, echo, or cut transitions.

Always return ranked fallback candidates. Never repeat normalized played titles/artists/queries.

## Post-Fetch Audio Suitability Gate

Claude's suggested query is not enough. After `yt-dlp` fetches a candidate, decode and analyze the real audio before it can be loaded into a deck.

Reject the candidate and try the next ranked query when:

- The upload title/query contains slowed, reverb, sped up, nightcore, lo-fi, acoustic, cover, karaoke, instrumental, 8D audio, or type-beat markers, unless the user explicitly requested that format.
- The beatgrid/BPM confidence is too weak for a live transition.
- The groove/onset score is too low for the current phase.
- The track has low energy and low onset density in a club, pop, house, EDM, open-format, or peak/build context.
- The tempo ride is outside the ideal range and the decoded groove is not strong enough to justify the stretch.

Never force a rejected candidate as a fallback just because it fetched successfully. Ask the agent for a better batch or retry the candidate list.

## Live Timing

The system should always have a next deck armed.

- Start planning and fetching the next deck within the first 8-16 seconds after mix-in.
- Execute the handoff around 60-90 seconds into the current record, or earlier if the first safe outro/mix-out window arrives.
- Avoid waiting until the last 80 seconds of a five-minute track.
- If fetch or analysis is late, use a shorter safe fallback transition instead of silence.
- If the incoming track is not ready, keep the current deck stable and retry candidates; do not schedule a broken transition.

## Real-Time Tempo Adaptation

The genre BPM is only the starting lane, not a fixed playlist tempo.

- Let each analyzed incoming track pull the set tempo gradually when it improves musical fit.
- Keep tempo moves small for smooth blends and bass swaps, normally up to about 3 BPM per transition.
- Allow larger moves for cuts, filter bridges, or echo-out resets when the energy jump is intentional.
- If a strong, requested, or scene-critical track cannot be cleanly beatmatched, do not reject it only for tempo. Use a tempo-lane reset with a controlled `echoOut` or `filterSweep`, then play the incoming song at its proper lane. Use `cut` only when there is no musical runway left.
- Judge candidate suitability against the tempo the engine can realistically reach during the transition, not only the initial genre preset.
- Ramp playbackRate/master-tempo on both decks during the transition so the tempo move is audible and visible.
- Show the tempo move in the UI/feed as a DJ action.

## Phrasing And Cue Points

- Treat four beats as one bar.
- Prefer 8, 16, or 32-bar phrase boundaries.
- Cue incoming audio from `mixInSec`, `introEndSec - 8 beats`, or the first reliable downbeat.
- Align incoming downbeat to outgoing phrase boundary.
- For cuts, snap to the next bar or four-beat boundary.

## Transition Choice

Use these rules to pick the move:

- `blend`: compatible groove/key, low vocal conflict, medium or long overlap.
- `bassSwap`: compatible groove and both tracks have strong low end; outgoing low EQ ramps down while incoming low EQ ramps up.
- `filterSweep`: busy arrangement, key clash, or melodic clutter; incoming starts high-passed and opens while outgoing filters down.
- `echoOut`: outgoing has a vocal/hook/tail or the next track needs a dramatic drop.
- `cut`: fast energy switch, rap/drop edit, or strong downbeat contrast; keep it short and intentional.

## Controller Automation

The controller should never run one generic slow fade for every mix.

- The current playing deck also needs performance, even before a transition:
  - Ride low/mid/high gently based on phrase position, energy, groove, bass, and treble.
  - Build intros by opening filter/highs and bringing bass in gradually.
  - During breakdowns, reduce low/mid clutter and lift highs/filter carefully.
  - Near mix-out, prepare the outgoing deck by easing lows/mids without killing the groove.
  - Use subtle echo only at phrase tails or breakdown lifts; never spam effects.
- Transition recipes should carry explicit automation curves for the controller when possible:
  - `gainAutomation` for both decks is the fader plan.
  - `tempoAutomation` is the real-time pitch/tempo ride.
  - `eqAutomation`, `filterAutomation`, and `effectsAutomation` are used only when musically useful.
  - `loopAction` defaults to disabled. Enable it only for a short, justified phrase/stutter loop.
- Choose fader speed from the musical job:
  - `cut`: hold both decks until the downbeat, then snap the outgoing down and incoming up.
  - `echoOut`: hold the incoming deck back, throw the outgoing tail into delay, then drop the next deck quickly.
  - `bassSwap`: keep both tracks audible but swap lows around the phrase handoff instead of slowly dragging bass for the whole overlap.
  - `filterSweep`: build tension with a staged filter move; do not make it a flat volume fade.
  - `blend`: use a smooth equal-power overlap only when groove/key are compatible.
- Vary `lengthBars` and `curve` per track pair. Fast switches use 4-8 bars; musical blends use 16-32 bars.
- Tempo resets should normally use 8-16 bars with outgoing echo/filter preparation and incoming high-pass reveal. They should not feel like the app suddenly replaced the song.
- EQ moves should happen in small staged windows, not as one long full-transition ramp.
- Controller visuals must read from computed automation curves so faders/knobs/lights match the audible move.
- Never automatically loop during `echoOut`; delay throws and loops are different tools.

## Memory, Critic, And Self Review

The DJ should improve as the set runs, not behave like every track is the first track.

- Use set memory when choosing and mixing:
  - Avoid repeating the same track, obvious duplicate upload, or same artist too often.
  - Notice recent transition scores and avoid repeating a move that was just rough.
  - Keep awareness of the current tempo lane instead of snapping back to a preset genre BPM.
- A Mix Critic/Safety Guard must review every AI transition before execution:
  - Convert risky blends with vocal/key clashes into `filterSweep`.
  - Convert unjustified hard cuts into `echoOut` or `filterSweep` when there is enough runway.
  - Disable loops unless they are short, late, phrase-clean, and explicitly needed.
  - Preserve staged gain/EQ/filter/effect automation so the controller move is visible and audible.
- After every transition, score the result:
  - Penalize silence, premature UI handoff, missing bass-swap EQ, wide non-reset tempo nudges, weak incoming analysis, and random loops.
  - Reward phrase-clean reset bridges, staged controller automation, and compatible bass swaps.
  - Feed that score into the next song and transition decision.

EQ automation should look human:

- Do not leave both lows fully open during overlap.
- Keep mids/vocals controlled if two vocals clash.
- Use high EQ sparingly to reveal hats/percussion without harshness.
- Reset freed deck EQ/filter/echo after transition completion.

## Web Audio Scheduling Guardrails

- Never call `setValueAtTime` at the exact same time on an AudioParam after scheduling a `setValueCurveAtTime` range on that same parameter.
- Before scheduling a new curve or ramp, cancel future values at the transition start.
- Curve arrays must contain at least two finite values.
- Durations must be finite and strictly positive.
- Exponential ramps must never target zero or negative frequencies.
- Start times should be derived from `AudioContext.currentTime` plus a small lookahead, then snapped to beat/phrase.

## Deep Real-DJ Knowledge (energy, harmony, genre, drops, gain)

Researched from working-DJ practice (DJ.Studio, MusicRadar, Pioneer DJ, Vibes, PulseDJ,
TheGhostProduction). Apply this as judgment, not as rigid math.

### Energy is a wave, not a ramp
- A great set has peaks AND valleys. Build tension, hit a peak, let the floor breathe with a
  groovier/deeper track, then build again to a higher peak. Don't sit at max energy the whole time.
- Tension/release works at two scales: inside one transition, and across the whole set arc.
- Set shapes: Journey (slow build + release over a long set), Peak-time (relentless high energy),
  Warm-up (start low, hand over warm), Cool-down (bring it back down). Pick one and commit.
- Place micro-peaks deliberately using each phase's targetEnergy; a planned dip makes the next
  peak feel bigger.

### Harmonic mixing depth (Camelot)
- Floor: same code (perfect), +/-1 same letter (adjacent/a fifth), same number A<->B (relative
  major/minor). These always blend.
- +2 on the wheel (whole-tone/dominant) is a common, slightly brighter move.
- A bigger jump (e.g. +1 semitone / +7 on the wheel) is an ENERGY BOOST - use it intentionally
  to lift into a build or peak, never at random, and lean on a filter/echo to sell it.
- A clashing key is fine if you mix through a filterSweep or echoOut so the two tonalities never
  ring together.

### Tempo lanes & genre conventions (guidance)
- Hold a tight BPM lane. Picking a track far outside the running lane breaks the floor unless it
  is a deliberate reset at a finale/bridge.
- Typical lanes: house ~120-128, tech house/techno ~125-140, disco/funk/nu-disco ~110-122,
  hip-hop/trap ~85-100 (or 140-150 felt half-time), amapiano ~110-115, afrobeats ~100-118,
  reggaeton/dancehall ~90-100, drum & bass ~170-175, Bollywood/desi pop ~95-115, pop ~100-126.
- Half/double-time is the tool for bridging a lane gap (e.g. 90 BPM rap felt as 180 under a
  fast set), not for randomly jumping lanes.
- Per-genre transition feel: house/disco = long harmonic blends + bass swaps; techno = tight
  loops, EQ trims, the occasional clean cut; hip-hop = quick cuts/back-spins on the downbeat;
  dnb = half-time drops and double-drops; afrobeats/amapiano = groove-led blends riding the log drum.

### Drops, phrasing, and "on the one"
- Real phrases are usually 8/16/32 bars - detect them, don't assume 16.
- Cue the incoming so its DROP lands on an outgoing phrase boundary (on the one). The engine
  offsets the incoming start to do this when a confident drop is detected.
- Never drop a new track over a dying vocal or mid-phrase; wait for the boundary.
- Build a short riser (filter/echo/HPF) in the ~2 bars before a drop to telegraph it.

### EQ & filters in transitions
- Cut/swap the bass: two kicks/basslines together = mud. Pull the incoming low, swap lows around
  the phrase handoff. Only one track owns the low end at a time.
- Mids carry vocals/melody - bring them in deliberately and tame them if two vocals clash.
- High EQ reveals hats/air; use sparingly to avoid harshness.
- Low-pass the outgoing down and/or high-pass the incoming up to bridge clashes or save a mix.

### Echo-out & looping discipline
- Echo-out: apply delay/echo to the last beat or vocal, pull the fader down, drop the new track
  from its intro/break. Set the delay to the beat (1/1, 1/2, or 2-beat).
- Loop a stripped section (4 beats of bass/perc) to extend a thin or short section - briefly, and
  only when justified. Loops and echo throws are different tools; don't loop during an echo-out.

### Gain staging
- Level-match tracks before mixing so a loud master doesn't flatten a quieter one (per-deck trim
  toward a shared target). Keep a gentle master limiter/glue to catch overlap peaks - soft knee,
  no pumping.

## 3D Controller Rules

- A real GLB controller owns its jog-wheel geometry. Do not overlay large procedural discs on top of it.
- For real GLB mode, use only subtle status lights, VU meters, crossfader, and small screens unless part detection exists.
- For procedural fallback mode, jog wheels, mixer, labels, knobs, faders, and pads may be built as geometry.
- Disc labels must be centered on the actual jog wheel in fallback mode.
- Long song titles must truncate or scale inside disc/screen textures.
- Controller controls should reflect computed engine automation, not raw stale `AudioParam.value`.

# AI DJ

AI DJ is a self-hosted autonomous AI DJ system. It builds a live set from a plain-language vibe, searches for real tracks with `yt-dlp`, analyzes the decoded audio in the browser, and performs a continuous two-deck DJ mix with Web Audio, React, and a real-time 3D controller UI.

The goal is not a playlist with a crossfade. AI DJ is structured like a DJ crew:

- a Set Director chooses the musical direction and crate strategy
- a Selector picks real, findable next-track candidates
- a DJ Artist designs phrase-aware controller moves
- a deterministic Mix Critic blocks unsafe/random moves before they reach audio
- a real-time performance loop rides EQ/filter/echo while the current song plays
- a post-mix reviewer scores the transition and feeds that memory into the next decision

V1 is designed for local/self-hosted Node deployment because it depends on the `yt-dlp` binary and a writable audio cache.

## Current Capabilities

- Minimal landing page and full-screen DJ booth experience.
- 3D DJ controller scene with two decks, mixer, crossfader, EQ knobs, cue lights, disc labels, and audio-reactive lighting.
- Genre/crate presets such as Open Format, Pop, Rap, House, Afrobeats, EDM, Latin, and R&B.
- Real YouTube search and audio fetch through `yt-dlp`.
- Browser-side Web Audio decoding and analysis.
- Continuous autonomous set loop:
  1. plan set
  2. fetch opener
  3. analyze track
  4. play and perform live controller rides
  5. prefetch next candidate early
  6. design transition from real analyzed audio
  7. schedule phrase-aligned mix
  8. score the result
  9. repeat
- Dynamic tempo-lane handling, including controlled reset bridges for songs that cannot be stretched cleanly.
- Safety rules against random loops, abrupt cuts, duplicate tracks, slowed/reverb uploads, weak beatgrids, and bad AI transition output.

## High-Level Architecture

```
┌──────────────────────────── BROWSER (React + Vite) ──────────────────────────────┐
│                                                                                  │
│  App.jsx ── view: landing │ setup │ live                                         │
│    ├─ LandingPage / StartScreen / NowPlaying  (UI, Zustand store)                │
│    ├─ DJStage3D (react-three-fiber)  ── real CDJ GLB · decks · lights · cameras  │
│    └─ useDJController  ◄── the autonomous "DJ crew" loop ──►                     │
│           │                                                                      │
│           ├─ analysis.js   decode + DSP: BPM · key(Camelot) · energy · groove ·  │
│           │                phrasing · cue points · waveform peaks                │
│           └─ MixEngine (Web Audio)                                               │
│                deck A ┐                                                          │
│                deck B ┘ src → SoundTouch(key-lock) → filter → low/mid/high EQ →  │
│                          gain → crossfader → master → (delay + reverb sends)     │
│                live performance frames · phrase-aligned transitions              │
│                                                                                  │
└───────── HTTP JSON (plan/next/transition/perform) ── HTTP Range (audio) ─────────┘
                                  │
                                  ▼
┌──────────────────────────── NODE / EXPRESS (server.js) ───────────────────────────┐
│  /api/dj/plan       → Set Director   ┐                                            │
│  /api/dj/next       → Selector       │  lib/dj-agents.js  (Anthropic, structured  │
│  /api/dj/transition → DJ Artist      │  tool calls; free-form scene, no hardcoded │
│  /api/dj/perform    → Performance    │  song catalog) → Mix Critic (deterministic │
│                       scripter       ┘  guardrails applied client-side)           │
│  /api/dj/track      → lib/extract.js (yt-dlp ytsearch + fetch, native audio)      │
│  /audio/:id         → range-streams cached audio                                  │
│  security: headers · per-IP rate limit · SSRF guard · per-request API key         │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        ▼
                          cache/  (audio files + <id>.meta.json)
```

### The DJ "crew" (agents + guardrails)
- **Set Director** (`/api/dj/plan`) — reads the plain-language scene, sets crate strategy, energy arc, opener.
- **Selector** (`/api/dj/next`) — ranks real, findable next-track candidates (harmonic + tempo + energy).
- **DJ Artist** (`/api/dj/transition`) — designs the transition from BOTH tracks' real analyzed audio.
- **Performance scripter** (`/api/dj/perform`) — schedules live EQ/filter/echo events while a track plays.
- **Mix Critic** (`professionalizeRecipe`/`critiqueRecipe` in `useDJController.js`) — deterministic guardrails: blocks random loops, unsafe cuts, bad bass swaps, forces tempo-reset bridges.
- **Memory + reviewer** — scores each completed mix and feeds it back into the next decision.

## Runtime Flow

```text
Landing page
  -> Studio setup
  -> User picks crate/vibe and starts
  -> Browser calls /api/dj/plan
  -> Claude Set Director returns set plan + opener queries
  -> Browser calls /api/dj/track
  -> Server uses yt-dlp ytsearch/fetch
  -> Browser decodes audio and runs analysis
  -> MixEngine starts deck A
  -> useDJController runs a 250ms monitor loop
  -> Real-time performance loop rides current deck EQ/filter/echo
  -> Early preload calls /api/dj/next
  -> Selector returns ranked candidates
  -> Browser fetches/analyzes first safe candidate
  -> Browser calls /api/dj/transition with both tracks' analysis
  -> Claude DJ Artist returns transition recipe
  -> Local Mix Critic professionalizes/sanitizes recipe
  -> MixEngine schedules deck B on the beat grid
  -> UI handoff happens at the audible handoff point
  -> Post-mix reviewer scores the result
  -> Memory informs the next pick and transition
```

## AI Agents

AI DJ uses a mix of LLM agents and deterministic local agents. The LLM decides musical intent; local code enforces safety, timing, and audio correctness.

### 1. Set Director

Location: `lib/dj-agents.js` via `planSet`.

Model: `ANTHROPIC_PLANNER_MODEL`, falling back to `ANTHROPIC_MODEL`, then `claude-sonnet-4-6`.

Input:

- user vibe
- selected genre/crate
- optional BPM target

Output:

- `setName`
- `vibe`
- `genre`
- `bpmTarget`
- `targetBpmRange`
- `phases`
- `energyArc`
- `crateStrategy`
- opener query
- fallback opener queries

Purpose:

- establish the set direction
- choose a realistic opener
- define the energy arc
- keep the crate in the requested scene

### 2. Selector / Crate Orchestrator

Location: `lib/dj-agents.js` via `nextMix`.

This uses the same crate-oriented system prompt as the Set Director, but it runs just-in-time while the current song is playing.

Input:

- current track metadata
- current BPM lane
- set phase
- played history
- DJ memory summary
- genre/crate context

Output:

- selected next query
- ranked candidate queries
- track reason
- energy target
- performance brief for the DJ Artist
- one short feed line

Purpose:

- pick real, released, findable songs
- avoid duplicates and bad uploads
- keep the set moving through warmup, build, peak, release, finale
- provide candidates so the browser can retry when `yt-dlp` or analysis rejects a track

### 3. DJ Artist

Location: `lib/dj-agents.js` via `designTransition`.

Model: `ANTHROPIC_PLANNER_MODEL`.

Input:

- outgoing track analysis
- incoming track analysis
- phrase/downbeat confidence
- vocal-density estimate
- mixability score
- best entry/exit windows
- seconds remaining
- current BPM lane
- DJ memory summary
- Set Director performance brief

Output:

- `type`: `blend`, `bassSwap`, `filterSweep`, `cut`, or `echoOut`
- `lengthBars`
- `startPolicy`
- `curve`
- `bassSwap`
- `tempoAutomation`
- `gainAutomation`
- `eqAutomation`
- `filterAutomation`
- `effectsAutomation`
- `loopAction`
- `commentary`
- `fallback`

Purpose:

- design the controller performance for the exact pair of analyzed tracks
- choose tempo nudge, bridge, hold, or reset
- stage faders/EQ/filter/effects
- avoid generic one-speed fades

### 4. Mix Critic / Safety Guard

Location: `frontend/src/dj/useDJController.js` via `critiqueRecipe` and `professionalizeRecipe`.

This is deterministic local code, not an LLM call.

It blocks or repairs:

- random loops
- hard cuts when there is enough runway
- risky vocal/key-clash blends
- bass swaps on weak compatibility
- reset transitions without echo/filter/fader staging
- empty or malformed automation from the model

It may convert:

- risky `blend` -> `filterSweep`
- unsafe `cut` -> `echoOut`
- wide tempo mismatch -> controlled tempo reset bridge

### 5. Real-Time DJ Performance Loop

Location: `frontend/src/audio/MixEngine.js` via `performLive` and `livePerformanceFrame`.

This is deterministic local audio control that runs while a song is playing, before the transition.

It responds to:

- track position
- phrase position
- set phase
- decoded energy/groove
- current bass/treble analyser levels
- intro, breakdown, peak, outro regions

It controls:

- low EQ
- mid EQ
- high EQ
- deck filter
- echo send
- delay feedback

Purpose:

- make the current song feel actively performed
- prepare the outgoing track before transition
- avoid “play one song and sleep” behavior

### 6. Post-Mix Reviewer

Location: `frontend/src/dj/useDJController.js` via `scoreCompletedTransition`.

This is deterministic local scoring after every transition.

It checks:

- whether a tempo reset was bridged correctly
- whether bass swaps had real EQ automation
- whether loops were justified
- whether incoming analysis was weak
- whether tempo movement was too wide without reset

Its score is stored in DJ memory and sent to future agent calls.

### 7. Commentary

Location: `lib/dj-agents.js` via `fallbackCommentary`.

This is a small fast-model path for concise DJ feed text. The main feed also receives deterministic status/recovery/review lines from the browser controller.

## Audio Analysis

Location: `frontend/src/audio/analysis.js`.

The browser decodes each fetched track and extracts:

- BPM estimate
- BPM confidence
- onset density
- onset contrast
- groove score
- beat period
- first beat / beat phase
- Camelot key estimate
- key confidence
- energy
- waveform peaks
- intro end
- outro start
- mix-in cue
- mix-out cue
- phrase confidence
- downbeat confidence
- vocal-density estimate
- mixability score
- rough sections: intro, groove, breakdown, drop, outro
- best entry windows
- best exit windows

This analysis is intentionally local/browser-side so transition decisions are grounded in the actual fetched audio, not only the YouTube title.

## Mix Engine

Location: `frontend/src/audio/MixEngine.js`.

The engine owns the audio graph, deck state, beat/phrase scheduling, tempo movement, and deterministic UI state.

Per-deck graph:

```text
AudioBufferSourceNode
  -> optional SoundTouch worklet
  -> lowpass/highpass filter
  -> low shelf EQ
  -> mid peaking EQ
  -> high shelf EQ
  -> deck gain
  -> master gain
  -> analyser
  -> destination

high EQ output
  -> echo send
  -> shared delay
  -> master
```

Important behavior:

- two decks: A and B
- deck states: `idle`, `loaded`, `playing`, `mixing`, `ending`
- phrase-snapped transition start
- incoming deck starts from analyzed `mixInSec`
- current BPM lane can nudge, bridge, hold, or reset
- active deck changes only at the audible handoff point
- UI values are computed from automation curves, not guessed from raw `AudioParam.value`
- transition recipes are normalized before scheduling
- key-locked time-stretch is attempted through `@soundtouchjs/audio-worklet`; if unavailable, playback falls back to normal Web Audio rate behavior

Transition types:

- `blend`: smooth equal-power overlap for compatible tracks
- `bassSwap`: low EQ swap across phrase handoff
- `filterSweep`: high-pass/low-pass bridge for busy or clashing material
- `echoOut`: delay throw and incoming drop for resets or dramatic changes
- `cut`: short, intentional downbeat switch only when safe

## Frontend Structure

```text
frontend/src/App.jsx
  top-level view routing between landing, setup, and DJ page

frontend/src/ui/LandingPage.jsx
  minimal landing page

frontend/src/ui/StartScreen.jsx
  crate/vibe/API-key setup

frontend/src/ui/Console.jsx
frontend/src/ui/NowPlaying.jsx
frontend/src/ui/Waveform.jsx
frontend/src/ui/AITelemetry.jsx
  performance overlay and DJ feed

frontend/src/three/DJStage3D.jsx
  landing platter and performance DJ controller scene

frontend/src/store.js
  Zustand app state

frontend/src/config/apiKey.js
  optional browser session key handling

frontend/src/dj/useDJController.js
  autonomous set loop, memory, critic, scheduling, recovery

frontend/src/audio/analysis.js
  DSP and cue/structure analysis

frontend/src/audio/MixEngine.js
  Web Audio engine and transition scheduler

frontend/src/audio/timestretch.js
  optional SoundTouch worklet wiring
```

## Backend Structure

```text
server.js
  Express app, security headers, rate limiting, JSON limit, static frontend,
  DJ API routes, SSRF-safe direct URL extraction, audio range streaming.

lib/dj-agents.js
  Anthropic SDK calls, strict tool schemas, plan/next/transition normalization,
  model defaults, local DJ rules injection.

lib/extract.js
  yt-dlp integration, searchAndFetch(query), extract(url), cache IDs,
  cache lookup.
```

## API Reference

### `POST /api/dj/plan`

Creates the initial set plan.

Request:

```json
{
  "vibe": "sunset house, 122 BPM",
  "genre": "House",
  "bpmTarget": 122
}
```

Response includes:

- `setName`
- `vibe`
- `genre`
- `bpmTarget`
- `targetBpmRange`
- `phases`
- `energyArc`
- `crateStrategy`
- `opener`

### `POST /api/dj/next`

Chooses ranked next-track candidates.

Request includes:

- current track metadata
- set phase
- BPM target
- genre
- played history
- memory summary

Response includes:

- `selectedQuery`
- `query`
- `candidates`
- `trackReason`
- `energyTarget`
- `performanceBrief`
- `say`

### `POST /api/dj/transition`

Designs a transition from the real analyzed outgoing and incoming tracks.

Request includes:

- outgoing analysis summary
- incoming analysis summary
- set phase
- BPM target
- memory summary

Response includes:

- transition type
- bar length
- start policy
- curve
- tempo automation
- gain automation
- EQ automation
- filter automation
- effects automation
- loop action
- commentary
- fallback

The browser still runs the returned recipe through the local Mix Critic before scheduling.

### `POST /api/dj/track`

Searches and fetches playable audio with `yt-dlp`.

Request:

```json
{
  "query": "Daft Punk - Digital Love"
}
```

Response:

```json
{
  "id": "a1b2c3d4e5f6",
  "title": "Digital Love",
  "artist": "Daft Punk",
  "duration": 301,
  "audioUrl": "/audio/a1b2c3d4e5f6"
}
```

### `POST /api/song`

Compatibility route for direct URL extraction. It keeps an SSRF guard and only accepts safe external HTTP(S) URLs.

### `GET /audio/:id`

Streams cached audio with Range support.

IDs must match:

```text
^[a-f0-9]{12}$
```

## Environment Variables

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Optional if using UI key | none | Server-side Anthropic key for AI agent calls |
| `ANTHROPIC_PLANNER_MODEL` | No | `claude-sonnet-4-6` | Planning, next-track, and transition model |
| `ANTHROPIC_FAST_MODEL` | No | `claude-haiku-4-5-20251001` | Fast commentary/fallback model |
| `ANTHROPIC_MODEL` | No | none | Backward-compatible model fallback |
| `CACHE_DIR` | No | `./cache` | Audio cache directory |
| `PORT` | No | `3000` | Express server port |

The app can use either:

- a server-side `ANTHROPIC_API_KEY` in `.env`
- a per-user key entered in the UI

Browser-entered keys are stored only in `sessionStorage` and sent per request as `x-anthropic-key`. They are not stored or logged by the server.

## Requirements

- Node.js 20+
- npm
- `yt-dlp` installed on `PATH`
- Anthropic API key through `.env` or the UI

Install `yt-dlp` on macOS:

```bash
brew install yt-dlp
yt-dlp --version
```

## Setup

```bash
npm install
cd frontend
npm install
cd ..
cp .env.example .env
```

Edit `.env` if using a server-side key:

```bash
ANTHROPIC_API_KEY=<your-anthropic-key>
```

For public/shared deployments, prefer leaving the server key unset and letting each user enter their own key in the UI.

## Run

Production-style local run:

```bash
npm run build
npm start
```

Open:

```text
http://localhost:3000
```

Development run:

```bash
npm start
cd frontend
npm run dev -- --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173
```

## Testing And Verification

Unit tests:

```bash
cd frontend
npm run test
```

Visual tests:

```bash
cd frontend
npm run test:visual
```

Build:

```bash
npm run build
```

Security/audit checks:

```bash
npm audit
cd frontend
npm audit
```

Smoke checks:

```bash
curl -i http://localhost:3000/
curl -i -X POST http://localhost:3000/api/dj/track \
  -H 'Content-Type: application/json' \
  --data '{"query":""}'
curl -i http://localhost:3000/audio/not-valid
```

Expected:

- `/` returns `200`
- empty track query returns `400`
- invalid audio ID returns `404`

Manual acceptance:

1. Open the landing page.
2. Enter the booth.
3. Pick a crate such as Pop, Rap, House, or Open Format.
4. Enter a vibe.
5. Provide a valid Anthropic key through `.env` or the UI.
6. Start the autonomous set.
7. Confirm the opener loads and plays.
8. Confirm the disc/deck label shows the current song.
9. Watch the feed for live rides, candidate selection, transition design, critic notes, and post-mix review.
10. Confirm the next song appears on the other deck before the transition.
11. Confirm faders/EQ/filter/tempo visually move with the audible mix.
12. Let it continue across at least three tracks.

## Security Notes

- `.env` is gitignored.
- Do not commit real API keys.
- Current placeholder examples use fake values only.
- Express disables `x-powered-by`.
- Security headers are set without extra dependencies:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
- JSON body limit is `16kb`.
- API routes have a lightweight per-IP in-memory rate limit.
- `/api/song` checks URLs and rejects localhost/private-network targets.
- `/audio/:id` validates IDs before filesystem access.
- Browser-entered Anthropic keys are transient and per-session.

## Deployment Notes

AI DJ V1 should be deployed to a Node host where `yt-dlp` can run and the process can write to a cache directory.

Good targets:

- local machine
- VPS
- Fly.io
- Railway
- Render
- Docker on a server

Poor fit:

- serverless-only hosts where arbitrary binaries and persistent cache writes are restricted

## Known V1 Limits

- YouTube availability and `yt-dlp` behavior can change.
- First fetch of a new song can take several seconds.
- Browser analysis is practical but not a full commercial DJ beatgrid engine.
- Key-lock depends on the SoundTouch worklet being available; otherwise playback-rate fallback may shift pitch.
- Generated mixes are for local/prototype use. This is not a licensed music distribution system.
- The DJ Artist can be guided and corrected, but final mix quality still depends on fetched audio quality and beat/phrase confidence.

## License

MIT. See `LICENSE`.

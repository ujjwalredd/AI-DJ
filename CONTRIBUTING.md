# Contributing to AI DJ

Thanks for wanting to improve AI DJ. This project is a self-hosted prototype for an autonomous DJ system, so contributions should keep three things in mind: audio correctness, user safety, and clear licensing boundaries.

## Development setup

Requirements:

- Node.js 20 or newer
- npm
- `yt-dlp` on your `PATH`
- optional Anthropic API key for full AI-agent mode

Setup:

```bash
npm install
cd frontend
npm install
cd ..
cp .env.example .env
```

Run the production-style server:

```bash
npm run build
npm start
```

Run the frontend dev server alongside the API server:

```bash
npm start
cd frontend
npm run dev -- --host 127.0.0.1
```

## Before opening a PR

Run the checks that match your change:

```bash
npm run build
npm test
npm run audit:all
```

For UI, 3D, layout, or interaction changes, also run:

```bash
npm run test:visual
```

If you cannot run a check because of local machine limits, say that clearly in the PR.

## Pull request guidelines

- Keep PRs focused. One behavior change per PR is easier to review than a large mixed refactor.
- Include screenshots or short screen recordings for UI/3D changes.
- Include before/after notes for audio, transition, or agent behavior changes.
- Add or update tests when changing analysis, scheduling, agent normalization, or API behavior.
- Do not commit generated caches, downloaded audio, local build output, API keys, cookies, or personal config.
- Do not include copyrighted music, model files, or visual assets unless their license allows redistribution and attribution is added.

## Commit style

Use clear imperative commit messages:

```text
Add transition fallback for weak beatgrids
Fix controller label overflow on mobile
Document Railway cache volume setup
```

## Security and secrets

Never commit:

- `.env` files
- Anthropic API keys
- YouTube cookies
- downloaded audio caches
- private model or asset licenses

If you accidentally commit a secret, rotate it immediately before opening a PR.

## Audio and AI behavior expectations

AI DJ should feel like a careful human DJ, not a random playlist player. Changes to the DJ loop should preserve:

- real analyzed audio as the source of mix decisions
- phrase-aware transitions
- deterministic guardrails after any model output
- no random loops or effects without musical reason
- no abrupt UI handoff before the audible handoff
- graceful fallback when AI, network, or `yt-dlp` fails

## License

By contributing, you agree that your contribution is provided under the MIT License used by this repository.

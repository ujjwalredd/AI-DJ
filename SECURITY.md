# Security Policy

## Supported versions

AI DJ is pre-1.0 software. Security fixes are accepted for the current `main` branch.

## Reporting a vulnerability

Please do not open a public issue with exploit details, secrets, or private tokens.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for this repository.
2. If private reporting is not available, open a minimal public issue saying that you need a private contact channel. Do not include the vulnerability details in that issue.

Please include:

- affected commit or version
- reproduction steps
- expected impact
- whether a key, cookie, or user-supplied URL is involved
- any safe proof-of-concept details

## Secret handling

AI DJ can use Anthropic API keys and optional YouTube cookies for `yt-dlp`. These must never be committed.

The project expects:

- server keys in `.env` or deployment environment variables
- browser-entered keys only in `sessionStorage`
- YouTube cookies in `YTDLP_COOKIES_FILE` or `YTDLP_COOKIES_B64`
- no keys, cookies, or downloaded audio in git

If a secret is exposed, rotate it immediately. Removing it from a later commit is not enough.

## Public deployment warning

If `ANTHROPIC_API_KEY` is set on a public deployment, visitors can use your backend AI routes unless you add authentication, quotas, or deployment-level access control. For public demos, prefer leaving the server key unset and letting each user enter their own key in the UI.

## Security-sensitive areas

Review these areas carefully:

- `server.js` API routes, rate limits, and request validation
- `lib/extract.js` `yt-dlp` execution and cache writes
- `/api/song` SSRF guard
- `/audio/:id` range streaming and ID validation
- frontend handling of browser-entered API keys
- any new external asset, model, proxy, or download provider

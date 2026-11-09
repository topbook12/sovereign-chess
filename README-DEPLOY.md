# Sovereign Chess — Vercel Deployment Guide

Sovereign is an **installable PWA**: a full-rules chess arena with an
on-device AI, grandmaster-grade analysis, puzzles, drills, opening lessons
and an Excel data vault. It is engineered to be **cost-effective by
architecture** — the heavy work (engine, analysis, exports) happens on the
player's device, and Vercel serves only static/edge output.

---

## 1. Push to GitHub

```bash
cd my-project
git add -A
git commit -m "feat: PWA-ready chess platform for Vercel"
git remote add origin https://github.com/topbook12/sovereign-chess.git   # once
git push -u origin main
```

> ⚠️ **Rotate your tokens first.** The Turso token and GitHub token used in
> chat were exposed in plaintext. Regenerate them:
> Turso → Dashboard → Tokens, GitHub → Settings → Developer settings →
> Personal access tokens. Never commit `.env` — it is git-ignored already.

## 2. Import into Vercel

1. Open [vercel.com/new](https://vercel.com/new) and import
   `topbook12/sovereign-chess`.
2. Framework preset: **Next.js (auto-detected)** — build command and output
   need no changes.
3. Environment variables (all **optional** — see §3):

   | Key                  | Value                              |
   | -------------------- | ---------------------------------- |
   | `TURSO_DATABASE_URL` | `libsql://game-….aws-ap-south-1.turso.io` |
   | `TURSO_AUTH_TOKEN`   | *(new, rotated token)*             |

4. Click **Deploy**. Done — a `*.vercel.app` HTTPS URL is issued instantly.

### Via CLI instead

```bash
npm i -g vercel
vercel          # link + preview
vercel --prod   # production
```

## 3. Cost architecture (why this is nearly free)

| Layer            | Runs on            | Cost                                  |
| ---------------- | ------------------ | ------------------------------------- |
| Chess engine/AI  | Player's device    | **$0** — no server compute            |
| Analysis/reports | Player's device    | **$0**                                |
| Excel export     | Player's device    | **$0** — SheetJS lazily imported      |
| Static app shell | Vercel CDN + SW    | Free tier (cached on device, too)     |
| Cloud sync       | Turso free tier    | Free tier (batched, single round-trip)|

- **Local-first storage**: games, rating, streaks, achievements live in the
  browser (localStorage/IndexedDB). A service worker caches the whole shell,
  so the arena works **offline** and repeat visits hit the CDN cache.
- **Excel data vault**: one tap exports the entire archive (games + profile)
  to a real `.xlsx` workbook — tiny footprint, human-manageable, and a
  guarantee that data can never be lost.
- **Turso cloud sync is a bonus, not a dependency**: if it is unreachable or
  unconfigured, everything still works and the retry queue drains later.
- On Vercel's serverless filesystem the SQLite mirror is ephemeral — that is
  fine, because device data stays authoritative. Add the Turso env vars to
  make cross-device sync survive cold starts.

## 4. PWA checklist (what you get)

- ✅ `manifest.webmanifest` — name, icons, theme, standalone display
- ✅ Maskable icons for Android adaptive launchers + iOS apple-touch icon
- ✅ Service worker: network-first navigations, cache-first hashed assets,
  offline fallback page (`/offline.html`)
- ✅ In-app **Install** button (header) via `beforeinstallprompt`
- ✅ iOS A2HS support (`apple-mobile-web-app` meta, black-translucent bar)
- ✅ App shortcuts: Play / Analyze / Academy (`/?tab=…` deep links)
- ✅ Online/offline toasts — users always know their data is safe

## 5. Verify after deploy

```bash
curl -s https://your-app.vercel.app/manifest.webmanifest | head -5
curl -sI https://your-app.vercel.app/sw.js | grep -i cache
```

- Chrome DevTools → Application → Manifest: *Installable ✓*
- Lighthouse → PWA audit: *Installable ✓*
- Phone: open the URL → header download-icon → **Install** → launch from
  the home screen, switch on airplane mode and keep playing.

## 6. Updating the app

Bump `VERSION` in `public/sw.js` when shipping changed static assets, then
push — Vercel rebuilds, the new worker takes over and clears old caches on
next visit.

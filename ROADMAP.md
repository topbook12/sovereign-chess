# SOVEREIGN — 100-Day Master Development Plan

> **Platform:** Sovereign — a premium, offline-first PWA gaming platform (Chess · Snake · Ludo · Carrom)
> with a real-value diamond economy, stake duels and a transparent house rake.
> **Currency model:** 1 diamond = 50 BDT · entry-stake duels · winner-takes-raked-pot.
> **Cost philosophy:** local-first data (device owns its records), free-tier cloud (Turso), zero paid infrastructure.

---

## 0. Where we stand today (Day 0 inventory)

| Area | Status |
|---|---|
| Chess vs engine (4 levels, device-side oracle, zero server cost) | Shipped |
| Chess learning suite (puzzles, openings, career, analysis oracle, Excel vault) | Shipped |
| Live Duel room (room codes, socket service, clocks, 3💎 stakes, 1💎 rake) | Shipped (dev) |
| Arcade — **Snake** (6 skins, 4 playground sizes, golden apples, best-score) | Shipped |
| Arcade — Ludo / Carrom | Placeholder cards ("in the workshop") |
| Diamond wallet (starter bonus, ledger, shop, cash-out requests) | Shipped (manual rails pending) |
| Cloud mirrors (games · profile · wallet ledger on Turso, idempotent retry queues) | Shipped |
| PWA (offline play, install, auto-update worker) | Shipped |
| Code health | 20 type errors fixed · tsc clean · ESLint clean · E2E verified (Day 1) |

**The plan turns "shipped" into "business-ready": two more games, real payment rails,
a hardened settlement engine and professional tooling — in 100 days.**

---

## 1. How to read this plan

- **8 phases**, each with a single theme and a hard **gate** (definition of done).
- Three tracks run inside every phase:
  - **BUILD** — user-visible features.
  - **GUARD** — find & fix errors: audits, tests, monitoring (never skipped, never rushed).
  - **SHIP** — deploy, verify on real devices, update the changelog.
- **Weekly rhythm (every Friday, 90 min):**
  1. `bun run lint` + `tsc --noEmit` + dev-log review → fix everything before new work.
  2. Browser E2E pass on iPhone + desktop viewports (all rooms, one full game each).
  3. Turso backup export → local JSON copy (data can never be lost).
  4. Bump the service-worker version if assets changed; push to GitHub.

---

## 2. Phase map (day ranges)

| Phase | Days | Theme | Gate |
|---|---|---|---|
| 1 | 1–10 | Foundation & QA baseline | Zero known bugs · CI green · monitoring live |
| 2 | 11–25 | Match engine + platform ledger | One settlement contract for every game |
| 3 | 26–45 | **Ludo** | 4-player Ludo, stakes live, E2E verified |
| 4 | 46–62 | **Carrom** | Physics-perfect carrom, stakes live |
| 5 | 63–75 | Real-money match rails | Server-validated settlement + rake reports |
| 6 | 76–85 | bKash / cash-out rails | Owner dashboard settles real orders |
| 7 | 86–93 | Hardening & scale | Load-tested, audited, accessible, legal texts |
| 8 | 94–100 | Beta & public launch | 50-player beta → public v1.0 |

---

## 3. Phase detail

### Phase 1 — Days 1–10: Foundation & QA baseline
**Goal:** never chase a phantom bug again. Everything measurable, everything reproducible.

- **BUILD**
  - Snake polish: sound tuning, golden-apple countdown ring, first-play tutorial hint.
  - Arcade lobby stats strip (games played, apples eaten, best per skin).
- **GUARD (advanced tools — first install)**
  - **CI/CD:** GitHub Actions — `lint → tsc → next build` on every push; red build blocks merge.
  - **Error monitoring:** Sentry (free tier) wired into `next.config` + client boundary; every crash arrives with device + stack.
  - **Analytics:** privacy-first page-visit + feature-use counter (self-hosted on the same Turso budget — no third-party cost).
  - **E2E smoke:** the agent-browser checklist from Day 1 becomes a repeatable script (open → play → die → restart → vault).
  - Fix the EADDRINUSE duplicate-dev-server footgun: add a `predev` port guard.
- **SHIP:** version bump v1.3.0, changelog, push.
- **Gate:** CI green on main, Sentry receiving events, zero open defects.

### Phase 2 — Days 11–25: Match engine & the platform ledger
**Goal:** one settlement contract that Chess, Snake, Ludo and Carrom all obey — the rake engine is written once.

- **BUILD**
  - `MatchContract` interface: `entryFee → play → outcome → payouts{winner, loser, house}` — every game plugs in.
  - Rake parameter store (default **25%**, owner-configurable) with per-match audit rows in `wallet_settlements`.
  - **Owner console** (key-gated `/api/admin` view): today's stakes, rake collected, pending orders/withdrawals, per-game breakdown.
  - Daily rollup table `platform_revenue(day, stakes, rake, payouts)` — the "দিন শেষে আমাদের অংশ" ledger.
  - Excel export extended: arcade matches + settlement rows join the chess vault.
- **GUARD:** property tests for the settlement math (draw refunds, consolation credits, rake floor/ceiling); settlement replay tool (re-run any day's rows idempotently).
- **Gate:** two games settle through the same contract in tests; owner console shows correct daily rake.

### Phase 3 — Days 26–45: LUDO (the family giant)
**Goal:** real Ludo — 4 players, bots or friends, same diamonds.

- **BUILD**
  - Rules engine: dice, 6-to-open, captures, safe squares, home stretch, exact-finish; 1v1 and 4-player.
  - Three modes: vs bots · pass-and-play · online (room codes via the duel service, Turso state mirror for Vercel).
  - Premium board art (procedural, theme-consistent), token animations, dice physics feel.
  - Stakes integration: entry fee → raked pot → settlement through the Phase-2 contract.
- **GUARD:** engine test suite (seeded dice scenarios, capture edge cases); device matrix QA (phone/tablet/desktop).
- **Gate:** a full 4-player bot game + a full online duel complete with correct payout on real devices.

### Phase 4 — Days 46–62: CARROM (the physics jewel)
**Goal:** real carrom feel — friction, rebounds, pocketing.

- **BUILD**
  - 2D circle physics (fixed timestep, momentum transfer, friction) — no heavy library, stays offline.
  - Aiming UX: drag-to-power with guide line, striker positioning rule, foul handling.
  - Rules: queen + cover, due points, board reset; 1v1 (pass-and-play first, online second).
  - Stakes integration via the match contract.
- **GUARD:** physics golden-master tests (seeded shots), 60fps budget on mid-range Android.
- **Gate:** a complete board (queen cover + due) plays correctly; 60fps sustained.

### Phase 5 — Days 63–75: Real-money match rails
**Goal:** every stake settlement is server-verified — the client proposes, Turso disposes.

- **BUILD**
  - Server settlement endpoint: validates both sides' ledger rows, applies rake atomically (Turso transaction), writes daily rollup.
  - Stake ladder config (1💎 / 3💎 / 5💎 tables) with min-balance gates.
  - Fraud guards: per-device rate limits, duplicate-settlement rejection (already idempotent), impossible-outcome heuristics.
  - Draw/refund policy enforcement server-side.
- **GUARD:** chaos drills (kill network mid-settlement → replay → zero double-payout); reconcile script compares client vs cloud ledgers nightly.
- **Gate:** 100 simulated duels produce a perfectly reconciled ledger with correct rake.

### Phase 6 — Days 76–85: bKash & cash-out rails
**Goal:** real taka in, real taka out — owner-verified at every step.

- **BUILD**
  - Purchase flow v2: player sends bKash → submits TrxID + sender number → order lands in owner console with one-tap **verify / reject**.
  - Withdrawal SLA panel: request queue, mark-paid log, balance lock while pending.
  - Reconciliation view: bank/bKash statement vs platform ledger, day by day.
  - Gateway evaluation spike (official bKash merchant API sandbox) — decision memo for Phase 8+.
- **GUARD:** double-submission guards, TrxID format validation, admin key rotation support.
- **Gate:** one real end-to-end purchase + one real cash-out settle through the dashboard.

### Phase 7 — Days 86–93: Hardening & scale
**Goal:** boring reliability. The platform survives success.

- **BUILD:** accessibility pass (labels, focus rings, 44px targets audit), i18n strings extraction (EN/BN), responsible-play page (limits, self-exclusion).
- **GUARD (advanced tools — full depth):**
  - Playwright E2E suite in CI (chess move, snake apple, ludo turn, carrom shot, wallet flow).
  - Lighthouse budgets: PWA ≥ 95, perf ≥ 85 on mid-tier mobile profile.
  - Load drills: Turso read/write pattern audit + index tuning; API rate-limit review.
  - Security review: admin key handling, input validation sweep, dependency audit (`bun audit`).
- **Gate:** all budgets green in CI; zero critical findings.

### Phase 8 — Days 94–100: Beta → public launch
**Goal:** hand it to real players, listen, fix, open the gates.

- Beta cohort (50 players) via install link; feedback channel in-app.
- Fix list burn-down (48h SLA on crashers).
- Packaging: Android TWA (Bubblewrap) for Play Store listing; iOS install guide.
- Launch-day runbook: rollback plan, SW version pin, Turso backup, war-room checklist.
- **Gate:** public v1.0 live with KPI dashboard (D1 retention, duels/day, rake/day, crash-free ≥ 99.5%).

---

## 4. The advanced-tools stack (what makes this "pro")

| Tool | Purpose | Cost |
|---|---|---|
| GitHub Actions CI | lint + types + build gate on every push | Free |
| Sentry | crash monitoring with device context | Free tier |
| Playwright (CI) | browser E2E per game + wallet | Free |
| Lighthouse CI | perf / PWA budgets on every deploy | Free |
| Turso (existing) | ledger, settlements, rollups, mirrors | Free tier |
| Excel vault (existing) | owner + player offline backups | Free |
| Nightly reconcile script | client vs cloud ledger diff | Free |

Everything runs on free tiers — the cost-effectiveness rule holds for tooling too.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Turso free-tier limits under growth | Medium | batched writes (already), rollups, index audit (Phase 7) |
| Payment disputes (manual TrxID) | Medium | owner double-check queue + full audit log (Phase 6) |
| Double payouts on crash | Low | idempotent settlement keys (live) + server validation (Phase 5) |
| Physics scope creep in Carrom | Medium | fixed-timestep minimal model first; juice later |
| Play Store gambling-policy friction | Medium | position as skill-gaming per BD norms; legal text in Phase 7; TWA fallback stays |
| Solo-dev schedule slip | High | every phase ships something usable; gates can flex ±3 days without reordering |

---

## 6. Milestone calendar (one line per week)

- **W1 (D1–7):** error audit done (20 fixes) · CI + Sentry live · snake polish
- **W2 (D8–14):** E2E smoke scripted · owner console skeleton
- **W3 (D15–21):** MatchContract + rake parameter store
- **W4 (D22–28):** platform_revenue rollups · Ludo engine started
- **W5 (D29–35):** Ludo rules complete (bots)
- **W6 (D36–42):** Ludo online duels + stakes
- **W7 (D43–49):** Ludo polish gate · Carrom physics started
- **W8 (D50–56):** Carrom aiming + rules
- **W9 (D57–63):** Carrom stakes + gate · settlement endpoint started
- **W10 (D64–70):** server-validated settlement + fraud guards
- **W11 (D71–77):** reconciliation drills · bKash verify queue
- **W12 (D78–84):** withdrawal SLA panel · reconcile view
- **W13 (D85–91):** Playwright CI suite · Lighthouse budgets · legal texts
- **W14 (D92–98):** beta cohort + fix burn-down · TWA packaging
- **W15 (D99–100):** public v1.0 launch + KPI dashboard

---

## 7. Economy constants (single source of truth)

| Constant | Value |
|---|---|
| Diamond price | 50 BDT each |
| Starter bonus | 6 💎 (configurable) |
| Duel stake | 3 💎 per side → 6 💎 pot |
| Rake (house) | 1 💎 of 6 (~25%, owner-tunable from Phase 2) |
| Winner net | +1 💎 · Loser consolation: +1 💎 (net −2) · Draw: full refund |
| Withdrawal min | 10 💎 (500 BDT) — configurable |

---

*Prepared Day 1 — after the full-platform audit. Every phase gate includes the standing rule:
**find and fix all errors before new features ship.***

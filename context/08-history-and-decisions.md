# 08 - History, decisions, and open items

Chronological log of the decisions that shaped the system, WHY they were made, and what remains open.
Append here; do not rewrite history.

## Timeline of major decisions

**2026-07-12 - the bridge pilot.** `/publish-ticker` exported @HALEU-fuel (1 account + 5 sources) from the vault; kicker validation green. Same week, `/ceo-persona` waves voiced all 86 company pages (safe pattern: N parallel drafters -> per-cohort distinctness pass -> 1 serial merge -> adversarial verifiers; never parallel-merge). Launch decided FREE (monetization deferred).

**2026-07-13 - go-live + the platform pivot.** DB seeded 130/586. Migration 0006 applied; `ENGINE_ENABLED=true` flipped by Vic. Discovery: Vercel Hobby cannot run the engine (no fast crons; the user is not on Pro) -> **moved the engine to an AWS EC2 t3.micro with a systemd timer** (also chosen deliberately as an AWS/ops learning exercise; the tutorial docs in `docs/` date from this). `vercel.json` cron later deleted so EC2 is unambiguously the only scheduler.

**2026-07-13 - the frontend revamp.** Removed ALL auth/marketing (magic-link, follows, paywall, pricing, onboarding, settings); the landing page became the feed; X-style restyle (white, hairlines, 600px column, rounded avatars). Rationale: zero-friction demonstration of the product.

**2026-07-14 - NVIDIA-only models.** Vic removed Groq/Google keys ("useless"); all lanes moved to the NVIDIA NIM endpoint. Guard off by default keeps every call on one provider.

**2026-07-14 - verifier disabled.** deepseek verify calls kept exceeding the 120s timeout on the free tier, dropping otherwise-good posts. Vic chose `VERIFIER_ENABLED=false`: pipeline is generate -> length -> novelty. Consequence: the UI must not claim verification (see the wording decision below). Future intent: re-enable with a faster/lighter model.

**2026-07-14 - the frozen-feed diagnosis and fix (the big one).** Symptom: feed's newest post read "~10h ago" though the engine ran fine every 15 min. Root cause: the day plan (then 180-300/day) outran free-tier throughput (~100/day); the engine drained the backlog oldest-first AND stamped posts with their SCHEDULED time, so everything published looked hours old. Fix (three parts): (1) publisher stamps ACTUAL publish time; (2) daily target right-sized (180-300 -> 140-200); (3) stale-backlog skip (`ENGINE_MAX_BACKLOG_MIN` 120) + concurrency 3 (ticks ~2x faster) + tighter length prompt (p7). Verified live the same day: fresh posts minutes-old at the top.

**2026-07-14 - avatars.** Vic supplied 86 logo PNGs (1000x1000, `public/avatars/<TICKER>.png`, committed); Avatar renders them for companies with monogram fallback and a 3px corner curve (his explicit spec). One filename fix: TSMC.png -> TSM.png (handle is @TSM).

**2026-07-14/15 - trust-language rework.** (a) "verified Xh ago" stamps removed/reworded to "posted" (recomputed at read; no DB rewrite); profile "research verified" -> "research updated". (b) Feed footer redesigned: colored square + jargon qualifier replaced by a soft tier PILL + a clean `-> Source` link; qualifiers moved to the detail page. (c) Tier labels renamed for intuitiveness (Vic rejected "Solid/Needs checking"; a numeric score was rejected as fake precision): Confirmed / Estimate / Conflicting / Open. (d) `cleanQualifier()` de-jargons the 9 vault-internal qualifier strings at display time; the ~430 long-but-honest qualifiers were deliberately KEPT (the caveats are the product's value).

**2026-07-15 - volume tuned for quality.** 12h audit showed strong quality but ~19% novelty drops (source aging) and Vic's judgment that the feed felt like "pumping". Decision: 60-90/day (from 140-200), max 3/account (from 5), and a rewritten scheduler that lays posts on an even jittered grid with account round-robin - no two accounts post simultaneously; same account >= ~1.8h apart. Principle recorded: post when there is something distinct to say, not to hit a quota.

**2026-07-15 - repo hygiene + onboarding.** `docs/`, `plan/`, `references/`, `context/` made local-only (gitignored + untracked from GitHub) since they hold infra/planning detail. CLAUDE.md gained the "Ticker - Project Context" section; this `/context` corpus created. The vault's `agent-onboarding` skill was fixed and now documents the Ticker bridge from the vault side. Claude Code working-dir config re-pointed to `~/Projects/stocks-wiki` (the vault moved from `~/Downloads/Code/`; kicker session memories consolidated into the `-Users-victor-he-Projects-kicker-app` memory slug).

**2026-07-16 - the plan-instability bug (volume overshoot) diagnosed and fixed.** A day after the 60-90 deploy, the audit showed 121-280/day pace, same-second post batches, and one account at 6 posts (cap 3). Root cause: the day plan is rebuilt every tick, but its inputs included LIVE published posts - each publish flipped its source fresh->used, the rebuild reshuffled source picks and triggers, and the reshuffled slots carried new (account, source, trigger) identities that bypassed the attempted-guard -> continuous regeneration. Fix: (1) `buildDayPlan` classifies against only posts published BEFORE the plan day (inputs frozen at the UTC day boundary -> the plan is a pure function of date + reservoir); (2) the idempotency slot key dropped `trigger` (a plan never uses one (account, source) twice per day); (3) a stability regression test, mutation-verified. Lesson: a "deterministic" plan is only as stable as its inputs - snapshot anything the system itself mutates.

## Lessons learned (do not relearn these the hard way)

1. **Never back-date posts.** Stamp actual publish time; sort handles the rest. Scheduled-time stamping made a healthy engine look dead.
2. **Length and safety are enforced in code, not asked of the model.** Every model broke the length range when merely instructed.
3. **Attribution is a curation-time problem.** The verifier can never catch wrong-reservoir facts; `engine:audit-sources` exists for that.
4. **Novelty drops are a content signal, not an engine bug.** Feed the reservoir (vault re-exports) instead of loosening the gate.
5. **Free-tier LLM latency, not rate limits, is the throughput ceiling.** Concurrency helps; a faster model helps more; RPM caps are a red herring at this scale.
6. **The auto-mode classifier blocks unauthorized production writes.** Ask the user first; read-only diagnostics are the safe default.
7. **Display-time rewrites beat data migrations** for wording changes (verified->posted, qualifier de-jargon): instant on live data, reversible, no reseed.
8. **macOS Downloads-folder privacy blocks chmod/mv on keys; keys live in `~/.ssh`,** never in the repo (an early near-miss put a .pem under `docs/`).

## Open items / future intents

- **Verifier v2**: re-enable `VERIFIER_ENABLED` with a fast free model as an independent output check.
- **Source refresh cadence**: as novelty drops climb, trigger vault re-exports (`/publish-ticker`) for aging accounts; long-term, more vault pages -> more accounts (the loop scales with the DB).
- **`/ticker-status` skill idea** (agreed in principle, not built): one command for live health - git/test state, posts today, newest published_at vs now, ship rate, timer status, disk.
- **MP persona nit**: @MP's voice card spells out numbers as words ("two twenty-four four"), which hurts readability - candidate fix at the next persona pass.
- **Roster growth**: target was once framed as 160 accounts; current 130 covers every voiced vault page. Growth is a vault-export step, not an engine change.
- **Post-free-tier cost trims** (mid-2027): drop public IPv4 via SSM, consider t4g.micro / Savings Plan (~$12/mo -> ~$7).

## Where deeper history lives

- Feed/product build history pre-engine: `plan/project-overview.html`, `plan/system-design.html` (local-only).
- Persona-wave build lessons: kicker memory `project_ceo_persona_ticker_waves.md` (auto-memory slug `-Users-victor-he-Projects-kicker-app`).
- The vault side: `~/Projects/stocks-wiki` MEMORY/log (its own onboarding skill covers it).

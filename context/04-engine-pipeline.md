# 04 - The tweet generation pipeline (src/lib/engine/)

The engine turns tier-tagged vault sources into published posts.
Design philosophy: **deterministic code decides WHAT and WHEN; models only supply WORDING; safety gates fail closed; quality gates fail open.**

## Stage 0 - the reservoir

The only content input is Supabase `sources` (seeded from `content/sources.json`, exported from the vault).
The engine never fetches anything external.

## Stage 1 - the day plan (`daily.ts`)

`buildDayPlan()` builds ONE deterministic schedule per UTC date (seeded RNG from `dateKey + SCHEDULE_SEED`), so crashed/re-run ticks rebuild the identical plan and upsert over themselves.
Critically, its inputs are FROZEN at the day boundary: fresh/used classification and conversation-partner picks use only posts published before the plan day (`prior` filter), so intraday publishes cannot reshuffle the plan (the 2026-07-16 overshoot bug); and the idempotency slot key is `(account, source)` WITHOUT trigger, so a trigger flip can never re-enter a slot as new work. `daily.test.ts` "is STABLE across intraday publishes" guards this.

- Daily total drawn uniformly from **60-90** (`ENGINE_TARGET_MIN/MAX`). Deliberately low: quality over quantity, and it keeps each account inside its fresh-source supply.
- **Volume expectation (decision 2026-07-18, floor widened 2026-07-20):** 60-90 is a SLOT target; the novelty/length gates eat ~2/3 of candidates by design, so **~30-60 published/day is the accepted healthy range** (pipeline_health flags below 30). Raising published volume = deeper vault re-exports (more fresh sources), NOT widening the band or the novelty ceiling.
- **Heavy-tailed allocation** (lognormal weights): some accounts busy, most post once or twice, a real fraction stay silent that day. Hard cap **3/account/day** (`ENGINE_MAX_PER_ACCOUNT`), also capped by the account's source count.
- **Cadence buckets (2026-07-17):** an account's optional `cadence` field (`more` 2.0x / `normal` 1.0x / `less` 0.4x weight, `DAILY.cadenceWeight`) scales its lognormal draw - a standing bias, still random per day. `less` accounts are additionally capped at **1/day** (`DAILY.cadenceCapLess`). The day total stays inside the band; buckets only redistribute it. validate-content warns when `more` sits on an account with <6 sources (recycling risk).
- Source pick per account: fresh (never-referenced) sources first = trigger `ingest`; already-referenced = `rotation`; ~15% chance to reply to a supply-chain sibling with a recent post = `conversation`.
- **Timing (the even-spread design, 2026-07-15):** all posts are laid on an even, jittered grid across the full 24h, with accounts round-robined. Guarantees: no two accounts post at the same moment (gaps ~12-38 min at 60/day), and one account's posts land hours apart (>= ~1.8h). Jitter stays inside the front 60% of each slot so consecutive posts keep >= ~0.4x slot spacing.

## Stage 2 - the tick (`runner.ts`, entry `scripts/engine-tick.ts`)

Runs as a GitHub Actions cron (`engine-tick.yml`; scheduled */15 but throttled by GitHub to ~hourly with 2-4h gaps - accepted, see 07-operations). Each tick:

1. Rebuilds today's plan, loads slots already attempted this run (`loadAttemptedSlots` - the idempotency guard; a slot is generated exactly once per day).
2. Slices to slots inside `[now - ENGINE_MAX_BACKLOG_MIN, now + ENGINE_LOOKAHEAD_MIN (90)]`, capped at `ENGINE_MAX_PER_TICK` (8). The backlog floor makes a behind engine ABANDON stale slots and stay near wall-clock instead of draining an hours-old queue (the "frozen feed" fix). Code default 120 min; the workflow sets 360 so slots stuck behind a long dispatch gap publish late instead of dropping.
3. Screens each unique source once (guard cache), then generates items in chunks of `ENGINE_CONCURRENCY` (3) - concurrency roughly halved tick duration vs serial.
4. Persists candidates incrementally per chunk (kill-resilient: a tick killed at timeout keeps finished work) with a soft wall-clock budget (`softBudgetMs` 240s: stop STARTING new work, let in-flight finish).
5. Fallback resilience: if EVERY lane dropped an item (model hiccup), retry once on the secondary lane. Sibling near-duplicates from one source collapse via Jaccard >= 0.6 (`dedupeSiblings`).
6. Then the tick publishes due slots (below).

## Stage 3 - the per-candidate pipeline (`pipeline.ts`)

`guard -> generate -> length -> (verify) -> novelty`, up to `1 + MAX_REGENERATIONS(3)` attempts with targeted retry hints.

| Gate | Kind | Behavior |
|---|---|---|
| Guard (`guard.ts`) | safety, fail-CLOSED | Prompt-injection classifier on the SOURCE, chunked ~1500 chars; score >= threshold QUARANTINES (never silently drops). **OFF by default** (`GUARD_ENABLED != 'true'`) - sources are curated vault content, and off keeps the engine NVIDIA-only. |
| Generate (`prompts.ts` generatorSystem/Prompt) | - | Absolute rules: re-express ONLY the given source; preserve hedges; no buy/sell; speak ABOUT the subject in the account voice; 140-600 chars aiming 300-450 ("2 to 4 sentences"). Prompt carries persona card, bio, KEY FACT (pre-selected deterministically), recent posts, reply context, retry hint. `PROMPT_VERSION p7.2026-07-14` stamps provenance. |
| Length (`lengthGate.ts`) | code-enforced | 140-600 chars. Never trusted to the model (all models broke it when merely asked). Regenerate with a targeted hint, else drop. |
| Verify (`prompts.ts` verifier*) | safety, fail-CLOSED, **currently OFF** | Independent adversarial fact-check (claims_traceable, hedges_preserved, invented_numbers, buy_sell_language, persona_identity_ok). `VERIFIER_ENABLED=false` in prod (deepseek too slow on free tier -> timeout drops). When off, a length-valid generation ships with `verdict=null`. Future: re-enable with a faster model. |
| Novelty (`novelty.ts`) | quality, fail-OPEN | Embedding cosine vs the account's recent published posts (`post_history`, limit 40); >= 0.90 similarity drops. An embedding-infra error passes (a repeat is not a fabrication). |

Every outcome lands in `engine_candidates` with status `verified | dropped | quarantined` + reason - the human review trail.

## Stage 4 - the publisher (`publisher.ts`)

The ONLY path to the public `posts` table. Hard safety contract:

- Refuses unless `ENGINE_ENABLED=true` (preview mode computes without writing).
- Idempotent: deterministic post id `p-<day>-<acct>-<src>-<trigger>`; `published_at is null` guard; write order posts-first-then-stamp so a crash can only re-upsert the same id.
- ONE post per slot: if multiple lanes verified, highest lane priority wins; all siblings get stamped against the same post id.
- Reply-safety: a conversation reply ships as a reply only if the parent handle already has a published post; else standalone.
- **Timestamps: `published_at`/`postedAt` = the ACTUAL publish moment (`nowMs`), never the scheduled slot time.** This was the fix for the frozen-feed bug (back-dated posts made a live feed look 10h stale). `seq` keeps scheduled-order within a batch.
- Best-effort novelty memory: embeds each published body into `post_history` (failure never fails a publish).

## Models (`models.ts`, `config.ts` lanes)

All calls go through the Vercel AI SDK; provider swap = config change.
Production is **NVIDIA-only** (`MODEL_BASE_URL` -> NIM OpenAI-compatible endpoint, `MODEL_API_KEY`):

| Lane | Model (prod) | Role | Observed ship rate |
|---|---|---|---|
| primary | `nvidia/nemotron-3-ultra-550b-a55b` | generator | ~74% |
| secondary | `openai/gpt-oss-120b` (via NIM) | fallback retry | ~40% |
| verifier | `deepseek-v4-pro` | OFF (`VERIFIER_ENABLED=false`) | - |
| embeddings | `nvidia/nv-embedqa-e5-v5` (1024-dim, input_type passage) | novelty | - |

- Per-call timeout 120s (`MODEL_CALL_TIMEOUT_MS`) - a stalled free-tier call aborts into the retry/drop logic instead of hanging a tick.
- Throughput truth: the constraint is **latency** (a reasoning generation takes tens of seconds), NOT the 40 RPM account limit - the engine peaks well under it.
- Lane override syntax: `nim:<model>[:maxTokens[:pacingMs]]`. Groq/Google providers exist in code but are unused (Groq needs a browser User-Agent header; kept for potential future use).

## Curation-time + review tooling (scripts/)

- `engine:audit-sources` - attribution audit (`attribution.ts`): does every fact in a source belong to THIS account's first person? Catches landlord/tenant-style inversions the verifier cannot (facts trace fine; they are just in the wrong reservoir). Run on every content import. Rate-limit-brittle; judgment calls stay human.
- `engine:dry-run` - full pipeline, never publishes.
- `engine:review` / `engine:reveal` - blind A/B rating of candidates (model hidden behind deterministic A/B/C labels via `blind.ts`), then reveal the mapping.
- `engine:poison` - prompt-injection regression test.
- `engine:publish` - manual publisher, preview-by-default, `--live` to ship (still gated).

## Config knob table (all env-overridable, safe defaults in `config.ts`)

| Knob | Default | Meaning |
|---|---|---|
| `ENGINE_TARGET_MIN/MAX` | 60 / 90 | daily band |
| `ENGINE_MAX_PER_ACCOUNT` | 3 | per-account daily cap |
| `ENGINE_LOOKAHEAD_MIN` | 90 | pre-generate slots due within N min |
| `ENGINE_MAX_PER_TICK` | 8 | slot cap per tick |
| `ENGINE_CONCURRENCY` | 3 | parallel generations per tick |
| `ENGINE_MAX_BACKLOG_MIN` | 120 | abandon slots older than N min |
| `ENGINE_SOFT_BUDGET_MS` | 240000 | stop starting new work after N ms |
| `ENGINE_HISTORY_LIMIT` | 40 | novelty memory depth per account |
| `NOVELTY_MAX_SIMILARITY` | 0.90 | cosine drop ceiling |
| `SIBLING_MAX_SIMILARITY` | 0.60 | Jaccard sibling-dedup ceiling |
| `LENGTH` | 140-600 | hard char gate |
| `MAX_REGENERATIONS` | 3 | retries after a gate failure |

## Known behaviors to expect

- Ship rate ~2/3; the largest drop reason is novelty (near-duplicates) - that is the system telling you the account's sources are aging. The fix is CONTENT (fresh vault exports), not engine tuning.
- gpt-oss fallback is noticeably weaker than nemotron; it exists for resilience, not quality.
- A tick logs one line each for start / generated / published / done - `journalctl -u ticker-tick.service` is the engine's heartbeat.

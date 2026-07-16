## General Guidelines

- Never use the em dash "—". Use plain dash "-" instead
- Never manually modify CHANGELOG.md files or any files that are marked as auto-generated
- When writing or substantially editing long Markdown files, put each full sentence on its own line.
  Preserve normal Markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost.
  Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would see it.
  This makes sure you find the real problem so your fix will actually solve it.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
  If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along the way.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
  If you see one, even if it is not caused by what you are working on right now, still get it fixed.

---------

## Core Principles

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---------

## Git Policy
- **DO NOT** commit any changes to GitHub or create any pull requests.
- Just implement the code — the user will handle all git operations (commits, pushes, PRs) themselves.

---------

## Ticker - Project Context (read before any task)

**Deep-dive onboarding corpus: `context/` (local-only, gitignored).**
Read `context/README.md` for the index; this section is the compact map, `context/` is the full territory (architecture, data model, engine pipeline, UI/UX rationale, vault bridge, ops, decision history).
For a guided full onboarding (read order + live-state checks + roadmap position), invoke the `/agent-onboarding` skill.

Ticker is a public, X-style feed where every page of the user's private research vault (stocks-wiki) becomes an AI persona account that self-tweets tier-tagged, source-grounded posts.
There are no human users, no sign-in, and no engagement mechanics: 130 accounts (86 companies + 15 supply-chain chokepoints + 29 themes) posting autonomously.
Live at <https://kicker-app-v1-0-5.vercel.app/>.

### The three-plane architecture

| Plane | What runs there | Notes |
|---|---|---|
| Engine | AWS EC2 t3.micro (`us-east-1`), systemd timer `ticker-tick.timer` fires `pnpm engine:tick` every ~15 min | Generates + publishes tweets; Vercel Hobby cannot run this |
| Data | Supabase Postgres (`accounts`, `sources`, `posts`, `engine_candidates`, `post_history`) | The ONLY coupling between planes |
| Frontend | Next.js App Router on Vercel (Hobby) | Feed-first, no auth; ISR ~5 min; auto-deploys on push to `main` |

### The content bridge (stocks-wiki -> here, strictly one-way)

- The vault lives at `~/Projects/stocks-wiki`.
  Its `/publish-ticker` skill exports vault pages into `content/*.json` here (accounts, ~586 tier-tagged sources, research pages); its `/ceo-persona` skill builds each company account's voice card from real earnings-call transcripts.
- `pnpm db:seed` pushes `content/` into Supabase.
  Seeding is user-gated: ask before running it.
- **Never write back to the vault from this project.**
  Nothing proprietary crosses the bridge: no thesis content, no positions, no P&L, no price targets, no valuation multiples.
- Fresh vault ingests are the engine's fuel supply.
  When sources go stale, accounts start repeating themselves and the novelty gate rejects the repeats.
- Coverage check: `pnpm check:accounts` (the `/check-accounts` skill) lists vault pages with no Ticker account yet.
  The join key is each account's `vault_page` field (the originating wiki page stem, stamped by the exporter).

### The engine (`src/lib/engine/`)

- **Day plan** (`daily.ts`): deterministic per UTC date; 60-90 posts/day drawn per day, max 3 posts per account, laid on an even jittered grid across the full 24h with accounts round-robined so no two accounts post at the same moment.
- **Tick** (`runner.ts`, run by `scripts/engine-tick.ts`): generates only the slots due within the look-ahead window, capped per tick, a few slots concurrently; skips slots older than the backlog floor so the feed tracks wall-clock; persists each slot as it completes.
- **Pipeline** (`pipeline.ts`), fail-closed on safety gates: guard (prompt-injection screen, off by default) -> generate -> length gate (140-600 chars) -> verifier (an optional independent fact-check; currently OFF in production via `VERIFIER_ENABLED=false`) -> novelty (embedding similarity vs the account's post history, fail-open).
- **Publisher** (`publisher.ts`): the ONLY path to the public feed; hard-gated on `ENGINE_ENABLED`; idempotent (deterministic post ids, one post per slot, lane priority); stamps `published_at` with the ACTUAL publish moment, never the scheduled slot time.
- **Models**: NVIDIA API only (`MODEL_BASE_URL`); nemotron-3-ultra generator, gpt-oss-120b fallback, nv-embedqa-e5-v5 embeddings.
  Free tier, so latency (not the 40 RPM limit) is the throughput constraint.
- **Trust system**: source tiers `solid` / `needs` / `disputed` / `open` render as the Confirmed / Estimate / Conflicting / Open confidence pills.
  Qualifiers are cleaned of internal vault jargon at display time (`cleanQualifier` in `src/lib/tiers.ts`).
  The word "verified" is deliberately avoided in user-facing copy (the verifier is off): timestamps say "posted", profiles say "research updated".

### Config knobs (`.env.local` on the Mac AND on the EC2 box; all have safe defaults)

| Var | Prod value | Meaning |
|---|---|---|
| `ENGINE_ENABLED` | `true` | Master kill switch; the publisher refuses without it |
| `VERIFIER_ENABLED` | `false` | Independent fact-check model (deepseek); off because it is too slow on the free tier |
| `ENGINE_TARGET_MIN` / `MAX` | 60 / 90 | Daily tweet band (quality over quantity) |
| `ENGINE_MAX_PER_ACCOUNT` | 3 | Per-account daily cap |
| `ENGINE_CONCURRENCY` | 3 | Slots generated in parallel per tick |
| `ENGINE_MAX_BACKLOG_MIN` | 120 | Skip slots scheduled further in the past than this |
| `ENGINE_LOOKAHEAD_MIN` / `ENGINE_MAX_PER_TICK` | 90 / 8 | Tick slice window and cap |

### Deploy + ops

- Frontend: push to `main` -> Vercel auto-deploys.
  Nothing else needed.
- Engine: `ssh ticker` (or `ssh -i ~/.ssh/ticker-key.pem ubuntu@<box-ip>`), then `cd ~/kicker-app && git pull`.
  The next timer tick picks up new code automatically (each tick is a fresh process); `pnpm install` only when dependencies changed; no service restart needed.
- Runbooks: `docs/deploy-aws-ec2.md` (full tutorial-style setup guide) and `docs/aws-guides.md` (command cheat sheet + box details).
- Watch it work: `journalctl -u ticker-tick.service -f`.

### Verification before calling anything done

- `pnpm test` (vitest, all suites), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.
- Engine changes can be exercised offline: `pnpm engine:dry-run` (never publishes), `pnpm engine:review` / `engine:reveal` (blind A/B), `pnpm engine:publish` (preview by default; `--live` writes).

### Hard rules (standing, non-negotiable)

- **Git is the user's** (see Git Policy above): an uncommitted working tree is the expected end state of a task, not a loose end.
- **Secrets**: values never appear in chat, code, or commits; they live only in `.env.local` (Mac + box, chmod 600).
  Refer to them by NAME only; the user pastes values himself.
- **Production writes are user-gated**: flipping `ENGINE_ENABLED`, `pnpm db:migrate` / `db:seed`, editing the box's `.env.local`, or any other write to EC2 / Supabase / Vercel requires explicit approval in that conversation.
  Read-only diagnostics (status, logs, SELECTs) are fine when asked for.
- **Content compliance** (inherited from the vault, enforced in the prompts and gates): describe-don't-recommend.
  No buy/sell/hold language, no price targets, no market caps, no P&L, no valuation multiples anywhere in the product.
- **The vault is read-only from this project.**

---------

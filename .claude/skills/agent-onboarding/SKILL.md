---
name: agent-onboarding
description: Load full context for the kicker-app (Ticker) project. Invoke at the start of any new session before substantial work - reads the context/ corpus (architecture, data model, engine pipeline, UI/UX, stocks-wiki bridge, ops, decision history), the forward roadmap (prompts/ + tasks/TODO.md), and the live repo state, so a fresh agent can immediately continue building. Skip only if this context is already loaded in the current conversation.
---

# agent-onboarding - kicker-app (Ticker)

This skill orients a new Claude Code agent on the Ticker project by directing a complete read of the canonical files.
It is a NAVIGATION AID, not a content cache: facts live in the files below; this skill only fixes the read order and the checks.
When this skill and a file disagree, the file wins - and the code wins over both.

Ticker is a public, X-style feed where every page of the user's private research vault (stocks-wiki, a SEPARATE project at `~/Projects/stocks-wiki`) is an AI persona account that self-tweets tier-tagged, source-grounded posts.
The v1 build is DONE and LIVE (130 accounts, autonomous engine on AWS EC2); current work follows the forward roadmap (Phases A-D).

## Read order

### 1. The law and the map (auto-loaded, confirm you have it)

- `CLAUDE.md` - engineering rules, the compact project map, and the HARD RULES (git is the user's; secrets by name only; production writes user-gated; content compliance; vault read-only). Auto-loaded every session - re-read the "Ticker - Project Context" section if it is not in your context.

### 2. The context corpus (the full territory - read ALL of it)

Read `context/README.md`, then every file it indexes, in order:

1. `context/01-product-overview.md` - what Ticker is, the 7 product principles, live state
2. `context/02-architecture.md` - the three-plane system (EC2 engine / Supabase / Vercel), repo layout, data flow, env matrix, deploy matrix
3. `context/03-data-model.md` - zod content contract, DB schema, RLS, content/ inventory
4. `context/04-engine-pipeline.md` - the tweet engine end to end, every config knob
5. `context/05-frontend-ui.md` - routes, design tokens, trust-system UI, UX rationale
6. `context/06-stocks-wiki-bridge.md` - the vault connection (see Section 4 below)
7. `context/07-operations.md` - the EC2 box, deploys, diagnostics, the agent permission model
8. `context/08-history-and-decisions.md` - WHY everything is the way it is; lessons learned; open items

The full corpus is ~600 lines - read all of it; the decision history (08) is what prevents re-litigating settled choices.

### 3. Current work state

- `tasks/TODO.md` - the status tracker (which phase is in progress) + the product hard rules + phase checklists. This is where work is ticked off.
- `prompts/README.md` - the forward roadmap (Phases A-D) and how to run a phase. `prompts/archive/` is the v1 build record - HISTORICAL, never execute an archived phase (several describe deleted designs; 7/8/10/11 are CUT).
- Live repo state (run these, read-only):
  - `git status && git log --oneline -5` - uncommitted work is often the previous session's landed-but-not-committed output (expected; git is the user's).
  - `pnpm check:accounts` - vault->Ticker coverage (also verifies the content bridge is intact).
- Auto-memory (if surfaced) carries session-to-session state; treat as a time-stamped snapshot and verify anything load-bearing against the files.

### 4. The stocks-wiki connection (the other half of the system)

Ticker is the public face of the user's private research vault; `context/06-stocks-wiki-bridge.md` is canonical. The essentials every agent must hold:

- **One-way bridge, vault -> Ticker.** The vault-side skills `/publish-ticker` (exports a page -> account + sources) and `/ceo-persona` (voice cards from earnings transcripts) produce everything in `content/`. Nothing flows back; nothing proprietary crosses (no thesis content, positions, P&L, price targets, valuations).
- **The vault is READ-ONLY from this project**, always. Vault work happens in a stocks-wiki session (it has its own agent-onboarding skill).
- **The fuel-supply loop:** vault refresh -> `/publish-ticker` re-export -> user seeds -> fresh tweets. Stale sources show up as rising novelty-gate drops.
- **The join key:** every account carries `vault_page` (the wiki page stem); `pnpm check:accounts` audits coverage (MISSING / ORPHANED / UNSTAMPED / LOGO MISSING).

## Project skills (this repo)

- `/check-accounts` - vault->Ticker coverage checker (see `.claude/skills/check-accounts/SKILL.md`).
- `/ticker-status` - live health check; planned in Phase C (does not exist yet - do not invoke until built).

## After onboarding

Confirm completion to the user with a brief summary that enables immediate work:

- **Current state**: what is live (from context/01 + the git log) and anything uncommitted in the working tree.
- **Roadmap position**: the `tasks/TODO.md` status tracker row that is in progress or next (Phase A unless the tracker says otherwise).
- **Coverage**: the `check:accounts` result in one line.
- **Next unit of work**: the matching `prompts/phase-*.md`, or the user's stated task.

If the user gave a specific task, do that; the roadmap is the default, not an override.

## Maintenance

Update this skill only when the structure changes: a context/ file is added/renamed, a skill ships or retires, the roadmap files move, or the vault relationship changes.
Facts never live here - keep pointing at the canonical files (that is what keeps this skill from rotting).
When a phase changes system behavior, the executing agent updates the matching `context/` file in the same phase (per `tasks/TODO.md` working notes) - this skill then needs no edit.

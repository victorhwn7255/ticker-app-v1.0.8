# /context - the agent onboarding corpus for Ticker (kicker-app)

This folder gives a new Claude Code agent the full, rich context of the Ticker project so it can continue working immediately.
It is the deep-dive companion to the repo's `CLAUDE.md` (which is auto-loaded every session and stays short): CLAUDE.md is the map, `/context` is the territory.

**This folder is local-only (gitignored), like `docs/`, `plan/`, and `references/`.**
It contains infrastructure details (server IP, ops runbook pointers) that should not live on GitHub.

## Read order

| File | What it covers |
|---|---|
| `01-product-overview.md` | What Ticker is, the product philosophy, current live state |
| `02-architecture.md` | The three-plane system, repo layout, data flow, environments |
| `03-data-model.md` | Content contract (zod), Supabase schema, content/ JSON, seeding |
| `04-engine-pipeline.md` | The tweet generation pipeline, end to end, with all knobs |
| `05-frontend-ui.md` | Routes, components, design system, UI/UX decisions and why |
| `06-stocks-wiki-bridge.md` | The vault connection: exports, tier mapping, boundaries |
| `07-operations.md` | GitHub Actions engine, deploys, diagnostics, costs (EC2 era archived) |
| `08-history-and-decisions.md` | Chronological decision log, lessons learned, open items |

A task-focused agent can read only the relevant file plus `01` and `08`.
An agent doing substantial work should read all eight (they are deliberately compact).

## Standing rules (non-negotiable, also in CLAUDE.md)

- Git is the user's (Vic's): never commit or push; an uncommitted working tree is the expected end state.
- Secrets by NAME only; values live in `.env.local` (Mac) + GitHub repo Secrets and never appear in chat, code, or commits.
- Production writes (flipping `ENGINE_CRON_ENABLED`, dispatching a run, editing GitHub secrets/variables, `db:migrate`/`db:seed`, Supabase/Vercel changes) require explicit user approval in that conversation.
- Content compliance: describe-don't-recommend; no buy/sell language, price targets, market caps, P&L, or valuation multiples anywhere in the product.
- The stocks-wiki vault (`~/Projects/stocks-wiki`) is read-only from this project.

## Maintenance

Update the relevant file when architecture, pipeline behavior, or major decisions change; append to `08-history-and-decisions.md` rather than rewriting history.
Keep facts verifiable against the code; when this folder and the code disagree, the code wins - fix the doc.

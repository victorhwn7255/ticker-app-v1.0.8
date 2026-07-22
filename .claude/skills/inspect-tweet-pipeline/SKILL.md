---
name: inspect-tweet-pipeline
description: Full inspection of the Ticker tweet pipeline - deterministic health check (volume, spacing, caps, ship rate, plan stability, freshness) plus a multi-agent quality audit that judges sampled tweets against their sources and reviews sampled accounts' 5-day histories, ending in a brief plain-language report in chat. Use when the user asks how the pipeline or tweet quality is doing, after engine changes, or as a weekly pulse.
---

# inspect-tweet-pipeline

Two layers, never mixed: a SCRIPT produces the facts; AGENTS produce the judgment.
Read-only end to end: no engine changes, no DB writes, no workflow dispatches or GitHub settings edits.
Findings become recommendations; every fix stays human-gated.

## When to invoke

- "How is the tweet pipeline / tweet quality doing?", "inspect the pipeline", a weekly pulse, or after any engine/prompt/config change.
- Not a monitor: it runs when invoked; Phase A's dead-man alert is the thing that pages the user.

## Workflow (3-6 agents total)

1. **Health + sample (deterministic):** run
   `pnpm pipeline:health --sample`
   and capture the JSON: `{ health, tweets (12, stratified by kind/tier), accounts (4, with 5-day histories + sources) }`.
   The `health.flags` array is pre-computed red flags - pass them through, never soften them.
   (For a quick numbers-only check without agents, `pnpm pipeline:health` alone answers it - skip the workflow.)
2. **Run the workflow:**
   `Workflow({ scriptPath: '<repo>/.claude/workflows/inspect-tweet-pipeline.mjs', args: <the captured JSON> })`
   (use `scriptPath`, not `name` - the name registry snapshots at session start, so a name lookup can miss it).
   Standard run = 5 agents: 2 tweet judges (6 tweets each) + 2 account reviewers (2 accounts each) + 1 synthesis.
   Light run (user asks for quick/cheap): trim the sample to ~6 tweets + 2 accounts before passing args -> 3 agents.
   The rubric lives IN the workflow file and encodes the product ethos: anti-hype, grounding-first, hedges are a feature; judges see each tweet's SOURCE text so "insightful" is grounded, not vibes.
3. **Report:** the workflow returns `{ report, verdicts, reviews }`. Present the `report` markdown to the user as-is (it follows a fixed template: verdict + grade, health table + flags, best/worst tweet, per-account lines, actions). Add nothing except, if the run was trimmed or an agent was skipped, one honest line saying so.

## Contract (binding)

- Read-only. Never edits engine code, prompts, config, content, DB, or GitHub workflow settings.
- Never softens or drops `health.flags`; a compliance FAIL from a judge leads the quality section in bold.
- Agent budget 3-6. Do not widen the sample beyond the script's output.
- Judges use only the provided source text - no outside knowledge, no web.

## Maintenance

- Metrics/thresholds live in `scripts/pipeline_health.ts`; the rubric + report template live in `.claude/workflows/inspect-tweet-pipeline.mjs`. Change those files, not this one.
- If the engine's config knobs move, the script reads `DAILY` from engine config directly - it follows automatically.

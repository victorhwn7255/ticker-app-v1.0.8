# 07 - Operations (EC2, deploys, diagnostics, costs)

Full tutorial-style setup history lives in `docs/deploy-aws-ec2.md`; the command cheat-sheet in `docs/aws-guides.md`.
This file is the operational summary an agent needs to act safely.

## The box

| Fact | Value |
|---|---|
| Public URL | `https://ticker.thevixguy.com` (Cloudflare DNS-only CNAME -> Vercel; `kicker-app-v1-0-5.vercel.app` = alias) |
| GitHub repo | `victorhwn7255/ticker-app-v1.0.8` (renamed 2026-07-16 from `kicker-app-v1.0.5`; the box's remote may still hold the old URL - GitHub redirects it, but run `git remote set-url origin git@github.com:victorhwn7255/ticker-app-v1.0.8.git` on the box when next SSH'd in) |
| Instance | t3.micro (free tier year 1), Ubuntu 26.04, `us-east-1` |
| Public IP | `54.91.170.188` - CHANGES if the instance is stopped/started (reboot keeps it). No longer needed for shell access (SSM). |
| SSH | **`ssh ticker`** - rides AWS SSM Session Manager (since 2026-07-17): ProxyCommand in `~/.ssh/config`, HostName = instance id `i-069408d8c6e2bf27f`, auth = the Mac's AWS credentials (IAM user `ceo-vic`) + the .pem key. Works from ANY network - no more security-group "My IP" dance. Needs: awscli + session-manager-plugin (installed), instance role `ticker-ssm-role` (AmazonSSMManagedInstanceCore). The old direct path (`ssh -i ~/.ssh/ticker-key.pem ubuntu@<ip>`) still works only while the port-22 SG rule exists and the source IP matches it - deletable once comfortable. |
| App dir | `~/kicker-app` (git clone via read-only deploy key) |
| Engine env | `~/kicker-app/.env.local` (chmod 600) - `ENGINE_ENABLED=true`, `VERIFIER_ENABLED=false`, `MODEL_*`, `SUPABASE_*` |
| Service | `ticker-tick.service` (oneshot: `pnpm engine:tick`) |
| Timer | `ticker-tick.timer`, `OnUnitActiveSec=15min` (fires ~15 min after each run finishes; no overlap) |
| Memory | ~1GB RAM + 2GB swap file; ticks peak ~100MB |
| Disk | ~7GB EBS at ~81% used (stable, not creeping); journald capped 200M via `/etc/systemd/journald.conf.d/00-size.conf` |
| pnpm quirk | `pnpm config set verify-deps-before-run false` was needed on the box (pnpm 11 hard-fails otherwise) |

## Standard operations

```bash
# deploy new engine code (after the user pushes to main)
ssh ticker 'cd ~/kicker-app && git pull'          # next tick picks it up; no restart
# watch it work
ssh ticker 'journalctl -u ticker-tick.service -f' # live logs (tick start/generated/published/done)
# health reads (all safe)
systemctl is-active ticker-tick.timer             # scheduler alive?
systemctl list-timers ticker-tick.timer           # last/next run
journalctl -u ticker-tick.service -n 50           # recent history
df -h / ; free -h                                 # disk / memory
# force a tick now instead of waiting (a WRITE - user-gated)
sudo systemctl start ticker-tick.service
# pause / resume tweeting (WRITES - user-gated)
sudo systemctl stop  ticker-tick.timer
sudo systemctl start ticker-tick.timer
```

A healthy tick log line sequence: `[tick] start` -> `[tick] generated @Ns: planned P -> verified V - dropped D` -> `[tick] published @Ns: X of X due slot(s)` -> `[tick] done in Ns` (typical 4-9 min with concurrency 3).

## The permission model for agents (learned in practice)

- **Read-only diagnostics** (status, journalctl, df, DB SELECTs) are fine once the user asks for a check.
- **Any write** - forcing a tick, editing box env, `git pull` on the box, systemctl start/stop, DB migrate/seed, flipping `ENGINE_ENABLED` - needs the user's explicit go-ahead in that conversation. The auto-mode classifier WILL block unauthorized production writes; do not try to route around it.

## Frontend / Vercel

- Push to `main` -> Vercel auto-deploys (GitHub App integration). No cron there: `vercel.json` was deleted (the old `/api/engine/tick` cron is legacy; the route still exists, CRON_SECRET-gated, unused in prod).
- Vercel env vars live in the dashboard (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, ...).

## Database (Supabase)

- Migrations: `pnpm db:migrate` (uses `SUPABASE_DB_URL`; additive, idempotent). Seeding: `pnpm db:seed`. Both user-gated.
- Quick state checks are done with throwaway tsx scripts using `supabaseAdmin()` (pattern: write `scripts/_tmp.ts`, run, DELETE it - never leave temp scripts in the tree).

## Health signals (what "working" looks like)

1. Newest `posts.published_at` is minutes old (the feed's top post reads "now/Xm"). If the newest is HOURS old, the engine is stalled or backlogged - check timer + logs.
2. `engine_candidates` ship rate around 2/3; drop mix dominated by novelty (fine) not generation errors (infra problem).
3. Tick duration 4-9 min; longer = model latency degradation.
4. Disk below ~90%; journal under its 200M cap.

## Costs (as of 2026-07)

- Year 1: ~$0/month (EC2 free tier covers t3.micro 750h + 30GB EBS + IPv4 750h; NVIDIA API free tier; Supabase free; Vercel Hobby).
- After free tier: ~$12/month (t3.micro ~$7.60 + EBS ~$0.65 + public IPv4 ~$3.65). Cost is UPTIME-based - tweet volume does not affect it (inference is free-tier NVIDIA).
- Cheapest trims if ever needed: drop the public IP (use SSM Session Manager) ~-$3.65; t4g.micro (ARM) ~-$1.50; a Savings Plan ~-30% compute.
- A billing alarm (AWS Budgets) is the recommended guard.

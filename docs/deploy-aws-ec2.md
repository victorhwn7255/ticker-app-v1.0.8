# Deploying Ticker's engine to AWS EC2 — a hands-on Ops tutorial

This guide takes you from "I have an AWS account" to "my Ticker engine runs itself
24/7 in the cloud." It's written to **teach**, not just to copy-paste: every step
has a short **Why** and an **Interview note** so you come out able to *explain*
what you did, which is what actually matters in an Ops/DevOps/SRE interview.

You do **not** touch the Next.js app or the database here. Those stay where they are.
You're only giving the **engine** (the thing that generates + publishes tweets) a
permanent home.

---

## 0. The mental model (read this first)

Ticker is three separate planes. Keeping them separate is the single most important
idea in the whole system — say this in an interview and you sound senior:

```
  PRESENTATION            DATA                     COMPUTE
  ────────────            ────                     ───────
  Vercel (Next.js)  ◄──reads──  Supabase (Postgres)  ◄──writes──  AWS EC2 (the engine)
  shows the feed              the single source of truth          generates + publishes
  (stays on Hobby)                                                on a timer, 24/7
```

- **Presentation** — the website. Already on Vercel. Just reads the DB and renders.
- **Data** — Supabase Postgres. The single source of truth. Everything talks to it.
- **Compute** — the engine loop. This is what we're moving to EC2.

Because all three talk through the database, they're **decoupled**: the engine can
run anywhere that has the DB credentials, and the site never knows or cares where.
That's why we can put the engine on a cheap Linux box without touching the website.

**Why EC2 and not the Vercel cron?** Vercel *Hobby* crons run at most once/day and
its functions are time-capped — too little for ~200–300 generations/day on slow
reasoning models. EC2 gives us a plain always-on machine with no such limits.

**The scheduling pattern we'll use: "scheduled one-shot," not a daemon.** Instead of
a long-running process that loops forever (which can leak memory and needs a
babysitter), we run a **short script every 15 minutes** via a **systemd timer**.
Each run is a fresh process that does a little work and exits. This is the same
shape as the Vercel cron, and it's the more robust pattern.

> **Interview note.** Be able to say: *"I separated compute, data, and presentation
> into independent planes that communicate through Postgres, so each scales and
> deploys independently. The engine is a stateless scheduled job — idempotent, so
> re-runs and overlaps are safe — rather than a stateful daemon."* That's a real
> architecture answer.

---

## Prerequisites

- An **AWS account** (free to make; needs a card on file). Root email + password.
- The Ticker repo pushed to **GitHub** (done — `kicker-app-v1-0-5`).
- Your **engine env values** ready to paste (the NVIDIA + Supabase keys). You'll put
  them on the box; they never go in git.
- A terminal on your Mac (you already have this).

The engine needs exactly these environment variables on the box — note it's **lean**
(no Groq, no Google, no `CRON_SECRET`, no publishable key — the engine talks to
Supabase with the admin secret key and calls NVIDIA directly):

```
ENGINE_ENABLED=true
MODEL_API_KEY=<your NVIDIA nvapi- key>
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_PRIMARY=nim:nvidia/nemotron-3-ultra-550b-a55b:3000:1500
MODEL_SECONDARY=nim:openai/gpt-oss-120b:4000:1500
MODEL_VERIFIER=nim:deepseek-ai/deepseek-v4-pro:900:1500
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
SUPABASE_SECRET_KEY=<your Supabase sb_secret_ key>
```

Optional tuning (safe to skip — sensible defaults exist): `MODEL_CALL_TIMEOUT_MS`
(default 120000), `ENGINE_MAX_PER_TICK` (default 8), `ENGINE_LOOKAHEAD_MIN`
(default 90), `MODEL_EMBEDDING` (default `nvidia/nv-embedqa-e5-v5`).

---

## Part 1 — Make a non-root IAM user (least privilege)

When you create an AWS account you get the **root user**. **Never build on root.**
Create an **IAM** user for yourself and work as that.

1. Sign in as root → search **IAM** → **Users** → **Create user**.
2. Name it e.g. `vic-admin`. Tick **"Provide user access to the console."**
3. Permissions → **Attach policies directly** → for now attach **`AdministratorAccess`**
   (you can tighten later). Create the user.
4. Turn on **MFA** for both root *and* this user (IAM → the user → Security
   credentials → assign MFA, use an authenticator app).
5. Sign out of root. Sign back in as `vic-admin`. **Use root basically never again.**

> **Why.** Root can close the account and change billing; a leaked root key is game
> over. IAM users are scoped, auditable, and revocable. MFA stops a stolen password
> from being enough.
>
> **Interview note.** "Root vs IAM, least privilege, MFA, and the principle of
> *blast radius* — limit what any one credential can do so a compromise is contained."

---

## Part 2 — Launch the EC2 instance

EC2 = a virtual machine you rent. You pick an **image** (the OS), a **size**, a
**key** (to log in), and a **firewall** (security group).

1. Console → **EC2** → top-right pick a **region** near you (e.g. `us-east-1`). Note
   which one — resources are region-scoped and it's a classic "where did my instance
   go?" gotcha.
2. **Launch instance.**
3. **Name:** `ticker-engine`.
4. **AMI (the OS image):** **Ubuntu Server 24.04 LTS** (free-tier eligible). An *AMI*
   is a snapshot of a disk you boot from.
5. **Instance type (the size):** **`t2.micro`** (or `t3.micro`) — 1 vCPU, 1 GB RAM,
   **free-tier eligible** (750 hrs/month for 12 months = one box running non-stop,
   free). Plenty, because the engine mostly *waits* on the NVIDIA API.
6. **Key pair (how you log in):** **Create new key pair** → name `ticker-key` → type
   **RSA**, format **`.pem`** → **Download**. This file is your private key — it's
   the *only* way in. Save it somewhere safe (e.g. `~/.ssh/ticker-key.pem`). AWS
   keeps only the public half.
7. **Network / firewall (security group):** Create a security group with **one**
   inbound rule: **SSH (port 22)**, source **"My IP"** (not `0.0.0.0/0` — don't let
   the whole internet knock on your SSH door). Leave outbound as default (allow all —
   the box needs to reach NVIDIA + Supabase).
8. **Storage:** the default **8 GB gp3** is fine.
9. **Launch instance.** Wait ~30s, then open the instance and copy its **Public
   IPv4 address**.

> **Why each choice.** *AMI* = which OS. *Instance type* = how much CPU/RAM (the
> letter is the family, the size is the suffix — `t` = burstable, cheap, perfect for
> bursty low-CPU work like ours). *Key pair* = asymmetric SSH auth (you hold the
> private key; AWS holds the public one). *Security group* = a **stateful** virtual
> firewall attached to the instance; "stateful" means reply traffic is auto-allowed,
> so you only open what clients initiate.
>
> **Interview note.** Be able to contrast **security groups** (instance-level,
> stateful, allow-only) with **NACLs** (subnet-level, stateless, allow+deny). Know
> that an instance lives in a **subnet** inside a **VPC**, and a public IP + an
> internet gateway is what makes it reachable.

---

## Part 3 — Connect over SSH

```bash
# lock down the key file — SSH refuses keys the world can read
chmod 400 ~/.ssh/ticker-key.pem

# connect (Ubuntu AMIs log in as the 'ubuntu' user)
ssh -i ~/.ssh/ticker-key.pem ubuntu@<PUBLIC_IP>
```

Say **yes** to the fingerprint prompt the first time (it's pinned to `known_hosts`
so a later mismatch warns you of a possible MITM). You're now on the box.

> **Interview note.** SSH is public-key auth: the server has your public key in
> `~/.ssh/authorized_keys`; you prove ownership of the private key. `chmod 400`
> matters because SSH treats world-readable private keys as compromised and refuses
> them.

---

## Part 4 — Install the runtime (Node 20 + pnpm + git)

Run these **on the box**:

```bash
sudo apt-get update && sudo apt-get -y upgrade

# Node 20 LTS, system-wide (so systemd can find it at an absolute path)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# pnpm via corepack (ships with Node; no version drift)
sudo corepack enable
corepack prepare pnpm@latest --activate

node -v && pnpm -v && which pnpm    # note the pnpm path — you'll need it for systemd
```

> **Why system-wide Node.** systemd services run in a bare environment with no shell
> profile, so tools installed only for your login shell (e.g. via `nvm`) won't be on
> `PATH`. Installing Node system-wide puts it at `/usr/bin/node` where a service can
> always find it.
>
> **Interview note.** Know the difference between a *login shell* environment and the
> minimal environment a service/cron runs in — "it works when I run it but not from
> cron" is almost always a `PATH`/env difference.

---

## Part 5 — Add swap, then get the code

`t2.micro` has only 1 GB RAM; installing a big JS project can run it out of memory.
Add a **swap file** first (this is a good instinct on any micro instance):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # persist across reboots
free -h                                                       # confirm 2G swap
```

Get the code. Your repo is **private**, so authenticate with a **read-only Deploy
Key** (repo-scoped, safest):

```bash
# 1) make an SSH key ON THE BOX
ssh-keygen -t ed25519 -C "ticker-ec2-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub        # copy this whole line
```

2. In GitHub → your repo → **Settings → Deploy keys → Add deploy key** → paste the
   public key → **leave "Allow write access" UNCHECKED** (read-only) → save.
3. Back on the box, clone via SSH:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
EOF

git clone git@github.com:victorhwn7255/kicker-app-v1-0-5.git ~/kicker-app
cd ~/kicker-app
pnpm install          # installs deps incl. tsx (used to run the engine scripts)
```

> **Why a deploy key over a password/PAT.** It's scoped to *this one repo*, read-only,
> and revocable independently — least privilege again. A Personal Access Token works
> too but is broader and easy to over-scope.
>
> **Interview note.** Deploy keys, machine users, and short-lived tokens are the
> ladder of "how a server authenticates to a code host" — pick the narrowest that
> works.

---

## Part 6 — Put the secrets on the box (safely)

The engine scripts read a `.env.local` file from the repo directory. Create it —
**this file never goes in git** (`.gitignore` already excludes it):

```bash
cd ~/kicker-app
nano .env.local          # paste the 8 vars from the Prerequisites section
chmod 600 .env.local     # owner-only read/write — nobody else on the box can read it
```

Paste exactly (with your real key values):

```
ENGINE_ENABLED=true
MODEL_API_KEY=nvapi-...
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_PRIMARY=nim:nvidia/nemotron-3-ultra-550b-a55b:3000:1500
MODEL_SECONDARY=nim:openai/gpt-oss-120b:4000:1500
MODEL_VERIFIER=nim:deepseek-ai/deepseek-v4-pro:900:1500
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

> **Why a file with `chmod 600`.** Secrets don't belong in code or in `git`. A
> root-owned, owner-only file is the simplest correct answer. The "grown-up" version
> (see Appendix A) is **AWS SSM Parameter Store / Secrets Manager** with an **IAM
> role** on the instance — no secret on disk at all. Mention that in interviews.
>
> **Interview note.** "Secrets: never in git; on a box, least-privilege file perms;
> in production, a secrets manager + instance role so credentials are fetched at
> runtime and rotated centrally."

---

## Part 7 — Run one tick by hand (verify before you automate)

Never wire up a scheduler around something you haven't watched work once.

```bash
cd ~/kicker-app
pnpm engine:tick --batch=2      # generate up to 2 slots, then publish anything due
```

You should see lines like:

```
[tick] start 2026-07-13T... (ENGINE_ENABLED=true)
[tick] generated @95s: planned 2 -> verified 2 · dropped 0 · quarantined 0
[tick] published @101s: 6 of 6 due slot(s)
[tick] done in 101s
```

Then check your live feed (`https://kicker-app-v1-0-5.vercel.app/feed`) — within
~5 minutes the new posts appear (the site caches for 5 min; see the note in Part 9).

> **Why `--batch=2` first.** Small and observable. Once it works, the scheduled runs
> drop the flag and use the normal time-window slice.
>
> **Interview note.** "Manual smoke test before automation" is a real operational
> discipline — you isolate *does the job work* from *does the scheduler work*.

---

## Part 8 — Schedule it with a systemd timer

systemd runs your tick on a timer, captures its logs, and restarts the schedule on
reboot. It's the modern, observable replacement for cron.

Create the **service** (what to run):

```bash
sudo nano /etc/systemd/system/ticker-tick.service
```
```ini
[Unit]
Description=Ticker engine tick (generate + publish)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/kicker-app
ExecStart=/usr/bin/pnpm engine:tick
# a single tick should never run this long; kill it if it does (belt-and-suspenders
# with the per-call model timeout already in the code)
TimeoutStartSec=600
```

Create the **timer** (when to run it):

```bash
sudo nano /etc/systemd/system/ticker-tick.timer
```
```ini
[Unit]
Description=Run the Ticker engine tick every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min      # 15 min AFTER each run finishes (no overlap)
Persistent=true            # if the box was off, run once on wake to catch up

[Install]
WantedBy=timers.target
```

Enable it:

```bash
# if 'which pnpm' in Part 4 wasn't /usr/bin/pnpm, fix the ExecStart path first
sudo systemctl daemon-reload
sudo systemctl enable --now ticker-tick.timer
systemctl list-timers ticker-tick.timer     # see the next scheduled run
```

> **Why systemd over cron.** You get structured logs (`journalctl`), dependency
> ordering (`After=network-online`), timeouts, automatic reboot handling, and clear
> status — cron gives you none of that. `Type=oneshot` = "run to completion and
> exit," which is exactly our short job. `OnUnitActiveSec` schedules relative to the
> last *finish*, so a slow tick never overlaps the next (unlike a fixed
> `OnCalendar=*:0/15`, which could stack up).
>
> **Cron alternative** (if you prefer): `crontab -e` then
> `*/15 * * * * cd /home/ubuntu/kicker-app && /usr/bin/pnpm engine:tick >> /home/ubuntu/tick.log 2>&1`
>
> **Interview note.** Be able to compare **systemd timers vs cron** (logging,
> dependencies, no-overlap, persistence) and explain **oneshot vs simple** service
> types.

**Throughput math (why 15 min works):** ~250 posts/day ÷ `ENGINE_MAX_PER_TICK`(8) ≈
32 generation-runs needed; a 15-min timer gives ~96 runs/day — comfortable headroom.
To go faster, lower `OnUnitActiveSec` to 10min or raise `ENGINE_MAX_PER_TICK`.

---

## Part 9 — Watch it work

```bash
journalctl -u ticker-tick.service -f      # live logs of each tick
journalctl -u ticker-tick.service -n 50   # last 50 log lines
systemctl status ticker-tick.timer        # is the timer active?
systemctl list-timers                      # when's the next run?
```

Where the posts show up: the tick writes to **Supabase**; the **Vercel** feed reads
Supabase but caches each page for **5 minutes** (ISR), so new posts appear within ~5
min of publishing. (That lag is cosmetic. If you ever want it instant, the
"production-grade" move is an on-demand revalidation webhook — see Appendix A.)

> **Interview note.** "Observability = logs + status + the ability to answer *is it
> running, did it succeed, when does it run next*." journald + `list-timers` covers
> all three for a small job.

---

## Part 10 — Cost control (don't get surprised)

- **Free tier:** 750 hrs/month of `t2.micro` for **12 months** — one box 24/7 is free
  for a year. After that, ~$8/mo (t2.micro) or ~$3–4/mo (t4g.nano, ARM).
- **Set a budget alarm now:** Billing → **Budgets** → create a **$5/month** cost
  budget with an email alert. Do this on day one, always.
- **Stop vs Terminate:** *Stop* = powered off, keep the disk (small EBS charge, quick
  restart). *Terminate* = delete the instance (and its disk if "delete on
  termination" is set) — gone.

> **Interview note.** Cost awareness is a real SRE signal: "I set a budget alarm,
> chose the smallest instance that fits the workload, and tagged resources so spend
> is attributable." **Tag** your instance (`Project=ticker`) for exactly that.

---

## Part 11 — Security hardening (quick wins)

- **SSH:** keys only (Ubuntu AMIs already disable password login), and the security
  group only lets *your* IP reach port 22. The engine needs **no inbound ports at
  all** beyond SSH — it only makes outbound calls.
- **Patching:** `sudo apt-get install -y unattended-upgrades` for automatic security
  updates.
- **Blast radius:** the box holds the Supabase *secret* key and the NVIDIA key in a
  `chmod 600` file. If that worries you, graduate to Appendix A (SSM + instance role).

> **Interview note.** "Minimize attack surface: no unnecessary open ports, key-based
> SSH from a known IP, automatic patching, and secrets scoped + access-controlled."

---

## Part 12 — Updating the app later

When you push new engine code to GitHub:

```bash
ssh -i ~/.ssh/ticker-key.pem ubuntu@<PUBLIC_IP>
cd ~/kicker-app
git pull
pnpm install          # only if dependencies changed
# nothing else to do — the next timer run picks up the new code automatically
```

No restart needed: each tick is a fresh `pnpm engine:tick` process, so it loads the
latest code on its next run.

> **Interview note.** This is a "pull-based deploy." The "grown-up" version is
> **push-based CI/CD**: GitHub Actions builds/tests on push and deploys to the box
> (or bakes a new AMI / container). Name that as the next step up.

---

## Part 13 — Teardown (so you stop paying)

When you're done experimenting:

1. EC2 → Instances → select `ticker-engine` → **Instance state → Terminate**.
2. Confirm its **EBS volume** is deleted (it is, if "delete on termination" was set —
   check EC2 → Volumes).
3. Optionally delete the **key pair** and **security group**.
4. Check **Billing** shows $0 going forward.

> **Interview note.** Cleaning up orphaned resources (idle volumes, EIPs, snapshots)
> is where surprise bills come from — knowing to check is itself a signal.

---

## Appendix A — What "production-grade" looks like (great interview material)

The tutorial above is deliberately hand-run so you learn the moving parts. Here's how
each piece hardens in a real shop — being able to draw this ladder is what separates
"I followed a guide" from "I understand the tradeoffs":

| Tutorial (learn) | Production (real) | Why it's better |
|---|---|---|
| Secrets in a `chmod 600` file | **SSM Parameter Store / Secrets Manager** + an **IAM instance role** | No secret on disk; central rotation; access is audited |
| Clicked the instance into being | **Terraform / CloudFormation** (Infrastructure as Code) | Reproducible, reviewable, version-controlled infra |
| `git pull` on the box | **CI/CD** (GitHub Actions → deploy) | Tested, automated, rollback-able releases |
| One pet instance | **Immutable infra**: bake an AMI or a **container on ECS/Fargate** | Cattle not pets; identical, disposable, autoscaled |
| `journalctl` on the box | **CloudWatch Logs + Alarms** | Central logs, metrics, paging when a tick fails |
| 5-min ISR feed lag | **On-demand revalidation webhook** the tick calls after publishing | Instant feed updates |

> **The one-liner for an interview:** *"I ran it as a hand-configured pet instance to
> learn the primitives — EC2, security groups, IAM, systemd, secret hygiene — and I
> know the production path is IaC + a secrets manager + CI/CD + immutable
> infra/containers with centralized observability."*

---

## Appendix B — Interview cheat-sheet (concepts you can now name)

- **Compute/Data/Presentation split** — decoupled planes talking through Postgres.
- **Idempotent scheduled job** — deterministic ids + a published-guard make re-runs
  and overlaps safe; that's *why* a dumb 15-min timer is correct.
- **EC2 / AMI / instance type / EBS / VPC / subnet / security group vs NACL.**
- **IAM: root vs users vs roles, least privilege, MFA, blast radius.**
- **Key-pair SSH auth, `chmod 400/600`, deploy keys.**
- **systemd: units, `oneshot` vs `simple`, timers vs cron, journald.**
- **Secret management ladder:** env file → SSM/Secrets Manager + instance role.
- **The production ladder:** IaC, CI/CD, immutable infra/containers, CloudWatch.
- **Cost hygiene:** free tier, budgets/alarms, stop vs terminate, tagging.

---

## Quick reference — the whole thing, condensed

```bash
# on the box, one-time
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs git
sudo corepack enable && corepack prepare pnpm@latest --activate
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
git clone git@github.com:victorhwn7255/kicker-app-v1-0-5.git ~/kicker-app && cd ~/kicker-app && pnpm install
nano .env.local && chmod 600 .env.local        # paste the 8 vars
pnpm engine:tick --batch=2                       # verify once
sudo nano /etc/systemd/system/ticker-tick.service   # (paste unit)
sudo nano /etc/systemd/system/ticker-tick.timer     # (paste unit)
sudo systemctl daemon-reload && sudo systemctl enable --now ticker-tick.timer
journalctl -u ticker-tick.service -f             # watch it tweet
```

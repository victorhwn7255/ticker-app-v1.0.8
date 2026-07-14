# AWS EC2 — command cheat-sheet (Ticker engine)

Everything you need to interact with the EC2 box that runs the tweet engine.

**Your box:**
| Thing | Value |
|---|---|
| Public IP | `54.91.170.188` (changes if you Stop→Start the instance) |
| SSH key | `~/.ssh/ticker-key.pem` (on your Mac) |
| Login user | `ubuntu` |
| Region | `us-east-1` |
| App dir on box | `~/kicker-app` |
| Service (the tick) | `ticker-tick.service` |
| Timer (every 15 min) | `ticker-tick.timer` |

Two layers: commands you run **from your Mac** (to connect), and commands you run **on the box** (once you're SSH'd in).

---

## 1. Connect — from your Mac

```bash
# Log in (interactive shell on the box)
ssh -i ~/.ssh/ticker-key.pem ubuntu@54.91.170.188

# Run ONE command without logging in (quick checks)
ssh -i ~/.ssh/ticker-key.pem ubuntu@54.91.170.188 'systemctl status ticker-tick.timer'

# Copy a file TO the box
scp -i ~/.ssh/ticker-key.pem ./localfile ubuntu@54.91.170.188:~/kicker-app/

# Copy a file FROM the box
scp -i ~/.ssh/ticker-key.pem ubuntu@54.91.170.188:~/kicker-app/somefile ./

exit    # leave the SSH session (or Ctrl+D)
```

**Pro tip — make it one word.** Add to `~/.ssh/config` on your Mac:
```
Host ticker
  HostName 54.91.170.188
  User ubuntu
  IdentityFile ~/.ssh/ticker-key.pem
```
Then it's just `ssh ticker`, `scp file ticker:~/`, etc.

---

## 2. Check / control the engine — on the box (systemd)

```bash
systemctl status ticker-tick.timer       # is the scheduler alive?
systemctl list-timers ticker-tick.timer  # when's the next / last run?
journalctl -u ticker-tick.service -f     # LIVE logs (watch it tweet) — Ctrl+C to stop
journalctl -u ticker-tick.service -n 50  # last 50 log lines
journalctl -u ticker-tick.service --since "1 hour ago"

sudo systemctl start ticker-tick.service # run a tick RIGHT NOW (don't wait 15 min)
sudo systemctl stop  ticker-tick.timer   # PAUSE tweeting
sudo systemctl start ticker-tick.timer   # resume
sudo systemctl restart ticker-tick.timer # reload after editing the timer/service files
```

> `systemctl` = manage services/timers · `journalctl` = read their logs. These two
> cover 90% of running a systemd service, and are worth knowing cold for an Ops interview.

---

## 3. Manage the code + config — on the box

```bash
cd ~/kicker-app
git pull                     # get the latest code you pushed to GitHub
pnpm install                 # only if dependencies (package.json) changed
nano .env.local              # edit env vars — Ctrl+O to save, Ctrl+X to exit
pnpm engine:tick --batch=2   # run one tick by hand to test
```

Deploy new code end-to-end:
```bash
cd ~/kicker-app && git pull && pnpm install
# next timer run picks up the new code automatically (each tick is a fresh process)
```

---

## 4. Check the box's health — on the box

```bash
df -h                    # disk space
free -h                  # memory + swap
top                      # live CPU / processes (press q to quit)
pgrep -fl engine-tick    # is a tick running right now?
uptime                   # load average + how long it's been up
```

---

## 5. Control the machine itself (power)

Do this in the **EC2 Console** (Instances → select the instance → **Instance state** →
Reboot / Stop / Start). If you install the AWS CLI (`aws configure`), the equivalents:

```bash
aws ec2 reboot-instances --instance-ids i-xxxxxxxx
aws ec2 stop-instances   --instance-ids i-xxxxxxxx   # powers off, keeps the disk (small EBS charge)
aws ec2 start-instances  --instance-ids i-xxxxxxxx
```

> ⚠️ **Stop → Start changes the public IP** (unless you attach an Elastic IP), so
> you'd SSH to the new address afterward. **Reboot keeps the IP.**

---

## The 4 you'll actually use daily

```bash
ssh ticker                                    # get in (with the ~/.ssh/config alias)
journalctl -u ticker-tick.service -f          # watch it work
sudo systemctl start ticker-tick.service      # force a run now
cd ~/kicker-app && git pull && pnpm install    # deploy new code
```

---

## Gotchas

- **SSH hangs / times out** → your home IP probably changed. The security group only
  allows SSH from your IP: EC2 → **Security Groups** → `launch-wizard-1` → **Edit
  inbound rules** → set the SSH source back to **My IP**.
- **`sudo` needed** for anything that changes services (`start`/`stop`/`restart`) or
  writes outside your home dir. Reads (`status`, `journalctl`, `list-timers`) don't.
- **Secrets** live in `~/kicker-app/.env.local` on the box (`chmod 600`). Never commit
  them; never paste their values anywhere.
- **Free tier** covers this box for 12 months, then ~$8/mo. Set a billing alarm
  (Billing → Budgets) so there are no surprises.

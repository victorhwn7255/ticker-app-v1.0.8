import type { Account, SourceSection, Post } from '@/lib/types';
import type { PlanItem, TriggerType } from './types';
import { selectKeyFact } from './planner';
import { DAILY } from './config';

/**
 * The daily scheduler: turns the flat account/source reservoir into ONE day's
 * worth of realistic, uneven activity. Where planBatch is a deterministic
 * work-queue (every account, fixed caps, fixed order), this layer answers a
 * different question: "what does TODAY look like on a feed that feels alive?"
 *
 *  - a daily total drawn from [DAILY.targetMin, DAILY.targetMax] (not a constant),
 *  - heavy-tailed allocation across accounts (lognormal weights): a few accounts
 *    have a busy day (up to DAILY.maxPerAccount), most post once or twice, and a
 *    real fraction stay SILENT that day,
 *  - posts are laid on an EVEN, jittered grid across the whole 24h day (round-robin
 *    by account), so the feed is a steady drip - quality over quantity - and no two
 *    accounts ever post at the same moment.
 *
 * Everything is seeded by the DATE: random across days, deterministic within a
 * day. A crashed or re-run cron rebuilds the identical plan, and because
 * candidate ids are deterministic per (runId, account, source, trigger, lane),
 * the day's re-run upserts over itself instead of double-posting.
 */

/** xmur3 string hash -> 32-bit seed. */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 PRNG: tiny, fast, good enough for scheduling. */
export function makeRng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** UTC date key, e.g. "20260713". */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

/** A post "references" a source when its source string names the section (planner's rule). */
function referenced(posts: Post[], source: SourceSection): boolean {
  return posts.some(
    (p) => (p.source.split('/').pop()?.trim().toLowerCase() ?? '') === source.section_title.toLowerCase(),
  );
}

export interface DailyPlanItem extends PlanItem {
  scheduledAt: string; // ISO timestamp inside the plan's UTC day
}

export interface DayPlan {
  dateKey: string;
  runId: string;
  /** The day's sampled tweet target (the allocation may land a touch under). */
  target: number;
  items: DailyPlanItem[];
}

export function buildDayPlan(input: {
  accounts: Account[];
  sources: SourceSection[];
  posts: Post[];
  date?: Date;
}): DayPlan {
  const { accounts, sources, posts } = input;
  const date = input.date ?? new Date();
  const key = dateKey(date);
  const rng = makeRng(`${key}:${DAILY.seedSalt}`);
  const dayStartMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  // Freeze the plan's inputs at the day boundary. The plan is rebuilt every tick
  // and must come out IDENTICAL each time, but fresh/used classification (and the
  // conversation-partner picks) depend on published posts - which every publish
  // changes. Classifying against posts that existed BEFORE this UTC day makes the
  // plan a pure function of (date, accounts, sources, prior posts), so intraday
  // publishes can no longer reshuffle it. Without this, reshuffled slots bypassed
  // the attempted-guard and the day overshot its target 2-3x (2026-07-16 bug).
  // Fixture posts carry no postedAt and count as prior.
  const prior = posts.filter((p) => !p.postedAt || Date.parse(p.postedAt) < dayStartMs);

  // The day's total: a different number every day, inside the configured band.
  const target = DAILY.targetMin + Math.floor(rng() * (DAILY.targetMax - DAILY.targetMin + 1));

  const sourcesByAccount = new Map<string, SourceSection[]>();
  for (const s of sources) {
    if (!sourcesByAccount.has(s.account)) sourcesByAccount.set(s.account, []);
    sourcesByAccount.get(s.account)!.push(s);
  }
  const recentPostByHandle = new Map<string, Post>();
  for (const p of prior) if (!recentPostByHandle.has(p.handle)) recentPostByHandle.set(p.handle, p);

  // Heavy-tailed activity weights: lognormal spread is what makes SOME accounts
  // loud today and others silent, instead of everyone politely posting once.
  const eligible = accounts.filter((a) => (sourcesByAccount.get(a.handle)?.length ?? 0) > 0);
  const weights = eligible.map(() => Math.exp(gauss(rng)));
  const capFor = (a: Account) =>
    Math.min(DAILY.maxPerAccount, sourcesByAccount.get(a.handle)!.length);

  // Weighted draws with per-account caps. A draw that hits a capped account is
  // re-drawn; if the pool saturates we stop short of target (never force it).
  const counts = new Map<string, number>();
  const totalCapacity = eligible.reduce((n, a) => n + capFor(a), 0);
  const want = Math.min(target, totalCapacity);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  let allocated = 0;
  let attempts = 0;
  while (allocated < want && attempts < want * 30) {
    attempts++;
    let r = rng() * weightSum;
    let idx = 0;
    while (idx < eligible.length - 1 && r > weights[idx]) r -= weights[idx++];
    const acct = eligible[idx];
    const c = counts.get(acct.handle) ?? 0;
    if (c >= capFor(acct)) continue;
    counts.set(acct.handle, c + 1);
    allocated++;
  }

  // Pick WHICH sources each account posts about: fresh (never-referenced) ones first
  // - the planner's ingest priority - then rotation, shuffled within each group so the
  // same source does not lead every day. Times are NOT assigned here: timing is a
  // GLOBAL decision (below) so the whole feed stays evenly spread, not per-account.
  type Pending = { account: string; sourceId: string; trigger: TriggerType; keyFact: string; replyToHandle?: string };
  const byAccount = new Map<string, Pending[]>();
  for (const [handle, count] of counts) {
    const accountSources = sourcesByAccount.get(handle)!;
    const account = eligible.find((a) => a.handle === handle)!;
    const fresh = shuffle(accountSources.filter((s) => !referenced(prior, s)), rng);
    const used = shuffle(accountSources.filter((s) => referenced(prior, s)), rng);
    const picked = [...fresh, ...used].slice(0, count);
    byAccount.set(
      handle,
      picked.map((source) => {
        const trigger: TriggerType = referenced(prior, source) ? 'rotation' : 'ingest';
        // Occasionally answer a supply-chain sibling that has a recent post (reply thread).
        const sibling = (account.supply_chain ?? []).find((h) => recentPostByHandle.has(h));
        const conversational = sibling && rng() < 0.15;
        return {
          account: handle,
          sourceId: source.id,
          trigger: conversational ? 'conversation' : trigger,
          keyFact: selectKeyFact(source),
          ...(conversational ? { replyToHandle: sibling } : {}),
        } as Pending;
      }),
    );
  }

  // Round-robin across accounts so one account's posts land far apart, then lay every
  // post on an EVEN, jittered grid across the full 24h. Result: a steady drip through
  // the day (quality over quantity), the same account never machine-guns, and no two
  // accounts share a moment.
  const order = shuffle([...byAccount.keys()], rng);
  const queue: Pending[] = [];
  for (let round = 0, more = true; more; round++) {
    more = false;
    for (const h of order) {
      const list = byAccount.get(h)!;
      if (round < list.length) {
        queue.push(list[round]);
        more = true;
      }
    }
  }

  const N = queue.length || 1;
  const spacing = 86_400_000 / N; // even slot width across the day
  const items: DailyPlanItem[] = queue.map((it, i) => {
    // Jitter within the slot's front 60% keeps it organic while guaranteeing a gap of
    // at least ~0.4x the slot between consecutive posts, so nothing is ever simultaneous.
    const t = Math.min(i * spacing + rng() * spacing * 0.6, 86_399_000);
    return { ...it, scheduledAt: new Date(dayStartMs + t).toISOString() };
  });
  items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return { dateKey: key, runId: `day_${key}`, target, items };
}

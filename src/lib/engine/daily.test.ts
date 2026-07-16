import { describe, it, expect } from 'vitest';
import { buildDayPlan, makeRng, dateKey } from './daily';
import { DAILY } from './config';
import { makeAccount, makeSource, makePost } from './testkit';
import type { Account, SourceSection } from '@/lib/types';

/**
 * A feed-sized fixture: ~130 accounts x 4-5 sources, mirroring production shape.
 * Deterministic (no RNG here) so every test sees the identical reservoir.
 */
function fleet(): { accounts: Account[]; sources: SourceSection[] } {
  const accounts: Account[] = [];
  const sources: SourceSection[] = [];
  for (let i = 0; i < 130; i++) {
    const handle = `@ACC${i}`;
    accounts.push(makeAccount({ handle }));
    const n = 4 + (i % 2); // 4 or 5 sources each
    for (let j = 0; j < n; j++) {
      sources.push(
        makeSource({
          id: `src-${i}-${j}`,
          account: handle,
          section_title: `Section ${i}-${j}`,
        }),
      );
    }
  }
  return { accounts, sources };
}

const DATE_A = new Date('2026-07-13T00:00:00Z');
const DATE_B = new Date('2026-07-14T00:00:00Z');

describe('buildDayPlan (the randomized, realistic day schedule)', () => {
  const { accounts, sources } = fleet();

  it('is deterministic for the same day (idempotent cron re-runs)', () => {
    const a = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const b = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    expect(a.target).toBe(b.target);
    expect(a.items).toEqual(b.items);
    expect(a.runId).toBe(`day_${dateKey(DATE_A)}`);
  });

  it('is STABLE across intraday publishes (inputs frozen at the day boundary)', () => {
    // The 2026-07-16 overshoot bug: publishes flipped sources fresh->used, the
    // per-tick rebuild reshuffled the plan, and "new" slots bypassed the
    // attempted-guard. The plan must be IDENTICAL when rebuilt mid-day, no matter
    // what published since midnight.
    const planA = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const dayMs = DATE_A.getTime();
    const intraday = planA.items.slice(0, 25).map((it, i) => {
      const src = sources.find((s) => s.id === it.sourceId)!;
      return makePost({
        id: `live-${i}`,
        handle: it.account,
        source: `${it.account.slice(1)} / ${src.section_title}`,
        postedAt: new Date(dayMs + (i + 1) * 3_600_000).toISOString(), // during the plan day
      });
    });
    const planB = buildDayPlan({ accounts, sources, posts: intraday, date: DATE_A });
    expect(planB.items).toEqual(planA.items);
    expect(planB.target).toBe(planA.target);
  });

  it('differs across days (the feed is not a metronome)', () => {
    const a = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const b = buildDayPlan({ accounts, sources, posts: [], date: DATE_B });
    const key = (p: typeof a) => p.items.map((i) => `${i.account}:${i.sourceId}:${i.scheduledAt}`).join('|');
    expect(key(a)).not.toBe(key(b));
  });

  it('lands the total inside the configured daily band', () => {
    for (const date of [DATE_A, DATE_B, new Date('2026-08-01T00:00:00Z')]) {
      const plan = buildDayPlan({ accounts, sources, posts: [], date });
      expect(plan.target).toBeGreaterThanOrEqual(DAILY.targetMin);
      expect(plan.target).toBeLessThanOrEqual(DAILY.targetMax);
      // Allocation may fall a touch short of target (bounded draws), never over.
      expect(plan.items.length).toBeLessThanOrEqual(plan.target);
      expect(plan.items.length).toBeGreaterThan(plan.target * 0.9);
    }
  });

  it('spreads activity unevenly: silent accounts, single posts, and busy accounts', () => {
    const plan = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const counts = new Map<string, number>();
    for (const i of plan.items) counts.set(i.account, (counts.get(i.account) ?? 0) + 1);

    const silent = accounts.length - counts.size;
    const busy = [...counts.values()].filter((c) => c >= 3).length;
    expect(silent).toBeGreaterThan(0); // some accounts skip the day entirely
    expect(busy).toBeGreaterThan(0); // some accounts have a busy day
    for (const [handle, c] of counts) {
      const own = sources.filter((s) => s.account === handle).length;
      expect(c).toBeLessThanOrEqual(Math.min(DAILY.maxPerAccount, own));
    }
  });

  it('never posts the same source twice in one day', () => {
    const plan = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const seen = new Set(plan.items.map((i) => `${i.account}::${i.sourceId}`));
    expect(seen.size).toBe(plan.items.length);
  });

  it('schedules every post inside the plan day, sorted, with per-account spacing', () => {
    const plan = buildDayPlan({ accounts, sources, posts: [], date: DATE_A });
    const dayStart = Date.parse('2026-07-13T00:00:00Z');
    const dayEnd = dayStart + 86_400_000;

    let prev = 0;
    const byAccount = new Map<string, number[]>();
    for (const item of plan.items) {
      const t = Date.parse(item.scheduledAt);
      expect(t).toBeGreaterThanOrEqual(dayStart);
      expect(t).toBeLessThan(dayEnd);
      expect(t).toBeGreaterThanOrEqual(prev); // sorted output
      prev = t;
      if (!byAccount.has(item.account)) byAccount.set(item.account, []);
      byAccount.get(item.account)!.push(t);
    }
    // Spacing is best-effort (bounded resampling), so assert the common case:
    // the overwhelming majority of same-account gaps respect the minimum.
    let gaps = 0;
    let tight = 0;
    for (const times of byAccount.values()) {
      const sorted = [...times].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        gaps++;
        if (sorted[i] - sorted[i - 1] < DAILY.minGapMinutes * 60_000) tight++;
      }
    }
    expect(gaps).toBeGreaterThan(0);
    expect(tight / gaps).toBeLessThan(0.1);
  });

  it('prefers fresh (never-referenced) sources and marks them ingest', () => {
    const posts = [makePost({ handle: '@ACC0', source: 'ACC0 / Section 0-0' })];
    const withRef = sources.map((s) =>
      s.id === 'src-0-0' ? { ...s, section_title: 'Section 0-0' } : s,
    );
    const plan = buildDayPlan({ accounts, sources: withRef, posts, date: DATE_A });
    const acc0 = plan.items.filter((i) => i.account === '@ACC0');
    for (const item of acc0) {
      if (item.sourceId === 'src-0-0') expect(['rotation', 'conversation']).toContain(item.trigger);
      else expect(['ingest', 'conversation']).toContain(item.trigger);
    }
  });
});

describe('makeRng (seeded determinism)', () => {
  it('same seed -> same stream; different seed -> different stream', () => {
    const a = makeRng('x');
    const b = makeRng('x');
    const c = makeRng('y');
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

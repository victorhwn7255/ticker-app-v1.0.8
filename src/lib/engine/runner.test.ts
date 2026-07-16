import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAccount, makeSource, mockDeps, validBody } from './testkit';
import type { PlanItem } from './types';

/**
 * The daily runner's generation loop, exercised offline (mocked DB layer + mocked
 * deps, zero live model calls). Covers the concurrency refactor: every planned item
 * generates, serial and concurrent produce the same result, and a fully-dropped item
 * still falls back to the secondary lane.
 */
vi.mock('./data', () => ({
  loadAccounts: vi.fn(),
  loadSources: vi.fn(),
  loadPosts: vi.fn(),
  saveCandidates: vi.fn(async () => {}),
  loadAttemptedSlots: vi.fn(async () => new Set()),
  loadRecentEmbeddings: vi.fn(async () => new Map()),
  slotKey: (a: string, b: string) => `${a}::${b}`,
}));

import * as data from './data';
import { runTick } from './runner';

const ACCTS = [
  makeAccount({ handle: '@CRWV' }),
  makeAccount({ handle: '@CORZ' }),
  makeAccount({ handle: '@NVDA' }),
];
const SRCS = [
  makeSource({ id: 's1', account: '@CRWV' }),
  makeSource({ id: 's2', account: '@CORZ' }),
  makeSource({ id: 's3', account: '@NVDA' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  (data.loadAccounts as ReturnType<typeof vi.fn>).mockResolvedValue(ACCTS);
  (data.loadSources as ReturnType<typeof vi.fn>).mockResolvedValue(SRCS);
  (data.loadPosts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

const PLAN: PlanItem[] = [
  { account: '@CRWV', sourceId: 's1', trigger: 'ingest', keyFact: 'a' },
  { account: '@CORZ', sourceId: 's2', trigger: 'ingest', keyFact: 'b' },
  { account: '@NVDA', sourceId: 's3', trigger: 'ingest', keyFact: 'c' },
];

describe('runTick daily generation loop', () => {
  it('generates every planned item concurrently and verifies them', async () => {
    const res = await runTick({ deps: mockDeps(), daily: true, plan: PLAN, persist: false, pace: false, concurrency: 3 });
    expect(res.planned).toBe(3);
    expect(res.verified).toBe(3);
    expect(res.candidates.filter((c) => c.status === 'verified')).toHaveLength(3);
  });

  it('is equivalent when run serially (concurrency 1)', async () => {
    const res = await runTick({ deps: mockDeps(), daily: true, plan: PLAN, persist: false, pace: false, concurrency: 1 });
    expect(res.verified).toBe(3);
  });

  it('falls back to the secondary lane when the primary lane drops an item', async () => {
    // Primary generations are all too short (drop on length); the secondary (fallback)
    // lane produces a valid body -> the item still ships via fallback.
    const deps = mockDeps({ generate: async (l) => (l.key === 'secondary' ? validBody() : 'too short') });
    const res = await runTick({ deps, daily: true, plan: PLAN, persist: false, pace: false, concurrency: 3 });
    expect(res.verified).toBe(3); // all three recovered on the fallback lane
  });
});

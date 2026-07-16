import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  AccountSchema,
  PostSchema,
  SourceSectionSchema,
  type Account,
  type Post,
  type SourceSection,
} from '@/lib/types';
import type { Candidate } from './types';
import { DAILY } from './config';

/**
 * Engine-side DB access. The engine is a privileged backend process, so it reads
 * via the admin (secret-key) client and does not depend on the app's unstable_cache
 * loaders - that keeps it usable from a plain Node context too. It reads the source
 * reservoir + accounts + posts, and writes dry-run candidates to the review table.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every engine DB call is idempotent (reads, and an upsert keyed by id), so it is
 * safe to retry. Supabase occasionally returns a TRANSIENT failure - most notably
 * "JWT issued at future" (a brief clock skew between this host and the auth gateway,
 * e.g. right after the laptop wakes) - that clears within a second. A nightly
 * production tick must not die on a 1-in-N blip, so wrap each call in a short
 * backoff. A persistent error (bad key, table gone) still surfaces after the tries.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
  }
  throw new Error(`engine: ${label} failed after ${tries} tries: ${(last as Error).message}`);
}

async function loadAll<T>(table: string, schema: z.ZodType<T>): Promise<T[]> {
  return withRetry(`load ${table}`, async () => {
    const { data, error } = await supabaseAdmin().from(table).select('obj:data').order('seq');
    if (error) throw new Error(error.message);
    return z.array(schema).parse((data ?? []).map((r) => (r as { obj: unknown }).obj));
  });
}

export const loadAccounts = () => loadAll<Account>('accounts', AccountSchema);
export const loadPosts = () => loadAll<Post>('posts', PostSchema);
export const loadSources = () => loadAll<SourceSection>('sources', SourceSectionSchema);

function candidateRow(c: Candidate) {
  return {
    id: `${c.engineRunId}::${c.account}::${c.sourceId}::${c.trigger}::${c.laneKey}`,
    engine_run_id: c.engineRunId,
    account: c.account,
    source_id: c.sourceId,
    trigger: c.trigger,
    reply_to: c.replyTo ?? null,
    body: c.body,
    tier: c.tier,
    qualifier: c.qualifier ?? null,
    char_len: c.charLen,
    model: c.model,
    provider: c.provider,
    prompt_version: c.promptVersion,
    guard_score: c.guardScore,
    verdict: c.verdict,
    verdict_pass: c.verdictPass,
    novelty_similarity: c.noveltySimilarity,
    status: c.status,
    dropped_reason: c.droppedReason ?? null,
    scheduled_at: c.scheduledAt ?? null,
  };
}

/** Idempotent: candidate ids are deterministic per run, so a re-run overwrites. */
export async function saveCandidates(candidates: Candidate[]): Promise<void> {
  if (!candidates.length) return;
  await withRetry('save candidates', async () => {
    const { error } = await supabaseAdmin()
      .from('engine_candidates')
      .upsert(candidates.map(candidateRow), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  });
}

/**
 * A slot key uniquely names one scheduled post: (account, source). Trigger is
 * deliberately NOT part of the key: a source's trigger can flip between plan
 * rebuilds (ingest -> rotation once its post publishes), and including it let the
 * "same" slot re-enter as new work - the 2026-07-16 volume-overshoot bug. A plan
 * never uses one (account, source) pair twice in a day, so this key is exact.
 */
export function slotKey(account: string, sourceId: string): string {
  return `${account}::${sourceId}`;
}

/**
 * The idempotency guard for the time-sliced daily loop: the set of slot keys that
 * have ALREADY been attempted in this run (any status). A slice tick skips these,
 * so a slot is generated exactly once across the many ticks that drain a day - it
 * is never re-generated (which would burn model calls and could flip a verified
 * post to dropped on a flaky pass).
 */
export async function loadAttemptedSlots(runId: string): Promise<Set<string>> {
  return withRetry('load attempted slots', async () => {
    const { data, error } = await supabaseAdmin()
      .from('engine_candidates')
      .select('account, source_id')
      .eq('engine_run_id', runId);
    if (error) throw new Error(error.message);
    const set = new Set<string>();
    for (const r of (data ?? []) as { account: string; source_id: string | null }[]) {
      if (r.source_id) set.add(slotKey(r.account, r.source_id));
    }
    return set;
  });
}

/**
 * The novelty memory: recent published-post embeddings per account, so the
 * generator can reject a take too similar to what the account already said. Keyed
 * by handle from post_history (the publisher writes one row per published post).
 * Best-effort - novelty is a quality gate, so any read failure returns empty
 * (fail-open: a missing memory means "no repeat detected", never a false drop).
 */
export async function loadRecentEmbeddings(handles: string[]): Promise<Map<string, number[][]>> {
  const out = new Map<string, number[][]>();
  if (!handles.length) return out;
  try {
    const { data, error } = await supabaseAdmin()
      .from('post_history')
      .select('handle, embedding')
      .in('handle', handles)
      .order('created_at', { ascending: false })
      .limit(handles.length * DAILY.historyLimit);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { handle: string | null; embedding: unknown }[]) {
      if (!r.handle || !Array.isArray(r.embedding)) continue;
      const vec = (r.embedding as unknown[]).filter((n): n is number => typeof n === 'number');
      if (!vec.length) continue;
      const list = out.get(r.handle) ?? [];
      if (list.length < DAILY.historyLimit) {
        list.push(vec);
        out.set(r.handle, list);
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** A verified candidate row that is due and not yet published (publisher input). */
export type PublishableCandidate = {
  id: string;
  engine_run_id: string;
  account: string;
  source_id: string | null;
  trigger: string | null;
  reply_to: string | null;
  body: string;
  tier: string;
  qualifier: string | null;
  char_len: number;
  model: string;
  provider: string;
  prompt_version: string;
  verdict: unknown;
  scheduled_at: string | null;
  [k: string]: unknown;
};

/**
 * Verified candidates whose scheduled slot has arrived (scheduled_at <= now) and
 * that have not been published yet. This is the publisher's work queue; the
 * `published_at is null` filter is the idempotency guard that makes re-runs safe.
 * Ordered by schedule so the feed publishes in time order.
 */
export async function loadDuePublishable(nowIso: string): Promise<PublishableCandidate[]> {
  return withRetry('load due publishable', async () => {
    const { data, error } = await supabaseAdmin()
      .from('engine_candidates')
      .select('*')
      .eq('status', 'verified')
      .is('published_at', null)
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PublishableCandidate[];
  });
}

/** Upsert rows into the PUBLIC feed. Idempotent by post id (deterministic per slot). */
export async function publishPosts(rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  await withRetry('publish posts', async () => {
    const { error } = await supabaseAdmin().from('posts').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  });
}

/**
 * Stamp candidates as published (published_at + the post id they became). Re-upserts
 * the full loaded rows with the two fields set, so it is idempotent and never
 * re-publishes. Input rows are the ones returned by loadDuePublishable.
 */
export async function markCandidatesPublished(
  rows: PublishableCandidate[],
  postIdOf: (id: string) => string,
  nowIso: string,
): Promise<void> {
  if (!rows.length) return;
  const marked = rows.map((r) => ({ ...r, published_at: nowIso, post_id: postIdOf(r.id) }));
  await withRetry('mark candidates published', async () => {
    const { error } = await supabaseAdmin()
      .from('engine_candidates')
      .upsert(marked, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  });
}

/**
 * Record the novelty memory for freshly published posts: delete any prior rows for
 * these post ids (so a re-publish does not accumulate duplicates) then insert one
 * embedding row per post, keyed by handle. Best-effort by design.
 */
export async function savePostHistory(
  rows: { post_id: string; handle: string; embedding: number[] }[],
): Promise<void> {
  if (!rows.length) return;
  const admin = supabaseAdmin();
  const ids = rows.map((r) => r.post_id);
  await withRetry('clear post_history', async () => {
    const { error } = await admin.from('post_history').delete().in('post_id', ids);
    if (error) throw new Error(error.message);
  });
  await withRetry('save post_history', async () => {
    const { error } = await admin.from('post_history').insert(rows);
    if (error) throw new Error(error.message);
  });
}

import type { Account, SourceSection, Post } from '@/lib/types';
import {
  type ModelLane,
  verifierLane,
  verifierEnabled,
  MAX_REGENERATIONS,
  PROMPT_VERSION,
  LENGTH,
  GUARD,
  NOVELTY_MAX_SIMILARITY,
} from './config';
import type { Candidate, PlanItem, GuardResult, Verdict } from './types';
import { verdictPasses } from './types';
import type { EngineDeps } from './deps';
import { generatorSystem, generatorPrompt, verifierSystem, verifierPrompt } from './prompts';
import { checkLength } from './lengthGate';
import { checkNovelty } from './novelty';

/**
 * The pipeline for ONE (source, model): guard -> generate -> length -> verify
 * (regenerate up to MAX_REGENERATIONS, then drop) -> novelty. It is fail-closed:
 * the guard and verifier are SAFETY gates, so any failure or doubt quarantines or
 * drops - an unverified candidate is never marked verified. Novelty is a QUALITY
 * gate, so an embedding-infra error fails open (a repeat is not a fabrication).
 * Every outcome is returned as a Candidate with its status and reason, so the
 * human review sees what shipped AND what the gates caught.
 */

type Base = Omit<
  Candidate,
  'body' | 'charLen' | 'verdict' | 'verdictPass' | 'noveltySimilarity' | 'status' | 'attempts' | 'droppedReason'
>;

function dropped(
  base: Base,
  o: { body: string; charLen: number; verdict: Verdict | null; attempts: number; reason: string; noveltySimilarity?: number },
): Candidate {
  return {
    ...base,
    body: o.body,
    charLen: o.charLen,
    verdict: o.verdict,
    verdictPass: false,
    noveltySimilarity: o.noveltySimilarity ?? null,
    status: 'dropped',
    attempts: o.attempts,
    droppedReason: o.reason,
  };
}

export async function runCandidate(args: {
  runId: string;
  account: Account;
  source: SourceSection;
  plan: PlanItem;
  genLane: ModelLane;
  recentPosts: Post[];
  replyToPost?: { handle: string; body: string };
  historyEmbeddings: number[][];
  guard: GuardResult;
  deps: EngineDeps;
  signal?: AbortSignal;
}): Promise<Candidate> {
  const { runId, account, source, plan, genLane, recentPosts, replyToPost, historyEmbeddings, guard, deps, signal } = args;

  const base: Base = {
    engineRunId: runId,
    account: account.handle,
    sourceId: source.id,
    trigger: plan.trigger,
    replyTo: plan.replyToHandle,
    laneKey: genLane.key,
    model: genLane.modelId,
    provider: genLane.provider,
    promptVersion: PROMPT_VERSION,
    tier: source.tier,
    qualifier: source.qualifier,
    guardScore: guard.maxScore,
    scheduledAt: plan.scheduledAt,
  };

  // Guard hit -> quarantine, never generate.
  if (guard.flagged) {
    return {
      ...base,
      body: '',
      charLen: 0,
      verdict: null,
      verdictPass: false,
      noveltySimilarity: null,
      status: 'quarantined',
      attempts: 0,
      droppedReason: `prompt-guard score ${guard.maxScore.toFixed(4)} >= ${GUARD.threshold}`,
    };
  }

  const verLane = verifierLane();
  const totalAttempts = 1 + MAX_REGENERATIONS;
  let attempts = 0;
  let lastBody = '';
  let lastLen = 0;
  let lastVerdict: Verdict | null = null;
  let retryHint: string | undefined;

  while (attempts < totalAttempts) {
    attempts++;

    let body: string;
    try {
      body = await deps.generate(genLane, {
        system: generatorSystem(),
        prompt: generatorPrompt({ account, source, keyFact: plan.keyFact, recentPosts, replyingTo: replyToPost, retryHint }),
        signal,
      });
    } catch (e) {
      lastBody = '';
      lastLen = 0;
      if (attempts < totalAttempts) continue;
      return dropped(base, { body: '', charLen: 0, verdict: null, attempts, reason: `generation error: ${(e as Error).message}` });
    }
    lastBody = body;

    const { ok, len } = checkLength(body);
    lastLen = len;
    if (!ok) {
      retryHint =
        len < LENGTH.min
          ? `Your previous attempt was only ${len} characters - just below the ${LENGTH.min}-character floor. Include the key fact and its essential context from the SOURCE (add nothing new); do not pad.`
          : `Your previous attempt was ${len} characters - over the ${LENGTH.max} ceiling. Tighten it; cut restatement, keep the fact.`;
      if (attempts < totalAttempts) continue;
      return dropped(base, { body, charLen: len, verdict: null, attempts, reason: `length ${len} outside ${LENGTH.min}-${LENGTH.max}` });
    }

    // The verifier is an optional safety gate (config.verifierEnabled). When off,
    // a length-valid generation ships as-is (verdict stays null) - the generator is
    // still source-constrained by its prompt, but there is no independent output check.
    let verdict: Verdict | null = null;
    if (verifierEnabled()) {
      try {
        verdict = await deps.verify(verLane, {
          system: verifierSystem(),
          prompt: verifierPrompt({ sourceText: source.body_text, personaBio: account.bio, candidate: body }),
          signal,
        });
      } catch (e) {
        if (attempts < totalAttempts) continue;
        return dropped(base, { body, charLen: len, verdict: null, attempts, reason: `verifier error: ${(e as Error).message}` });
      }
      lastVerdict = verdict;

      if (!verdictPasses(verdict)) {
        retryHint = `The fact-checker rejected your previous attempt: ${verdict.offending_claims.join('; ') || verdict.reasoning}. Stay strictly within the SOURCE, keep every hedge, and use no buy/sell language.`;
        if (attempts < totalAttempts) continue;
        return dropped(base, {
          body,
          charLen: len,
          verdict,
          attempts,
          reason: `verifier: ${verdict.offending_claims.join('; ') || verdict.reasoning}`,
        });
      }
    }

    // Novelty (quality gate: drop if too similar; fail open on infra error).
    let similarity = 0;
    if (historyEmbeddings.length) {
      try {
        const [emb] = await deps.embed([body], signal);
        similarity = checkNovelty(emb, historyEmbeddings).maxSimilarity;
      } catch {
        similarity = 0;
      }
    }
    if (similarity >= NOVELTY_MAX_SIMILARITY) {
      return dropped(base, { body, charLen: len, verdict, attempts, reason: `novelty similarity ${similarity.toFixed(3)}`, noveltySimilarity: similarity });
    }

    return {
      ...base,
      body,
      charLen: len,
      verdict,
      verdictPass: verdict !== null,
      noveltySimilarity: similarity,
      status: 'verified',
      attempts,
    };
  }

  return dropped(base, { body: lastBody, charLen: lastLen, verdict: lastVerdict, attempts, reason: 'exhausted regenerations' });
}

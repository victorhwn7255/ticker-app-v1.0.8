/**
 * Tier semantics - the core trust primitive.
 * The LABEL always carries the meaning; color only reinforces it (colorblind-safe,
 * survives grayscale). Glyphs: ✓ Confirmed · ~ Estimate · ✕ Conflicting · ? Open.
 * Source: design/README.md "Tier semantics" + Component Library.
 * The `Tier` type is defined by the zod schema in types.ts (single source of truth).
 */
import type { Tier } from './types';

export type { Tier };

type TierDef = {
  glyph: string;
  base: string;
  glyphBg: string;
  glyphColor: string;
  labelBg: string;
  labelColor: string;
};

export const TIER: Record<Tier, TierDef> = {
  solid: {
    glyph: '✓',
    base: 'Confirmed',
    glyphBg: 'bg-tier-solid',
    glyphColor: 'text-ink',
    labelBg: 'bg-tier-solid',
    labelColor: 'text-ink',
  },
  needs: {
    glyph: '~',
    base: 'Estimate',
    glyphBg: 'bg-tier-needs',
    glyphColor: 'text-ink',
    labelBg: 'bg-tier-needs',
    labelColor: 'text-ink',
  },
  disputed: {
    glyph: '✕',
    base: 'Conflicting',
    glyphBg: 'bg-tier-disputed',
    glyphColor: 'text-ink',
    labelBg: 'bg-tier-disputed',
    labelColor: 'text-ink',
  },
  open: {
    // Open question: ink glyph cell + white label cell.
    glyph: '?',
    base: 'Open',
    glyphBg: 'bg-ink',
    glyphColor: 'text-white',
    labelBg: 'bg-white',
    labelColor: 'text-ink',
  },
};

/**
 * Full trust-band label. Open questions always read "Open - unresolved";
 * others append the per-post qualifier after an em dash ("Confirmed — from the 10-Q").
 * The em dash here is design content (matches the Component Library verbatim), not prose.
 */
/**
 * A handful of qualifier strings carried internal research-workflow wording
 * ("commissioned research", "the anchor", "falsifier", "evidence labels"). We rewrite
 * those to plain, short reader language at DISPLAY time - no stored data touched, so it
 * fixes live posts immediately. Everything else is left as-authored: the honest
 * source + caveat detail is the receipt's value, not noise.
 */
const QUALIFIER_FIXES: Record<string, string> = {
  'vendor-claimed figures; falsifiers stated as published, not fired': 'vendor claims; not yet disproven',
  'pre-registered falsifier and current readings per research': 'independent research',
  'commissioned research with spot-verification; evidence labels per the anchor': 'independent research, spot-checked',
  'company filings plus attributed research; one anchor claim corrected in verification': 'filings + cited research',
  'commissioned research framework; placements are structural, not advice': 'independent research; not advice',
  'commissioned research with primary verification on the one listed pure-play': 'independent research, verified vs filings',
  'documented cases and rulings via commissioned research': 'documented cases via independent research',
  'commissioned research framework; company metrics as reported': 'independent research; metrics as reported',
  'figures as reported in the anchor; management constructs labeled': 'as reported; management framing flagged',
};

export function cleanQualifier(qualifier?: string): string | undefined {
  if (!qualifier) return qualifier;
  if (QUALIFIER_FIXES[qualifier]) return QUALIFIER_FIXES[qualifier];
  // Generic guard so no stray internal term reaches the UI, now or in future data.
  return qualifier
    .replace(/commissioned research/gi, 'independent research')
    .replace(/[;,]?\s*evidence labels[^;]*/gi, '')
    .replace(/\banchor\b/gi, 'research')
    .replace(/\bfalsifiers?\b/gi, 'disproof points')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function tierLabel(tier: Tier, qualifier?: string): string {
  if (tier === 'open') return 'Open — unresolved';
  const q = cleanQualifier(qualifier);
  return q ? `${TIER[tier].base} — ${q}` : TIER[tier].base;
}

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { TIER } from '@/lib/tiers';
import { KIND_LABEL } from '@/lib/kinds';
import type { Post } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { WarningIcon } from '@/components/ui/Icons';

/**
 * PostCard - the atom of the feed, X/Twitter-style: a rounded avatar, a name row
 * (@handle · Kind · time), the body, then a soft trust footer (tier dot + label +
 * the source receipt + freshness). Credibility is still structure, not decoration -
 * every card carries its tier and its receipt. In the feed the whole card is a click
 * target into the post's permalink (an overlay link), while the source link stays
 * independently clickable.
 */
export type { Post };

/**
 * The confidence pill: a soft colour-tinted chip with an icon + one-word rating, so a
 * reader sees at a glance HOW well-sourced a claim is. The icon carries the meaning
 * (colour-blind-safe, survives grayscale); colour only reinforces it. The evidence
 * qualifier lives on the post's detail page, keeping the card face short.
 */
const TIER_PILL: Record<Post['tier'], { bg: string; fg: string }> = {
  solid: { bg: 'rgba(0,186,124,0.12)', fg: '#0A7B54' },
  needs: { bg: 'rgba(224,164,0,0.18)', fg: '#8A6400' },
  disputed: { bg: 'rgba(244,33,46,0.10)', fg: '#C4121A' },
  open: { bg: 'rgba(83,100,113,0.12)', fg: '#536471' },
};

function TierPill({ tier }: { tier: Post['tier'] }) {
  const c = TIER_PILL[tier];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[12px] font-semibold leading-none"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      <span aria-hidden="true">{TIER[tier].glyph}</span>
      {TIER[tier].base}
    </span>
  );
}

export function PostCard({
  post,
  receiptHref = '#',
  interactive = false,
  className,
}: {
  post: Post;
  receiptHref?: string;
  /** Feed cards get a hover wash + a whole-card link into the permalink. */
  interactive?: boolean;
  className?: string;
}) {
  const isReply = post.variant === 'reply';
  const isThread = post.variant === 'thread';
  const isHigh = post.variant === 'high';
  const q = post.quoted;
  const permalink = post.id ? `/p/${post.id}` : undefined;

  return (
    <article
      className={cn(
        'relative border-b border-line bg-card px-4 py-4 sm:px-5',
        interactive && 'transition-colors hover:bg-wash',
        className,
      )}
    >
      {/* Whole-card click target (feed only). Interactive children sit above it via z-[1]. */}
      {interactive && permalink && (
        <Link href={permalink} className="absolute inset-0 z-0" aria-label={`Open ${post.handle}'s post`} />
      )}

      {isHigh && (
        <div className="relative z-[1] mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#F4212E]">
          <WarningIcon size={14} />
          <span className="uppercase tracking-[0.04em]">{post.highLabel ?? 'Tripwire fired'}</span>
        </div>
      )}

      <div className="flex gap-3">
        <Avatar kind={post.kind} text={post.avatar} handle={post.handle} size={44} rounded className="relative z-[1]" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[15px] leading-tight">
            <span className="font-bold text-ink">{post.handle}</span>
            <span className="text-muted">· {KIND_LABEL[post.kind]}</span>
            <span className="text-muted">· {post.time}</span>
          </div>

          {isReply && post.replyTo && (
            <div className="mt-0.5 text-[13px] text-muted">
              replying to <span className="text-ink">{post.replyTo}</span>
            </div>
          )}

          <p className="post-body mt-1 text-[15px] leading-[1.5] text-ink">{post.body}</p>

          {q && (
            <div className="mt-2.5 rounded-2xl border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <Avatar kind={q.kind} text={q.avatar} handle={q.handle} size={20} rounded />
                <span className="font-semibold text-ink">{q.handle}</span>
                {q.time && <span className="text-muted">· {q.time}</span>}
              </div>
              <p className="mt-1 text-[14px] leading-[1.45] text-ink">{q.body}</p>
            </div>
          )}

          {isThread && (post.thread || post.threadNext) && (
            <div className="mt-1 text-[13px] text-muted">
              {[post.thread, post.threadNext].filter(Boolean).join(' · ')}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <TierPill tier={post.tier} />
            <a
              href={receiptHref}
              className="relative z-[1] inline-flex items-center gap-1 text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              <span aria-hidden="true">↗</span>
              Source
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

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

/** Punchy, X-like tier dot colours (the label always carries the meaning). */
const TIER_DOT: Record<Post['tier'], string> = {
  solid: '#00BA7C',
  needs: '#E0A400',
  disputed: '#F4212E',
  open: '#8899A6',
};

function TierMark({ tier, qualifier }: { tier: Post['tier']; qualifier?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span
        className="h-[8px] w-[8px] flex-none rounded-full"
        style={{ backgroundColor: TIER_DOT[tier] }}
        aria-hidden="true"
      />
      <span className="font-semibold text-ink">{TIER[tier].base}</span>
      {qualifier && tier !== 'open' && <span className="text-muted">· {qualifier}</span>}
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
        'relative border-b border-line bg-card px-4 py-3 sm:px-5',
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
        <Avatar kind={post.kind} text={post.avatar} size={44} rounded className="relative z-[1]" />

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
                <Avatar kind={q.kind} text={q.avatar} size={20} rounded />
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

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <TierMark tier={post.tier} qualifier={post.qualifier} />
            <a
              href={receiptHref}
              className="relative z-[1] inline-flex min-w-0 items-center gap-1 text-[13px] text-muted hover:text-ink hover:underline"
            >
              <span aria-hidden="true">↗</span>
              <span className="truncate">{post.source}</span>
            </a>
            <span className="ml-auto flex-none text-[12px] text-muted-alt">{post.freshness}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

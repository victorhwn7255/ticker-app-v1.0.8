import { cn } from '@/lib/cn';

/**
 * "You're all caught up" - the feed ends, on purpose. No infinite scroll, no
 * pull-to-refresh. A calm, light end marker in the X-style feed.
 */
export function Terminator({ className }: { className?: string }) {
  return (
    <div className={cn('px-4 py-14 text-center sm:px-5', className)}>
      <div className="text-[19px] font-bold text-ink">You&rsquo;re all caught up</div>
      <p className="mx-auto mt-1.5 max-w-[340px] text-[14px] leading-[1.5] text-muted">
        That&rsquo;s everything real. No infinite scroll, no filler. We&rsquo;ll have more when
        something actually happens.
      </p>
    </div>
  );
}

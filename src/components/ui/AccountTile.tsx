import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { Kind } from '@/lib/kinds';
import { Avatar } from './Avatar';
import { KindBadge } from './KindBadge';

/**
 * Directory / list row: avatar + handle + kind badge + one-line descriptor.
 * When `href` is given the whole row links to the account profile.
 */
export type AccountTileData = {
  handle: string;
  kind: Kind;
  avatar?: string;
  desc: string;
};

export function AccountTile({
  account,
  href,
  className,
}: {
  account: AccountTileData;
  href?: string;
  className?: string;
}) {
  const identity = (
    <>
      <Avatar kind={account.kind} text={account.avatar} size={40} rounded />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="font-bold text-[14px]">{account.handle}</span>
          <KindBadge kind={account.kind} size="xs" showIcon={false} />
        </div>
        <div className="mt-[3px] text-[13px] leading-[1.4] text-muted">{account.desc}</div>
      </div>
    </>
  );

  return (
    <div className={cn('flex items-start gap-[11px] rounded-xl border border-line p-[12px]', className)}>
      {href ? (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-start gap-[11px] text-ink no-underline transition-colors hover:opacity-80"
        >
          {identity}
        </Link>
      ) : (
        identity
      )}
    </div>
  );
}

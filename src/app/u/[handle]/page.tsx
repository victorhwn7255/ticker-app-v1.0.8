import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { getAccount, getPosts, getResearchPage, attachReceipts } from '@/lib/content';
import { profileHref, researchHref, siteUrl } from '@/lib/links';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Account } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { KindBadge } from '@/components/ui/KindBadge';
import { MentionChip } from '@/components/ui/MentionChip';
import { TierChip } from '@/components/ui/TierChip';
import { Button } from '@/components/ui/Button';
import { RailCard } from '@/components/ui/RailCard';
import { SectionDivider } from '@/components/ui/SectionDivider';
import { PostCard } from '@/components/feed/PostCard';

type Params = { handle: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { handle } = await params;
  const account = await getAccount('@' + handle);
  if (!account) return {};
  return { title: `${account.handle} on Ticker`, description: account.bio };
}

export const dynamic = 'force-dynamic';

/** "What @X knows" panel - the account's key claims, each tier-chipped. */
function KnowsCard({ account, className }: { account: Account; className?: string }) {
  const knows = account.knows!;
  return (
    <RailCard
      className={className}
      header={
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
          What {account.handle} knows
        </span>
      }
      bodyClassName="px-[14px] pt-[4px] pb-[12px]"
    >
      {knows.map((k, i) => (
        <div
          key={k.claim}
          className={cn('py-[11px]', i < knows.length - 1 && 'border-b-2 border-[#eee]')}
        >
          <div className="mb-[7px] text-[13.5px] leading-[1.5]">{k.claim}</div>
          <TierChip tier={k.tier} size="inline" />
        </div>
      ))}
    </RailCard>
  );
}

/** The black "door" to the full research page. */
function ResearchDoor({
  href,
  sectionCount,
  className,
}: {
  href: string;
  sectionCount?: number;
  className?: string;
}) {
  return (
    <div className={cn('border bg-ink px-[16px] py-[16px] text-page shadow', className)}>
      <div className="font-sans text-[16px] font-bold">The full research page</div>
      <p className="mb-[12px] mt-[6px] font-mono text-[11px] leading-[1.55] text-on-dark">
        {sectionCount ? `${sectionCount} tier-annotated sections` : 'Tier-annotated sections'} · open
        questions · what would prove this wrong.
      </p>
      <Button variant="subscribe" size="md" href={href} className="w-full shadow-hard-yellow">
        Open research page →
      </Button>
    </div>
  );
}

export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const account = await getAccount('@' + handle);
  if (!account) notFound();

  const posts = (await getPosts()).filter((p) => p.handle === account.handle);
  const items = await attachReceipts(posts);
  const research = account.research_slug ? await getResearchPage(account.research_slug) : undefined;
  const doorHref = account.research_slug ? researchHref(account.research_slug) : undefined;

  // schema.org: the profile of a named research desk (Organization fits all three
  // kinds - a company voice, a chokepoint desk, a theme desk).
  const ticker = account.kind === 'company' ? account.handle.replace(/^@/, '') : undefined;
  const profileLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Organization',
      name: account.display_name ?? account.handle,
      alternateName: account.handle,
      description: account.desc,
      url: `${siteUrl()}${profileHref(account.handle)}`,
      ...(ticker ? { image: `${siteUrl()}/avatars/${ticker}.png` } : {}),
    },
  };

  return (
    <div className="mx-auto flex max-w-[924px] flex-col gap-[14px] py-4 md:gap-6 md:py-6">
      <JsonLd data={profileLd} />
      {/* header */}
      <header className="border bg-card p-[16px] shadow md:p-[26px]">
        <div className="flex items-start gap-[14px] md:gap-[20px]">
          <Avatar kind={account.kind} text={account.avatar} handle={account.handle} size={64} className="md:hidden" />
          <Avatar
            kind={account.kind}
            text={account.avatar}
            handle={account.handle}
            size={88}
            className="hidden md:inline-flex"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[7px]">
              <span className="font-mono text-[20px] font-bold leading-none md:text-[26px]">
                {account.handle}
              </span>
              <KindBadge kind={account.kind} />
              {account.domain && <MentionChip>{account.domain}</MentionChip>}
            </div>
            <p className="post-body mt-[12px] max-w-[640px] text-[14px] leading-[1.55] md:text-[16px]">
              {account.bio}
            </p>
            {account.freshness && (
              <div className="mt-[13px] flex items-center gap-[7px] font-mono text-[12px] text-muted">
                <span className="inline-block h-[10px] w-[10px] flex-none border bg-tier-solid" />
                {account.freshness}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* columns */}
      <div className="flex flex-col gap-[14px] md:flex-row md:items-start md:gap-[24px]">
        {/* main column */}
        <div className="flex w-full flex-col gap-[14px] md:w-[600px] md:flex-none">
          {/* mobile-only: cards live in the rail on desktop */}
          {account.knows && <KnowsCard account={account} className="md:hidden" />}
          {doorHref && (
            <ResearchDoor
              href={doorHref}
              sectionCount={research?.section_count}
              className="md:hidden"
            />
          )}

          <SectionDivider className="mt-[4px] md:mt-0">Posts · newest first</SectionDivider>
          {items.map(({ post, receiptHref }) => (
            <PostCard key={post.id ?? post.time} post={post} receiptHref={receiptHref} interactive />
          ))}
        </div>

        {/* right rail (desktop) */}
        <aside className="hidden flex-col gap-[16px] md:flex md:w-[300px] md:flex-none">
          {account.knows && <KnowsCard account={account} />}
          {doorHref && <ResearchDoor href={doorHref} sectionCount={research?.section_count} />}
          {account.supply_chain && account.supply_chain.length > 0 && (
            <RailCard
              header={
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
                  Its supply chain
                </span>
              }
              bodyClassName="flex flex-wrap gap-[7px] px-[14px] py-[13px]"
            >
              {account.supply_chain.map((h) => (
                <MentionChip key={h} href={profileHref(h)}>
                  {h}
                </MentionChip>
              ))}
            </RailCard>
          )}
        </aside>
      </div>
    </div>
  );
}

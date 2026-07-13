import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { getResearchPage } from '@/lib/content';
import type { ResearchSection, Tier } from '@/lib/types';
import { TierChip } from '@/components/ui/TierChip';
import { ReceiptLink } from '@/components/ui/ReceiptLink';

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getResearchPage(slug);
  if (!page) return {};
  const free = page.sections.find((s) => !s.locked) ?? page.sections[0];
  const body = free?.body?.replace(/\s+/g, ' ').trim() ?? '';
  const description = body.length > 155 ? `${body.slice(0, 152).trimEnd()}...` : body;
  return { title: page.title, description };
}

export default async function ResearchPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = await getResearchPage(slug);
  if (!page) notFound();

  const sections = page.sections;
  const tierLegend = [...new Set(sections.map((s) => s.tier).filter(Boolean))] as Tier[];
  const eyebrow = ['Research page', page.account, page.kind, page.domain].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto flex max-w-[848px] flex-col px-4 py-4 md:flex-row md:items-start md:gap-[28px] md:py-7">
      {/* TOC (desktop) - every section is a free read now */}
      <aside className="hidden self-start md:sticky md:top-[69px] md:block md:w-[220px] md:flex-none">
        <div className="mb-[12px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
          On this page
        </div>
        <nav className="flex flex-col gap-[2px]">
          {sections.map((s) => (
            <a
              key={s.slug}
              href={`#${s.slug}`}
              className="flex items-center gap-[8px] rounded-md px-[10px] py-[7px] hover:bg-wash"
            >
              <span className="h-[8px] w-[8px] flex-none rounded-full bg-[#00BA7C]" />
              <span className="text-[13px] font-semibold">{s.title}</span>
            </a>
          ))}
        </nav>

        <div className="mt-[18px] rounded-xl border border-line p-[11px]">
          <div className="mb-[8px] font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted">
            Tiers on this page
          </div>
          <div className="flex flex-col items-start gap-[6px]">
            {tierLegend.map((tier) => (
              <TierChip key={tier} tier={tier} size="mini" />
            ))}
          </div>
        </div>
      </aside>

      {/* reading column */}
      <article className="w-full md:w-[600px] md:flex-none">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{eyebrow}</div>
        <h1 className="mt-[9px] text-[26px] font-bold leading-[1.05] tracking-[-0.01em] md:text-[34px] md:tracking-[-0.02em]">
          {page.title}
        </h1>
        <div className="mt-[12px] flex items-center gap-[8px] font-mono text-[12px] text-muted">
          <span className="inline-block h-[9px] w-[9px] flex-none rounded-full bg-[#00BA7C]" />
          {page.freshness} · {page.section_count} sections · every claim sourced
        </div>

        <div className="mt-[20px] flex flex-col">
          {sections.map((s, i) => (
            <FullSection key={s.slug} section={s} number={i + 1} first={i === 0} />
          ))}
        </div>
      </article>
    </div>
  );
}

/** A fully-readable section. */
function FullSection({
  section,
  number,
  first,
}: {
  section: ResearchSection;
  number: number;
  first?: boolean;
}) {
  return (
    <section id={section.slug} className={cn('border-t border-line pt-[20px]', !first && 'mt-[24px]')}>
      <div className="flex flex-wrap items-center gap-[12px]">
        <span className="font-mono text-[13px] text-muted">§{number}</span>
        <h2 className="text-[22px] font-bold">{section.title}</h2>
        {section.tier && <TierChip tier={section.tier} qualifier={section.qualifier} size="post" />}
      </div>
      {section.body ? (
        <p className="post-body mt-[14px] whitespace-pre-line text-[15px] leading-[1.65] md:text-[17px] md:leading-[1.7]">
          {section.body}
        </p>
      ) : section.descriptor ? (
        <p className="mt-[14px] text-[15px] leading-[1.6] text-muted">{section.descriptor}</p>
      ) : null}
      {section.receipt && (
        <div className="mt-[16px]">
          <ReceiptLink size="md">receipt: {section.receipt}</ReceiptLink>
        </div>
      )}
    </section>
  );
}

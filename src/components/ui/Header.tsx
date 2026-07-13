import Link from 'next/link';

/**
 * The whole chrome, now: a slim sticky bar with just the wordmark. No search, no
 * auth, no nav - the feed is the app.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-[53px] max-w-[600px] items-center gap-2 px-4">
        <Link href="/" className="text-[19px] font-extrabold tracking-tight text-ink">
          Ticker
        </Link>
        <span className="text-[12px] text-muted">the anti-fintwit</span>
      </div>
    </header>
  );
}

import { getPosts, attachReceipts } from '@/lib/content';
import { PostCard } from '@/components/feed/PostCard';
import { Terminator } from '@/components/feed/Terminator';

/**
 * The landing page IS the feed. Reverse-chron, single centered column, X-style.
 * Every post is real, sourced, and confidence-labeled; the feed ends on purpose.
 */
export const revalidate = 300;

export default async function Home() {
  // Real engine-published posts only. The original demo/seed posts carry a
  // hardcoded "time" label ("1h"/"2h") and no real publish timestamp, so they'd
  // otherwise sit at the bottom with misleading stamps. `postedAt` (the ISO the
  // engine stamps at publish) is present only on real posts, so it's the filter.
  const posts = (await getPosts()).filter((p) => p.postedAt);
  const items = await attachReceipts(posts);

  return (
    <div className="mx-auto min-h-screen max-w-[600px] border-line sm:border-x">
      {items.length === 0 ? (
        <div className="px-4 py-16 text-center text-[15px] text-muted">Nothing has posted yet.</div>
      ) : (
        items.map(({ post, receiptHref }) => (
          <PostCard
            key={post.id ?? post.handle + post.time}
            post={post}
            receiptHref={receiptHref}
            interactive
          />
        ))
      )}
      <Terminator />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPosts } from '@/lib/content';
import { permalinkHref, profileHref, siteUrl } from '@/lib/links';
import { PostCard } from '@/components/feed/PostCard';
import { SectionDivider } from '@/components/ui/SectionDivider';
import { JsonLd } from '@/components/seo/JsonLd';
import { ReceiptPanel } from './ReceiptPanel';

async function getPost(postId: string) {
  return (await getPosts()).find((p) => p.id === postId);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ postId: string }>;
}): Promise<Metadata> {
  const { postId } = await params;
  const post = await getPost(postId);
  if (!post) return {};
  const title = `${post.handle} on Ticker`;
  const description = post.body.length > 157 ? `${post.body.slice(0, 157)}...` : post.body;
  return { title, description, openGraph: { title, description } };
}

export const revalidate = 300;

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.filter((p) => p.id).map((p) => ({ postId: p.id! }));
}

export default async function PostPermalinkPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const post = await getPost(postId);
  if (!post) notFound();

  const replies = (await getPosts()).filter((p) => p.replyTo === post.handle);

  // schema.org: each permalink is a citable social post by a named research desk.
  const postLd = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    url: `${siteUrl()}${permalinkHref(post)}`,
    headline: `${post.handle} on Ticker`,
    articleBody: post.body,
    ...(post.postedAt ? { datePublished: post.postedAt } : {}),
    author: {
      '@type': 'Organization',
      name: post.handle,
      url: `${siteUrl()}${profileHref(post.handle)}`,
    },
    publisher: { '@type': 'Organization', name: 'Ticker', url: siteUrl() },
  };

  return (
    <div className="mx-auto max-w-[600px] border-line sm:border-x">
      <JsonLd data={postLd} />
      <div className="border-b border-line px-4 py-3">
        <Link href="/" className="text-[14px] text-muted hover:text-ink hover:underline">
          ← Back to feed
        </Link>
      </div>

      <PostCard post={post} />
      <ReceiptPanel post={post} />

      {replies.length > 0 && (
        <>
          <SectionDivider className="px-4 pt-5 pb-3">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </SectionDivider>
          {replies.map((reply) => (
            <PostCard key={reply.id ?? reply.handle + reply.time} post={reply} interactive />
          ))}
        </>
      )}
    </div>
  );
}

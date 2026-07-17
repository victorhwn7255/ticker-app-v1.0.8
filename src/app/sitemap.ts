import type { MetadataRoute } from 'next';
import { getAccounts, getPosts, getResearchPages } from '@/lib/content';
import { permalinkHref, profileHref, researchHref, siteUrl } from '@/lib/links';

/**
 * Dynamic sitemap - the crawler's map to everything the infinite-scroll feed
 * hides. The landing page only renders the newest ~30 posts, so without this
 * file search engines would never discover the long tail: every post permalink,
 * every account profile, every research page. Regenerated hourly (revalidate),
 * so freshly published posts surface without a deploy.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [accounts, posts, research] = await Promise.all([
    getAccounts(),
    getPosts(),
    getResearchPages(),
  ]);

  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/explore`, changeFrequency: 'daily', priority: 0.5 },
    { url: `${base}/kill-list`, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${base}/tripwires`, changeFrequency: 'weekly', priority: 0.4 },
  ];

  const profiles: MetadataRoute.Sitemap = accounts.map((a) => ({
    url: `${base}${profileHref(a.handle)}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const permalinks: MetadataRoute.Sitemap = posts
    .filter((p) => p.id)
    .map((p) => ({
      url: `${base}${permalinkHref(p)}`,
      ...(p.postedAt ? { lastModified: new Date(p.postedAt) } : {}),
      priority: 0.6,
    }));

  const researchPages: MetadataRoute.Sitemap = research.map((r) => ({
    url: `${base}${researchHref(r.slug)}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...statics, ...profiles, ...researchPages, ...permalinks];
}

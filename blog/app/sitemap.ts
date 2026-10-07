import { MetadataRoute } from 'next';
import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { PAGE_SIZE, SITE_URL, absolute, archiveHref, topicHref } from '@/lib/site';

export const dynamic = 'force-static';
export const revalidate = 3600;

const asDate = (iso: string | undefined) => {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  return isNaN(d.getTime()) ? undefined : d;
};

// Every indexable URL, with the date of the newest thing on that page. Search results, the API and
// query-string views are deliberately absent. Google ignores priority and changefreq, so they are
// not set rather than set to the same value everywhere.
export default function sitemap(): MetadataRoute.Sitemap {
  const articles = getAllArticles();
  const topics = getAllCategories();
  const newest = asDate(articles[0]?.date);

  const entries: MetadataRoute.Sitemap = [{ url: SITE_URL, lastModified: newest }, { url: absolute('/categories'), lastModified: newest }];

  const archivePages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  for (let p = 2; p <= archivePages; p++) {
    entries.push({ url: absolute(archiveHref(p)), lastModified: asDate(articles[(p - 1) * PAGE_SIZE]?.date) });
  }

  for (const topic of topics) {
    const inTopic = articles.filter((a) => a.categorySlug === topic.slug);
    const pages = Math.max(1, Math.ceil(inTopic.length / PAGE_SIZE));
    for (let p = 1; p <= pages; p++) {
      entries.push({ url: absolute(topicHref(topic.slug, p)), lastModified: asDate(inTopic[(p - 1) * PAGE_SIZE]?.date) });
    }
  }

  for (const article of articles) {
    entries.push({ url: article.canonicalUrl || absolute(`/articles/${article.slug}`), lastModified: asDate(article.date) });
  }
  return entries;
}

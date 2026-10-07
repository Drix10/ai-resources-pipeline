import Link from 'next/link';
import { getAllArticles, getAllCategories } from '@/lib/markdown';
import DigestRow from '@/components/DigestRow';
import Pagination from '@/components/Pagination';
import { jsonLd, safeDecode } from '@/lib/url';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const categories = getAllCategories();
  return categories.map((c) => ({
    category: c.slug,
  }));
}

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const allArticles = getAllArticles();
  const filtered = allArticles.filter(
    (a) =>
      a.categorySlug === params.category ||
      a.category.toLowerCase() === safeDecode(params.category).toLowerCase()
  );

  if (filtered.length === 0) {
    return {
      title: 'Category Not Found - Drix10 Blogs',
    };
  }

  const categoryName = filtered[0].category;
  const canonicalUrl = `https://blogs.drix10.com/categories/${params.category}`;

  return {
    title: `${categoryName} - Technical Research & Guides | Drix10 Blogs`,
    description: `Curated technical research, system designs, and architecture breakdowns on ${categoryName} by Drishtant Ghosh (Drix10).`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${categoryName} - Drix10 Blogs`,
      description: `Curated technical research and architecture breakdowns on ${categoryName}.`,
      url: canonicalUrl,
      type: 'website',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: `${categoryName} - Drix10 Blogs`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${categoryName} - Drix10 Blogs`,
      description: `Curated technical research and architecture breakdowns on ${categoryName}.`,
      images: ['/og-image.png'],
    },
  };
}

export default function CategoryPage({ params, searchParams }: { params: { category: string }; searchParams: { page?: string } }) {
  const allArticles = getAllArticles();
  const filtered = allArticles.filter((a) => a.categorySlug === params.category || a.category.toLowerCase() === safeDecode(params.category).toLowerCase());

  if (filtered.length === 0) notFound();

  const categoryName = filtered[0].category;
  const githubCategoryUrl = `https://github.com/Drix10/ai-resources/tree/main/${encodeURIComponent(categoryName)}`;
  const canonicalUrl = `https://blogs.drix10.com/categories/${params.category}`;
  const isFolder = categoryName.toLowerCase() !== 'personal' && categoryName.toLowerCase() !== 'linkedin insights';

  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rawPage = parseInt(searchParams.page || '1', 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, totalPages) : 1;
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hubSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${categoryName} Technical Research & Guides`,
    description: `Curated technical research, system designs, and architecture breakdowns on ${categoryName} by Drishtant Ghosh (Drix10).`,
    url: canonicalUrl,
    publisher: {
      '@type': 'Organization',
      name: 'Drix10 Blogs',
      url: 'https://blogs.drix10.com',
    },
    hasPart: filtered.slice(0, 30).map((a) => ({
      '@type': 'TechArticle',
      headline: a.title,
      url: a.canonicalUrl,
      datePublished: a.date,
    })),
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://blogs.drix10.com' },
      { '@type': 'ListItem', position: 2, name: 'Categories', item: 'https://blogs.drix10.com/categories' },
      { '@type': 'ListItem', position: 3, name: categoryName, item: canonicalUrl },
    ],
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(hubSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />

      <nav aria-label="Breadcrumb" className="text-[0.9375rem] text-faint">
        <Link href="/categories" className="hover:text-ink">
          Topics
        </Link>
      </nav>

      <header className="mt-6 max-w-[48rem]">
        <h1 className="display text-[clamp(2.2rem,6.4vw,4rem)] font-bold leading-[1.04] text-ink">{categoryName}</h1>
        <p className="mt-4 text-[0.9375rem] text-faint">
          {filtered.length} digest{filtered.length === 1 ? '' : 's'}, newest first
          {isFolder && (
            <>
              {', '}
              <a href={githubCategoryUrl} target="_blank" rel="noopener noreferrer" className="link">
                browse the folder on GitHub
              </a>
            </>
          )}
        </p>
      </header>

      <div className="mt-8 max-w-[52rem] border-t border-rule">
        {pageItems.map((article) => (
          <DigestRow key={article.slug} article={article} showTopic={false} />
        ))}
        <Pagination page={page} totalPages={totalPages} href={(p) => (p > 1 ? `/categories/${params.category}?page=${p}` : `/categories/${params.category}`)} />
      </div>
    </div>
  );
}

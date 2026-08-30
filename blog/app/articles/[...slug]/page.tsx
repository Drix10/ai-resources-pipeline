import ArticleViewTracker from '@/components/ArticleViewTracker';
import { getArticleViews } from '@/lib/views-manager';
import { getAllArticles, getArticleBySlug } from '@/lib/markdown';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const articles = getAllArticles();
  return articles.slice(0, 60).map((article) => ({
    slug: article.slug.split('/'),
  }));
}

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const article = getArticleBySlug(params.slug);
  if (!article) return { title: 'Article Not Found' };

  return {
    title: article.title,
    description: article.description,
    alternates: {
      canonical: article.canonicalUrl,
    },
    openGraph: {
      title: article.title + ' | Drishtant Ghosh (Drix10)',
      description: article.description,
      url: article.canonicalUrl,
      type: 'article',
      publishedTime: article.date,
      authors: ['https://drix10.com', 'Drishtant Ghosh (Drix10)'],
      tags: [article.category, 'Drishtant Ghosh', 'Drix10', 'Cybersecurity', 'AI Engineering'],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.description,
      creator: '@drix10',
    },
  };
}

export default function ArticlePage({ params }: { params: { slug: string[] } }) {
  const article = getArticleBySlug(params.slug);
  if (!article) notFound();

  const techArticleSchema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: article.title,
    description: article.description,
    url: article.canonicalUrl,
    datePublished: article.date,
    dateModified: article.date,
    wordCount: article.wordCount,
    author: {
      '@type': 'Person',
      '@id': 'https://drix10.com/#person',
      name: 'Drishtant Ghosh',
      alternateName: ['Drix10', 'drix10'],
      url: 'https://drix10.com',
      image: 'https://blogs.drix10.com/avatar.png',
      sameAs: [
        'https://github.com/Drix10',
        'https://www.linkedin.com/in/drix10',
        'https://peerlist.io/drix10',
        'https://medium.com/@drix10',
        'https://dev.to/drix10',
        'https://x.com/Drix_10',
      ],
    },
    publisher: {
      '@type': 'Organization',
      name: 'Drix10 Blogs',
      url: 'https://blogs.drix10.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://blogs.drix10.com/avatar.png',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.canonicalUrl,
    },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://blogs.drix10.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: article.category,
        item: 'https://blogs.drix10.com/categories/' + article.categorySlug,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: article.canonicalUrl,
      },
    ],
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(techArticleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      {/* Mobile-Friendly Breadcrumbs */}
      <nav className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-zinc-500 overflow-x-auto pb-1 no-scrollbar">
        <Link href="/" className="hover:text-zinc-200 transition-colors flex-shrink-0">Home</Link>
        <span>/</span>
        <Link href={'/categories/' + article.categorySlug} className="hover:text-zinc-200 transition-colors flex-shrink-0">
          {article.category}
        </Link>
        <span>/</span>
        <span className="text-zinc-400 truncate max-w-[160px] sm:max-w-[240px] flex-shrink-0">{article.title}</span>
      </nav>

      {/* Article Header */}
      <header className="space-y-2.5 sm:space-y-3 border-b border-zinc-800 pb-4 sm:pb-6">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-zinc-400">
          <span className="px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">
            {article.category}
          </span>
          <span>•</span>
          <time dateTime={article.date}>{article.date}</time>
          <span>•</span>
          <span>{article.readingTimeMinutes} min read</span>
          <span>•</span>
          <span className="font-mono text-zinc-500">{article.wordCount} words</span>
        </div>

        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-zinc-100 tracking-tight leading-snug sm:leading-tight">
          {article.title}
        </h1>

        {(() => {
          const viewStats = getArticleViews(article.slug);
          return (
            <ArticleViewTracker
              slug={article.slug}
              initialViews={viewStats.views}
              initialAiViews={viewStats.aiViews}
            />
          );
        })()}
      </header>

      {/* Article Prose with Mobile Overflow Protection */}
      <article 
        className="prose prose-invert prose-zinc max-w-none text-sm sm:text-[15px] leading-relaxed sm:leading-loose prose-headings:font-semibold prose-headings:text-zinc-100 prose-h1:text-lg sm:prose-h1:text-xl prose-h2:text-base sm:prose-h2:text-lg prose-h3:text-sm sm:prose-h3:text-base prose-p:text-zinc-300 prose-strong:text-zinc-100 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-a:text-zinc-200 prose-a:underline hover:prose-a:text-white overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: article.htmlContent }}
      />

      {/* Internal Linking: Related Guides in same category for SEO/GEO crawl graph */}
      <section className="mt-8 pt-6 border-t border-zinc-800/80">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono mb-3">
          Related {article.category} Breakdowns
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {getAllArticles()
            .filter((a) => a.category === article.category && a.slug !== article.slug)
            .slice(0, 4)
            .map((related) => (
              <Link
                key={related.slug}
                href={`/articles/${related.slug}`}
                className="group p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all flex flex-col justify-between"
              >
                <div className="text-xs font-semibold text-zinc-200 group-hover:text-white line-clamp-2 mb-1.5">
                  {related.title}
                </div>
                <div className="text-[11px] text-zinc-500 font-mono flex items-center justify-between">
                  <span>{related.readingTimeMinutes}m read</span>
                  <span className="group-hover:translate-x-0.5 transition-transform text-zinc-400">Read ↗</span>
                </div>
              </Link>
            ))}
        </div>
      </section>

      {/* High-DR Backlinks & Mobile Author Card */}
      <div className="mt-8 sm:mt-12 pt-6 border-t border-zinc-800 space-y-4 sm:space-y-6">
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <a href="https://drix10.com" target="_blank" rel="noreferrer" className="shrink-0" title="Drishtant Ghosh (Drix10)">
              <Image
                src="/avatar.png"
                alt="Drishtant Ghosh (Drix10)"
                width={44}
                height={44}
                className="w-11 h-11 rounded-full object-cover border border-zinc-700 shadow-md hover:border-zinc-400 transition-colors"
              />
            </a>
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <span>Written by <strong className="text-white">Drishtant Ghosh (Drix10)</strong></span>
                <span>•</span>
                <Link href="/about" className="text-zinc-400 hover:text-zinc-200 underline text-[11px]">About</Link>
              </div>
              <p className="text-xs text-zinc-400">
                AI Engineer & Serial Founder | Canopy @ f.inc | 1x Acquired Founder | Researching autonomous agent pipelines, cybersecurity, and system architecture. Read more on <a href="https://drix10.com" target="_blank" rel="noreferrer" className="text-zinc-200 underline">drix10.com</a>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <a
              href="https://www.linkedin.com/in/drix10"
              target="_blank"
              rel="noreferrer"
              className="flex-1 sm:flex-initial px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-semibold text-xs hover:bg-zinc-200 transition-colors text-center min-h-[36px] flex items-center justify-center"
            >
              LinkedIn
            </a>
            <a
              href="https://peerlist.io/drix10"
              target="_blank"
              rel="noreferrer"
              className="flex-1 sm:flex-initial px-3 py-2 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs transition-colors text-center min-h-[36px] flex items-center justify-center"
            >
              Peerlist
            </a>
            <a
              href="https://github.com/Drix10/ai-resources"
              target="_blank"
              rel="noreferrer"
              className="flex-1 sm:flex-initial px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs transition-colors text-center min-h-[36px] flex items-center justify-center"
            >
              GitHub ⭐
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500 text-center sm:text-left">
          <Link href="/" className="hover:text-zinc-300 transition-colors py-1">
            ← Back to all breakdowns
          </Link>
          <a href={article.canonicalUrl} className="hover:text-zinc-300 font-mono truncate max-w-[280px]">
            {article.canonicalUrl}
          </a>
        </div>
      </div>
    </div>
  );
}

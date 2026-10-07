import Link from 'next/link';
import { cleanTitle, formatDate, type ArticleSummary } from '@/lib/markdown';

// One digest in a list: where it sits, what it opens with, and what else is inside.
export default function DigestRow({
  article,
  showTopic = true,
  showDate = true,
}: {
  article: ArticleSummary;
  showTopic?: boolean;
  showDate?: boolean;
}) {
  const count = article.itemCount ?? article.items?.length ?? 0;
  const rest = (article.items || []).slice(1, 4).map(cleanTitle);
  const more = Math.max(0, count - 1 - rest.length);

  return (
    <article className="group border-b border-rule/80">
      <Link href={`/articles/${article.slug}`} className="block py-6 sm:py-7">
        <p className="text-[0.9375rem] text-faint">
          {[
            showTopic ? article.category : '',
            showDate ? formatDate(article.date) : '',
            count > 1 ? `${count} items` : `${article.readingTimeMinutes} min read`,
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
        <h3 className="display mt-1.5 text-[1.5rem] font-semibold leading-snug text-ink transition-colors group-hover:text-accent sm:text-[1.75rem]">
          {cleanTitle(article.title)}
        </h3>
        {article.description && (
          <p className="mt-2 line-clamp-2 max-w-[62ch] font-serif text-[1.125rem] leading-[1.6] text-body">{article.description}</p>
        )}
        {rest.length > 0 && (
          <p className="mt-3 line-clamp-2 max-w-[62ch] text-[0.9375rem] text-faint">
            Also covers {rest.join(', ')}
            {more > 0 ? ` and ${more} more` : ''}.
          </p>
        )}
      </Link>
    </article>
  );
}

import { Fragment } from 'react';
import { formatDate, type ArticleSummary } from '@/lib/markdown';
import DigestRow from './DigestRow';

// A list of digests. Newest-first lists are grouped under date headings; other orders are not.
export default function DigestList({
  articles,
  groupByDate = true,
  showTopic = true,
}: {
  articles: ArticleSummary[];
  groupByDate?: boolean;
  showTopic?: boolean;
}) {
  let lastDate = '';
  return (
    <div className="mt-2">
      {articles.map((a) => {
        const showDate = groupByDate && a.date !== lastDate;
        if (groupByDate) lastDate = a.date;
        return (
          <Fragment key={a.slug}>
            {showDate && <h3 className="mt-8 border-b border-rule pb-2 text-[0.9375rem] font-semibold text-ink first:mt-0">{formatDate(a.date)}</h3>}
            <DigestRow article={a} showTopic={showTopic} showDate={!groupByDate} />
          </Fragment>
        );
      })}
    </div>
  );
}

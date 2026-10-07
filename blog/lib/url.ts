export interface SearchQuery {
  q?: string;
  topic?: string;
  sort?: string;
  page?: number;
}

// Builds "/search?q=...&topic=...": the search page is fully driven by its URL, so every
// search and filter state can be shared and bookmarked.
export function searchUrl({ q, topic, sort, page }: SearchQuery): string {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set('q', q.trim());
  if (topic) params.set('topic', topic);
  if (sort && sort !== 'newest') params.set('sort', sort);
  if (page && page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

// JSON-LD lives inside <script>, so "<" must never appear raw (a title containing "</script>").
export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

// decodeURIComponent throws on a stray "%"; a bad URL should be a 404, not a 500.
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

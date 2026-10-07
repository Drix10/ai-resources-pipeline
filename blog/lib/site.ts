// One place for the site's own address and its owner's, so canonicals, sitemaps and
// structured data can never disagree with each other.
export const SITE_URL = (process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com').replace(/\/$/, '');
export const PORTFOLIO_URL = (process.env.NEXT_PUBLIC_PORTFOLIO_URL || 'https://drix10.com').replace(/\/$/, '');
export const PERSON_ID = `${PORTFOLIO_URL}/#person`;
export const SITE_NAME = 'Drix10 Blog';
export const PAGE_SIZE = 20;

export const absolute = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

// Where page N of a list lives: page 1 is the list's own address.
export const archiveHref = (page: number) => (page <= 1 ? '/' : `/archive/${page}`);
export const topicHref = (slug: string, page = 1) => (page <= 1 ? `/categories/${slug}` : `/categories/${slug}/page/${page}`);

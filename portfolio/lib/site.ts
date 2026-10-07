// The address the portfolio declares as its own (canonicals, sitemap, structured data).
// Set NEXT_PUBLIC_SITE_URL to match whichever of drix10.com / www.drix10.com the host redirects to.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://drix10.com').replace(/\/$/, '');
export const BLOG_URL = (process.env.NEXT_PUBLIC_BLOG_URL || 'https://blogs.drix10.com').replace(/\/$/, '');
export const PERSON_ID = `${SITE_URL}/#person`;
export const TITLE = 'Drishtant Ghosh (Drix10): AI Systems Engineer and Founder';
export const DESCRIPTION =
  'Drishtant Ghosh (Drix10): AI systems engineer and serial founder in Bengaluru. Ran ReeF to acquisition, built CosLynx, now building agent infrastructure.';

// Safe to embed in a <script> tag.
export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\u003c');

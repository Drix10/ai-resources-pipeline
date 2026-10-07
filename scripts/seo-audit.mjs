#!/usr/bin/env node
// Audits a deployed (or locally running) site for the things search engines care about.
//
//   node scripts/seo-audit.mjs https://blogs.drix10.com
//   node scripts/seo-audit.mjs https://drix10.com --pages 10
//   node scripts/seo-audit.mjs http://localhost:3010 --host https://blogs.drix10.com
//
// --host  the public address the site declares in canonicals (use it when auditing localhost).
// --pages how many sitemap URLs to sample (default 40, spread evenly).
// Exits 1 when any ERROR is found; WARN items are advice.

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (!base) {
  console.error('Usage: node scripts/seo-audit.mjs <base url> [--host <public url>] [--pages N]');
  process.exit(2);
}
const publicHost = opt('host', base).replace(/\/$/, '');
const sample = Number(opt('pages', 40));

const issues = [];
const note = (level, url, msg) => issues.push({ level, url, msg });
const get = async (url, init) => {
  try {
    return await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; seo-audit)' }, ...init });
  } catch (e) {
    return { ok: false, status: 0, headers: new Headers(), text: async () => '', error: e.message };
  }
};
// Map a public URL (from the sitemap or a canonical) onto the address actually being audited.
const local = (u) => (publicHost === base ? u : u.replace(publicHost, base));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i')) || [])[2] ?? (tag.match(new RegExp(`\\b${name}='([^']*)'`, 'i')) || [])[1];

const metaContent = (html, key, by = 'name') => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(m[0], by)?.toLowerCase() === key) return attr(m[0], 'content');
  }
  return undefined;
};

async function auditPage(url, { indexable = true } = {}) {
  const res = await get(local(url));
  if (res.status !== 200) return note('ERROR', url, `status ${res.status}${res.headers.get('location') ? ` -> ${res.headers.get('location')}` : ''}`);
  const html = await res.text();
  const cache = res.headers.get('cache-control') || '';

  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  if (!title) note('ERROR', url, 'missing <title>');
  else if (title.length < 15 || title.length > 70) note('WARN', url, `title length ${title.length}: "${title.slice(0, 60)}"`);

  const description = decode(metaContent(html, 'description') || '').trim();
  if (!description) note('ERROR', url, 'missing meta description');
  else if (description.length < 50 || description.length > 175) note('WARN', url, `description length ${description.length}`);

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].length;
  if (h1s !== 1) note('ERROR', url, `${h1s} <h1> elements (want exactly 1)`);

  if (!/<html[^>]+\blang=/i.test(html)) note('ERROR', url, 'missing <html lang>');
  if (!/<meta[^>]+name="viewport"/i.test(html)) note('ERROR', url, 'missing viewport meta');

  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'rel')?.toLowerCase() === 'canonical');
  const canonicalHref = canonical && attr(canonical, 'href');
  const robots = (metaContent(html, 'robots') || '').toLowerCase();
  if (indexable) {
    if (!canonicalHref) note('ERROR', url, 'missing canonical');
    else {
      if (!/^https?:\/\//.test(canonicalHref)) note('ERROR', url, `canonical is not absolute: ${canonicalHref}`);
      if (canonicalHref.replace(/\/$/, '') !== url.replace(/\/$/, '')) note('ERROR', url, `canonical points elsewhere: ${canonicalHref}`);
      if (!canonicalHref.startsWith(publicHost)) note('ERROR', url, `canonical is on a different host than the site (${canonicalHref})`);
    }
    if (robots.includes('noindex')) note('ERROR', url, 'indexable page carries noindex');
    if (/private|no-store/i.test(cache)) note('WARN', url, `not edge-cacheable (Cache-Control: ${cache})`);
  } else if (!robots.includes('noindex')) {
    note('ERROR', url, 'expected noindex on this page');
  }

  const ogTitle = metaContent(html, 'og:title', 'property');
  const ogImage = metaContent(html, 'og:image', 'property');
  if (!ogTitle) note('WARN', url, 'missing og:title');
  if (!ogImage) note('WARN', url, 'missing og:image');
  else if (!/^https?:\/\//.test(ogImage)) note('ERROR', url, `og:image is not absolute: ${ogImage}`);
  if (!metaContent(html, 'twitter:card')) note('WARN', url, 'missing twitter:card');

  const blocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const types = [];
  for (const b of blocks) {
    try {
      const j = JSON.parse(b);
      for (const node of j['@graph'] || [j]) types.push(node['@type']);
    } catch (e) {
      note('ERROR', url, `invalid JSON-LD: ${e.message}`);
    }
  }
  if (indexable && blocks.length === 0) note('WARN', url, 'no structured data');

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => attr(t, 'alt') === undefined).length;
  if (noAlt) note('WARN', url, `${noAlt} image(s) without alt`);

  const links = [...new Set([...html.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]*)"/gi)].map((m) => m[1]))];
  return { url, title, description, types, links };
}

const pages = [];
const base0 = await get(`${base}/robots.txt`);
const robotsTxt = base0.status === 200 ? await base0.text() : '';
if (!robotsTxt) note('ERROR', `${base}/robots.txt`, 'missing');
else if (!/sitemap:/i.test(robotsTxt)) note('ERROR', `${base}/robots.txt`, 'does not point at a sitemap');
else if (!robotsTxt.toLowerCase().includes(publicHost.toLowerCase().replace(/^https?:\/\//, ''))) note('WARN', `${base}/robots.txt`, `sitemap line does not mention ${publicHost}`);

const smRes = await get(`${base}/sitemap.xml`);
const sitemap = smRes.status === 200 ? await smRes.text() : '';
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
if (urls.length === 0) note('ERROR', `${base}/sitemap.xml`, 'missing or empty');
const wrongHost = urls.filter((u) => !u.startsWith(publicHost));
if (wrongHost.length) note('ERROR', `${base}/sitemap.xml`, `${wrongHost.length} URL(s) on another host, e.g. ${wrongHost[0]}`);
const dupes = urls.length - new Set(urls).size;
if (dupes) note('ERROR', `${base}/sitemap.xml`, `${dupes} duplicate URL(s)`);
if (urls.length > 50000) note('ERROR', `${base}/sitemap.xml`, 'over 50,000 URLs');
if (/<priority>/.test(sitemap) && !/<priority>0?\.\d+<\/priority>/.test(sitemap)) note('WARN', `${base}/sitemap.xml`, 'odd priority values');
const priorities = new Set([...sitemap.matchAll(/<priority>([^<]+)<\/priority>/g)].map((m) => m[1]));
if (urls.length > 20 && priorities.size === 1) note('WARN', `${base}/sitemap.xml`, `every URL has the same priority (${[...priorities][0]}); search engines ignore it`);

const step = Math.max(1, Math.floor(urls.length / sample));
const picked = [...new Set([urls[0], ...urls.filter((_, i) => i % step === 0)])].filter(Boolean).slice(0, sample + 1);
for (const u of picked) {
  const r = await auditPage(u);
  if (r) pages.push(r);
}

// Pages that must exist and must not be indexed.
const searchUrl = `${publicHost}/search?q=test`;
const probe = await get(local(searchUrl));
if (probe.status === 200) await auditPage(searchUrl, { indexable: false });

// Cross-page checks
const byTitle = new Map();
const byDesc = new Map();
for (const p of pages) {
  byTitle.set(p.title, [...(byTitle.get(p.title) || []), p.url]);
  byDesc.set(p.description, [...(byDesc.get(p.description) || []), p.url]);
}
for (const [t, us] of byTitle) if (t && us.length > 1) note('WARN', us[0], `duplicate title shared by ${us.length} sampled pages: "${t.slice(0, 50)}"`);
for (const [d, us] of byDesc) if (d && us.length > 1) note('WARN', us[0], `duplicate description shared by ${us.length} sampled pages`);

// Broken internal links from the sampled pages (cap the requests)
const seen = new Set();
let checked = 0;
for (const p of pages) {
  for (const href of p.links) {
    if (seen.has(href) || checked >= 120 || /\.(png|jpg|svg|ico|xml|txt)$/i.test(href)) continue;
    seen.add(href);
    checked++;
    const r = await get(`${base}${href}`);
    if (r.status >= 400 || r.status === 0) note('ERROR', `${base}${href}`, `broken internal link (status ${r.status}), found on ${p.url}`);
  }
}

const errors = issues.filter((i) => i.level === 'ERROR');
const warns = issues.filter((i) => i.level === 'WARN');
console.log(`Audited ${base}: ${urls.length} sitemap URLs, ${pages.length} pages sampled, ${checked} internal links checked.`);
const types = [...new Set(pages.flatMap((p) => p.types))].filter(Boolean).sort();
console.log(`Structured data types seen: ${types.join(', ') || 'none'}`);
for (const i of [...errors, ...warns].slice(0, 80)) console.log(`${i.level.padEnd(5)} ${i.url}\n      ${i.msg}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length ? 1 : 0);

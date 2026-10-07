// Pure markdown -> HTML logic for digests (no fs, no JSON, no framework imports) so it can be
// unit-tested directly. Everything rendered here comes from scraped or generated text, so it is
// treated as untrusted: see the renderer below.
import { marked, type Tokens } from 'marked';

export interface DigestSection {
  id: string;
  title: string;
  html: string;
}

export const escapeHtml = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// marked has already entity-escaped alt/title text; only make sure it cannot leave the attribute.
const attrSafe = (s: string | null | undefined) => String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Digests are synthesized from scraped posts, so nothing in them is trusted: raw HTML is shown as
// text, and links and images may only point at http(s), mailto, same-site paths or anchors.
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const safeHref = (href: string | null | undefined): string | null => {
  const h = String(href ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, '');
  return SAFE_URL.test(h) ? h : null;
};

const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.image = ({ href, title, text }) => {
  const src = safeHref(href);
  if (!src || src.startsWith('#') || src.startsWith('mailto:')) return attrSafe(text);
  return `<figure class="digest-figure"><img src="${escapeHtml(src)}" alt="${attrSafe(text)}"${title ? ` title="${attrSafe(title)}"` : ''} loading="lazy" /></figure>`;
};
renderer.link = function (this: InstanceType<typeof marked.Renderer>, { href, title, tokens }: Tokens.Link) {
  const inner = this.parser.parseInline(tokens);
  const target = safeHref(href);
  if (!target) return inner; // javascript:, data: and friends keep their text but lose the link
  const external = /^https?:\/\//i.test(target) && !target.startsWith('https://blogs.drix10.com');
  return `<a href="${escapeHtml(target)}"${external ? ' target="_blank" rel="noopener noreferrer" class="ext"' : ''}${title ? ` title="${attrSafe(title)}"` : ''}>${inner}</a>`;
};
renderer.table = ({ header, rows }) =>
  `<div class="digest-table"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
marked.setOptions({ gfm: true, breaks: false, renderer });

// "🚀 Tech - Zephon" -> "Tech - Zephon": the emoji was a marker for the old layout.
export function cleanTitle(title: string): string {
  return String(title || '')
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .replace(/\*\*/g, '')
    .trim();
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// A fence opens with 3+ backticks or tildes and closes on the same character, at least as long.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const labelOf = (line: string): 'Key points' | 'Sources' | 'Implementation' | null => {
  if (/^ {0,3}\*{0,2}Key Points:?\*{0,2}\s*$/i.test(line)) return 'Key points';
  if (/^ {0,3}\*{0,2}(?:\u{1F517}\s*)?(?:Resources|Sources):?\*{0,2}\s*$/iu.test(line)) return 'Sources';
  if (/^ {0,3}\*{0,2}(?:\u{1F680}\s*)?Implementation:?\*{0,2}\s*$/iu.test(line)) return 'Implementation';
  return null;
};

// Older digests were written with inconsistent markdown: labels glued to the previous sentence,
// bullets squashed onto one line, and source lists padded with placeholders. Repair those shapes
// (outside code blocks only) and turn the section labels into real headings the stylesheet targets.
function prepareSectionBody(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let section: 'none' | 'points' | 'sources' = 'none';

  for (const raw of body.split('\n')) {
    const open = raw.match(FENCE);
    if (fence) {
      out.push(raw);
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && raw.trim() === open[1]) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      out.push(raw);
      continue;
    }

    // "...sentence.Key Points: - **A**: x" -> the label gets its own line.
    const pieces = raw
      .replace(/([.!?])[ \t]*(Key Points:|\u{1F517}\s*Resources:)(?=\s*(?:[-\u2022*]|$))/giu, '$1\n\n$2')
      .replace(/(Key Points:|\u{1F517}\s*Resources:)[ \t]+(?=[-\u2022*])/giu, '$1\n\n')
      .split('\n');

    for (let line of pieces) {
      const label = labelOf(line);
      if (label) {
        section = label === 'Key points' ? 'points' : label === 'Sources' ? 'sources' : 'none';
        out.push('', `### ${label}`, '');
        continue;
      }
      if (section === 'points' && /\s-\s+\*\*[^*]+\*\*/.test(line)) {
        // "- **A**: x. - **B**: y" on one line becomes one bullet per line.
        line = line.replace(/\s+-\s+(?=\*\*[^*]+\*\*)/g, '\n- ');
      } else if (section === 'sources') {
        if (/^\s*[-*\u2022]\s*$/.test(line)) continue;
        const item = line.match(/^\s*[-*\u2022]\s+(.*)$/);
        if (item) {
          // "- [Link](url) - Original post - Brief description: x" is several entries on one line.
          const kept = item[1]
            .split(/\s+[-•]\s+(?=\[|Original post\b|Brief description:)/i)
            .map((e) => e.trim())
            // Keep entries that point somewhere; drop bare names, "()" stubs and placeholder text.
            .filter((e) => (/\]\(https?:/i.test(e) || /^!\[/.test(e) || /https?:\/\//i.test(e)) && !/^brief description/i.test(e))
            .map((e) => `- ${e}`);
          if (kept.length === 0) continue;
          line = kept.join('\n');
        }
      }
      out.push(line);
    }
  }
  return out.join('\n');
}

export function buildSections(markdown: string): DigestSection[] {
  // Only "### " lines outside fenced code start an item, so a "###" inside a snippet never splits one.
  const raw: { title: string; lines: string[] }[] = [];
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const open = line.match(FENCE);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
    } else if (open) {
      fence = open[1];
    }
    const heading = !fence && !open && line.match(/^###\s+(.+)$/);
    if (heading) raw.push({ title: heading[1], lines: [] });
    else if (raw.length) raw[raw.length - 1].lines.push(line);
  }
  if (raw.length < 1) return [];

  const used = new Set<string>();
  const sections: DigestSection[] = [];
  raw.forEach((item, i) => {
    const title = cleanTitle(item.title);
    const body = item.lines.join('\n').replace(/\n\s*---\s*$/g, '').trim();
    if (!title || !body) return;
    let id = `item-${i + 1}-${slugify(title)}`.replace(/-$/, '');
    while (used.has(id)) id += '-x';
    used.add(id);
    sections.push({
      id,
      title,
      html: (marked.parse(prepareSectionBody(body)) as string)
        .replace(/<h3>(Key points|Implementation)<\/h3>/g, '<h3 class="label">$1</h3>')
        .replace('<h3>Sources</h3>', '<h3 class="label sources">Sources</h3>'),
    });
  });
  return sections;
}


export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown) as string;
}

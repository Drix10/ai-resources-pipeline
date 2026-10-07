import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSections, cleanTitle, renderMarkdown } from '../lib/render.ts';

const html = (md) => renderMarkdown(md);
const sec = (md) => buildSections(md);

// ---- safety: nothing from a scraped or generated digest may execute ----
const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(2)>',
  '<a href="javascript:alert(3)">raw</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<svg onload=alert(4)>',
  '[click](javascript:alert(5))',
  '[y](JaVaScRiPt:alert(6))',
  '[tab](java\tscript:alert(7))',
  '[ctrl](&#106;avascript:alert(8))',
  '[data](data:text/html;base64,PHNjcmlwdD5hbGVydCg5KTwvc2NyaXB0Pg==)',
  '[vb](vbscript:msgbox(10))',
  '![img](javascript:alert(11))',
  '![img](data:image/svg+xml;base64,AAAA)',
  '[<img src=x onerror=alert(12)>](https://a.example)',
  '[x](https://a.example "t\\" onmouseover=\\"alert(13)")',
  '![a" onerror="alert(14)](https://a.example/i.png)',
  '- <details open ontoggle=alert(15)>',
];

// Every attribute of every tag in the output, so "onerror" inside a quoted value is not mistaken for one.
const tags = (out) => [...out.matchAll(/<([a-z][a-z0-9]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/gi)].map((m) => ({
  name: m[1].toLowerCase(),
  attrs: [...m[2].matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map((a) => [a[1].toLowerCase(), a[2] ?? '']),
}));
const ALLOWED_TAGS = new Set(['p', 'a', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'br', 'del', 'figure', 'img', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'span']);

test('hostile markdown never produces executable HTML', () => {
  for (const md of HOSTILE) {
    const out = html(md);
    for (const t of tags(out)) {
      assert.ok(ALLOWED_TAGS.has(t.name), `${md} -> unexpected <${t.name}>`);
      for (const [name, value] of t.attrs) {
        assert.ok(!name.startsWith('on'), `${md} -> event handler ${name}`);
        if (name === 'href' || name === 'src') assert.match(value, /^(https?:\/\/|mailto:|\/(?!\/)|#)/i, `${md} -> ${name}=${value}`);
      }
    }
    assert.doesNotMatch(out, /<script|<iframe|<svg/i, md);
  }
});

test('raw HTML is shown as text, not parsed', () => {
  const out = html('Before <b onclick="x()">bold</b> after');
  assert.match(out, /&lt;b onclick=/);
  assert.doesNotMatch(out, /<b /);
});

test('unsafe links keep their text but lose the link', () => {
  assert.equal(html('[hello](javascript:alert(1))').trim(), '<p>hello</p>');
  assert.equal(html('![alt text](javascript:alert(1))').trim(), '<p>alt text</p>');
});

test('safe links survive: external opens safely, internal and anchors stay plain', () => {
  const out = html('[ext](https://example.com/a?x=1&y=2) [own](https://blogs.drix10.com/articles/x) [rel](/categories) [top](#top) [mail](mailto:a@b.co)');
  assert.match(out, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer" class="ext">ext<\/a>/);
  assert.match(out, /<a href="https:\/\/blogs\.drix10\.com\/articles\/x">own<\/a>/);
  assert.match(out, /<a href="\/categories">rel<\/a>/);
  assert.match(out, /<a href="#top">top<\/a>/);
  assert.match(out, /<a href="mailto:a@b\.co">mail<\/a>/);
  assert.doesNotMatch(out, /href="\/\/evil/);
  assert.equal(html('[proto-relative](//evil.example/x)').trim(), '<p>proto-relative</p>');
});

test('link text keeps its inline formatting and is not escaped twice', () => {
  const out = html('[**bold** & `code`](https://example.com "A & B")');
  assert.match(out, /<strong>bold<\/strong> &amp; <code>code<\/code>/);
  assert.match(out, /title="A &amp; B"/);
  assert.doesNotMatch(out, /&amp;amp;/);
});

test('images render as figures with safe attributes', () => {
  const out = html('![diagram "one"](https://example.com/i.png)');
  assert.match(out, /<figure class="digest-figure"><img src="https:\/\/example\.com\/i\.png" alt="diagram &quot;one&quot;"/);
  assert.doesNotMatch(out, /&amp;quot;/);
});

// ---- structure ----
test('items split on ### only outside code fences (backtick and tilde)', () => {
  const md = ['### One', 'text', '```', '### not an item', '```', '', '### Two', '~~~', '### also not', '~~~', 'tail'].join('\n');
  const s = sec(md);
  assert.deepEqual(s.map((x) => x.title), ['One', 'Two']);
  assert.match(s[0].html, /### not an item/);
  assert.match(s[1].html, /### also not/);
});

test('a longer outer fence is not closed by a shorter inner one', () => {
  const md = ['### A', '````', '```', '### inner', '```', '````', 'after', '### B', 'b body'].join('\n');
  assert.deepEqual(sec(md).map((x) => x.title), ['A', 'B']);
});

test('a single-item digest still yields one section; no headings yields none', () => {
  assert.equal(sec('### Only one\n\nSome body text here.').length, 1);
  assert.equal(sec('Just prose with no headings at all.').length, 0);
  assert.equal(sec('').length, 0);
});

test('duplicate titles get unique ids; empty items are dropped', () => {
  const s = sec('### Same\nfirst body\n### Same\nsecond body\n### Empty\n\n### Last\nlast body');
  assert.equal(s.length, 3);
  assert.equal(new Set(s.map((x) => x.id)).size, 3);
  assert.deepEqual(s.map((x) => x.title), ['Same', 'Same', 'Last']);
});

test('labels become headings; Sources get their own class', () => {
  const s = sec('### Item\nIntro sentence.\n\nKey Points:\n\n- **A**: one\n\n🔗 Resources:\n\n- [Original post](https://x.com/a/status/1)\n');
  assert.match(s[0].html, /<h3 class="label">Key points<\/h3>/);
  assert.match(s[0].html, /<h3 class="label sources">Sources<\/h3>/);
});

test('legacy shapes are repaired: glued labels, squashed bullets, placeholder sources', () => {
  const md = [
    '### Legacy',
    'A sentence about it.Key Points: - **First**: one thing. - **Second**: another.',
    '🔗 Resources: - [Original post](https://x.com/a/status/1) - Original post - Brief description: x',
  ].join('\n');
  const out = sec(md)[0].html;
  assert.match(out, /<h3 class="label">Key points<\/h3>/);
  assert.equal((out.match(/<li><strong>/g) || []).length, 2, 'bullets split');
  assert.match(out, /<h3 class="label sources">Sources<\/h3>/);
  assert.doesNotMatch(out, /Brief description/);
  assert.equal((out.match(/<li>/g) || []).length, 3, '2 bullets + 1 real source');
});

test('prose that merely contains the words is left alone', () => {
  const out = sec('### Item\nThis note covers Key Points: of the approach and Resources: see below for more.')[0].html;
  assert.doesNotMatch(out, /class="label/);
  assert.match(out, /Key Points: of the approach/);
});

test('code blocks are never rewritten', () => {
  const md = ['### Item', 'intro', '```', 'Key Points:', '- **A**: x - **B**: y', 'Resources:', '- bare', '```', '', '    Resources:', '    - indented code'].join('\n');
  const out = sec(md)[0].html;
  assert.doesNotMatch(out, /class="label/);
  assert.match(out, /<pre><code>Key Points:\n- \*\*A\*\*: x - \*\*B\*\*: y\nResources:\n- bare/);
});

test('cleanTitle strips the leading emoji marker and bold', () => {
  assert.equal(cleanTitle('🚀 Tech - Zephon'), 'Tech - Zephon');
  assert.equal(cleanTitle('**Bold** title'), 'Bold title');
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle(null), '');
});

// ---- the real archive ----
const CONTENT = new URL('../content/', import.meta.url);
test('every real digest renders safely with unique anchors', { skip: !existsSync(CONTENT) }, () => {
  let files = 0;
  for (const dir of readdirSync(CONTENT, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === 'Personal') continue;
    for (const f of readdirSync(new URL(`./${dir.name}/`, CONTENT))) {
      if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
      const md = readFileSync(join(CONTENT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), dir.name, f), 'utf8');
      const sections = sec(md);
      files++;
      assert.equal(new Set(sections.map((x) => x.id)).size, sections.length, `${dir.name}/${f}: ids collide`);
      for (const s of sections) {
        assert.doesNotMatch(s.html, /<script|<iframe|\son\w+=|href="(javascript|data):/i, `${dir.name}/${f}`);
        assert.ok(s.title.length > 0 && s.html.trim().length > 0);
      }
    }
  }
  assert.ok(files > 0);
});

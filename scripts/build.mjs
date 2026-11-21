// Builds the site into _site/. Everything a visitor sees is decided here, so the
// browser never waits on anything:
//   - every page lives at a clean address (/writings/, /contact/, ...), and every
//     old address redirects to its new one
//   - every post is rendered and its code highlighted ahead of time
//   - every page gets a plain-text twin, for `curl pranavpipariya.com/index.txt`
//   - agents get llms.txt and llms-full.txt; readers get an RSS feed; search
//     engines get a sitemap and structured data about who runs the site
// Run with `npm run build`.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { marked } from 'marked';
import hljs from 'highlight.js';

// Code is highlighted here, at build time, so posts arrive already coloured and
// no highlighter is downloaded by the reader.
const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
marked.use({
    renderer: {
        code({ text, lang }) {
            const language = (lang || '').split(/\s/)[0];
            const html = language && hljs.getLanguage(language)
                ? hljs.highlight(text, { language }).value
                : escapeHtml(text);
            return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${html}</code></pre>\n`;
        },
    },
});

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, '_site');
const SITE = 'https://pranavpipariya.com';
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();
const sha = process.env.GITHUB_SHA || git('rev-parse HEAD');

// ── routes: every page's clean address, and the old addresses it replaces ───
// An entry with a label appears in the tree, in this order, once its page exists.
const ROUTES = [
    { src: 'index.html', path: '/' },
    { src: 'blog/index.html', path: '/writings/', label: 'writings/', old: ['blog/index.html', 'blog/archive.html'] },
    { src: 'other-writings.html', path: '/other-writings/', label: 'other-writings/', old: ['other-writings.html'] },
    { src: 'puzzles-and-games.html', path: '/puzzles-and-games/', label: 'puzzles-and-games/', old: ['puzzles-and-games.html'] },
    { src: 'books.html', path: '/books/', label: 'books/', old: ['books.html'] },
    { src: 'contact.html', path: '/contact/', label: 'contact', old: ['contact.html'] },
].filter((r) => existsSync(join(ROOT, r.src)));
const NAV = ROUTES.filter((r) => r.label);
// llms.txt, llms-full.txt, feed.xml and sitemap.xml are built too, but they're
// for machines, which find them by convention; they don't appear in the tree.

const postPath = (slug) => `/writings/${slug}/`;

function treeHtml(current, childLine = '', under = 'writings/') {
    const rows = NAV.map((e, i) => {
        const twig = i === NAV.length - 1 ? '└── ' : '├── ';
        const inner = e.label === current ? `<span class="here">${e.label}</span>` : `<a href="${e.path}">${e.label}</a>`;
        const row = `                    <div class="branch"><span class="twig">${twig}</span>${inner}</div>`;
        return e.label === under && childLine ? `${row}\n${childLine}` : row;
    });
    return `                <nav class="tree" aria-label="Site">
                    <h1 class="name"><a class="root" href="/">pranav</a></h1>
${rows.join('\n')}
                </nav>`;
}
const emptyLine = (label) => {
    const last = NAV[NAV.length - 1].label === label;
    return `                    <div class="branch"><span class="twig">${last ? ' ' : '│'}   └── </span><span class="here empty">(empty)</span></div>`;
};

// ── shared page parts ───────────────────────────────────────────────────────
const receipt = `            <div class="divider footer-divider">
                ................................................................................
            </div>
            <footer class="receipt"><span data-receipt></span></footer>`;

const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Pranav Pipariya',
    url: `${SITE}/`,
    sameAs: ['https://github.com/PranavPipariya', 'https://x.com/0xpermutations', 'https://instagram.com/pranavvverse'],
    founder: { '@type': 'Organization', name: 'Superintuition', url: 'https://superintuition.xyz' },
};
const headExtras = (isHome) => [
    `    <link rel="alternate" type="application/rss+xml" title="Pranav Pipariya" href="${SITE}/feed.xml" />`,
    `    <link rel="alternate" type="text/plain" title="For agents" href="${SITE}/llms.txt" />`,
    ...(isHome ? [`    <script type="application/ld+json">${JSON.stringify(person)}</script>`] : []),
].join('\n');

// Every link and asset becomes absolute and clean, wherever the page ends up.
const finish = (html, { isHome = false } = {}) => html
    .replace(/(?:\.\.\/)?(?:blog\/)?post\.html\?post=([\w-]+)/g, (_, slug) => postPath(slug))
    .replace(/href="(?:\.\.?\/)?theme\.css"/g, 'href="/theme.css"')
    .replace(/src="(?:\.\.?\/)?micro\.js"/g, 'src="/micro.js"')
    .replace(/src="post-extras\.js"/g, 'src="/writings/post-extras.js"')
    .replace('</head>', () => `${headExtras(isHome)}\n</head>`)
    .replace(/ *<!--receipt-->/, () => receipt)
    .replace(/<!--tree:([\w/-]*)(:empty)?-->/, (_, current, empty) =>
        empty ? treeHtml(current, emptyLine(current), current) : treeHtml(current || null));

function write(path, content) {
    const file = join(OUT, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}
const writePage = (path, html) => write(path.endsWith('/') ? `${path}index.html` : path, html);

// ── start clean; copy the assets that don't change ──────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const asset of ['theme.css', 'micro.js', 'images', 'resume', '.nojekyll']) {
    if (existsSync(join(ROOT, asset))) cpSync(join(ROOT, asset), join(OUT, asset), { recursive: true });
}
cpSync(join(ROOT, 'blog', 'post-extras.js'), join(OUT, 'writings', 'post-extras.js'));

// ── HTML to plain text, for the .txt twins ──────────────────────────────────
function toText(html) {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => {
            const t = text.replace(/<[^>]+>/g, '');
            const target = href.replace('mailto:', '');
            return (href.startsWith('mailto:') || href.startsWith('http')) && t !== target ? `${t} (${target})` : t;
        })
        .replace(/<\/(p|h[1-6]|li|div|pre|tr|blockquote)>/g, '\n\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<li[^>]*>/g, '- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’')
        .split('\n').map((l) => l.trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
const between = (html, open, close) => {
    const a = html.indexOf(open);
    if (a < 0) return '';
    const b = html.indexOf(close, a + open.length);
    return html.slice(a + open.length, b < 0 ? undefined : b);
};

// ── the posts ───────────────────────────────────────────────────────────────
const template = readFileSync(join(ROOT, 'blog', '_post.template.html'), 'utf8');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function timer(markdown) {
    const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/<[^>]+>/g, '');
    const words = prose.split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.round(words / 230))} min`;
}

const posts = [];
for (const file of readdirSync(join(ROOT, 'blog', 'posts')).filter((f) => f.endsWith('.md'))) {
    const slug = file.replace(/\.md$/, '');
    const raw = readFileSync(join(ROOT, 'blog', 'posts', file), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const meta = {};
    let body = raw;
    if (m) {
        for (const line of m[1].split('\n')) {
            const kv = line.match(/^(\w+):\s*(.*)$/);
            if (kv) meta[kv[1]] = kv[2].trim();
        }
        body = m[2];
    }
    const post = { slug, title: meta.title || slug, date: meta.date || '', excerpt: meta.excerpt || '', time: timer(body) };
    const page = template
        .replaceAll('{{TITLE}}', escape(post.title))
        .replaceAll('{{EXCERPT}}', escape(post.excerpt))
        .replaceAll('{{SLUG}}', slug)
        .replaceAll('{{DATE_ISO}}', post.date)
        .replaceAll('{{TIMER}}', post.time)
        .replace('{{CONTENT}}', () => marked.parse(body))
        .replace('{{RECEIPT}}', () => '<!--receipt-->')
        .replace('<!--tree:post-->', () => treeHtml(null,
            `                    <div class="branch"><span class="twig">│   └── </span><span class="here">${slug}.md</span><span class="file-meta">  ${post.date}  <span title="Reading time">${post.time}</span></span></div>`));
    writePage(postPath(slug), finish(page));
    // Its .txt twin is the markdown itself, minus the front matter.
    write(`writings/${slug}.txt`, `${post.title}\n${post.date}  ${post.time}\n\n${body.trim()}\n`);
    posts.push(post);
}
posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.slug.localeCompare(a.slug)));

// ── the pages ───────────────────────────────────────────────────────────────
for (const r of ROUTES) {
    writePage(r.path, finish(readFileSync(join(ROOT, r.src), 'utf8'), { isHome: r.path === '/' }));
}

// ── old addresses redirect to the new ones ──────────────────────────────────
const redirectPage = (to) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved</title>
<link rel="canonical" href="${SITE}${to}">
<meta http-equiv="refresh" content="0; url=${to}">
<script>location.replace(${JSON.stringify(to)} + location.hash);</script>
</head>
<body><p>This page moved to <a href="${to}">${SITE}${to}</a>.</p></body>
</html>
`;
const redirects = [
    ...ROUTES.flatMap((r) => (r.old || []).map((from) => [from, r.path])),
    ...posts.map((p) => [`blog/${p.slug}.html`, postPath(p.slug)]),
    ['blog/posts/collatz-conjecture.html', postPath('collatz-problem')],
];
for (const [from, to] of redirects) write(from, redirectPage(to));
// The oldest post links were blog/post.html?post=<slug>.
write('blog/post.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Moved</title>
<script>
const slug = new URLSearchParams(location.search).get('post');
location.replace(slug ? '/writings/' + slug + '/' : '/writings/');
</script></head><body><p>This page moved to <a href="/writings/">${SITE}/writings/</a>.</p></body></html>
`);

// ── plain-text twins ────────────────────────────────────────────────────────
const homeHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const contactHtml = readFileSync(join(ROOT, 'contact.html'), 'utf8');
const othersHtml = readFileSync(join(ROOT, 'other-writings.html'), 'utf8');
// Live sites on the other-writings page (commented-out ones are skipped).
const others = [...othersHtml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<li><a href="([^"]+)"[^>]*>([^<]+)<\/a><div class="other-meta">([^<]*)<\/div><\/li>/g)]
    .map(([, url, title, meta]) => ({ url, title, meta: meta.trim(), name: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
const homeText = toText(between(homeHtml, '<section class="content">', '</section>'));
const contactText = toText(between(contactHtml, '<section class="content">', '</section>'));
const children = { 'writings/': posts.map((p) => `${p.slug}.md`), 'other-writings/': others.map((o) => o.name) };
const tree = ['pranav', ...NAV.flatMap((e, i) => {
    const last = i === NAV.length - 1;
    const kids = children[e.label] || [];
    return [`${last ? '└──' : '├──'} ${e.label}`, ...kids.map((k, j) => `${last ? ' ' : '│'}   ${j === kids.length - 1 ? '└──' : '├──'} ${k}`)];
})].join('\n');
write('index.txt', `${tree}\n\n${homeText}\n\nwritings        ${SITE}/writings/index.txt\nother writings  ${SITE}/other-writings.txt\ncontact         ${SITE}/contact.txt\n`);
write('writings/index.txt', `writings/\n\n${posts.map((p) => `${p.date}  ${p.time}  ${p.title}\n            ${SITE}/writings/${p.slug}.txt`).join('\n\n')}\n`);
write('other-writings.txt', `other-writings/\n\n${others.map((o) => `${o.title}\n${o.url}\n${o.meta}`).join('\n\n')}\n`);
write('contact.txt', `contact\n\n${contactText}\n`);

// ── for agents: llms.txt and llms-full.txt ─────────────────────────────────
// The llms.txt convention (llmstxt.org): one plain file that tells an AI agent
// what the site is and where the plain-text versions live.
const link = (title, url, note) => `- [${title}](${url})${note ? `: ${note}` : ''}`;
write('llms.txt', [
    '# Pranav Pipariya',
    '',
    `> The personal site of Pranav Pipariya. Every page has a plain-text version; ${SITE}/llms-full.txt has all of it in one file.`,
    '',
    homeText,
    '',
    '## Writings',
    ...posts.map((p) => link(p.title, `${SITE}/writings/${p.slug}.txt`, p.excerpt)),
    '',
    '## Other writings',
    ...others.map((o) => link(o.title, o.url, o.meta)),
    '',
    '## Pages',
    link('Home', `${SITE}/index.txt`),
    link('Contact', `${SITE}/contact.txt`),
    link('RSS feed', `${SITE}/feed.xml`),
    '',
    '## Optional',
    link('Everything in one file', `${SITE}/llms-full.txt`),
    '',
].join('\n'));
write('llms-full.txt', [
    '# Pranav Pipariya', '', homeText, '', '## Contact', '', contactText, '',
    ...posts.flatMap((p) => ['', '---', '', readFileSync(join(OUT, 'writings', `${p.slug}.txt`), 'utf8').trim(), '']),
].join('\n'));

// ── for readers: an RSS feed ────────────────────────────────────────────────
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rfc822 = (d) => new Date(d + 'T00:00:00Z').toUTCString();
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Pranav Pipariya</title>
<link>${SITE}/</link>
<description>Writings by Pranav Pipariya.</description>
<language>en</language>
${posts.map((p) => `<item>
<title>${xml(p.title)}</title>
<link>${SITE}${postPath(p.slug)}</link>
<guid>${SITE}${postPath(p.slug)}</guid>
<pubDate>${rfc822(p.date)}</pubDate>
<description>${xml(p.excerpt)}</description>
</item>`).join('\n')}
</channel>
</rss>
`);

// ── for search engines and crawlers: sitemap and robots.txt ─────────────────
const urls = [...ROUTES.map((r) => r.path), ...posts.map((p) => postPath(p.slug))];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `# Humans, crawlers and agents are all welcome.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

// ── a 404 in the tree's language ────────────────────────────────────────────
write('404.html', `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>Not found - Pranav Pipariya</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/theme.css" />
    </head>

    <body>
        <main class="container">
            <header>
${treeHtml(null)}

                <div class="divider">
                    ................................................................................
                </div>
            </header>

            <section class="content">
                <p><span class="missing" data-missing>That page</span> doesn't exist. Everything that does is in the tree above.</p>
            </section>
        </main>
        <script>
            document.querySelector('[data-missing]').textContent = location.pathname;
        </script>
    </body>
</html>
`);

console.log(`built ${ROUTES.length} pages, ${posts.length} posts and ${redirects.length + 1} redirects at ${sha.slice(0, 7)} → ${relative(ROOT, OUT)}/`);

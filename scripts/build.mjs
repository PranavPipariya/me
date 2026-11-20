// Builds the site into _site/. Everything a visitor sees is decided here, so the
// browser never waits on anything:
//   - every post is rendered to plain HTML ahead of time (no loading state)
//   - every page gets a plain-text twin, for `curl pranavpipariya.com/index.txt`
//   - agents get llms.txt and llms-full.txt; readers get an RSS feed; search
//     engines get a sitemap and structured data about who runs the site
// Run with `npm run build`.

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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
const SKIP = new Set(['.git', '.github', '_site', 'node_modules', 'scripts', 'package.json', 'package-lock.json', 'BLOGGING.md', 'README.md', '.gitignore', '.DS_Store']);

// ── the build stamp ─────────────────────────────────────────────────────────
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();
const sha = process.env.GITHUB_SHA || git('rev-parse HEAD');
const short = sha.slice(0, 7);
const when = new Date(git(`show -s --format=%cI ${sha}`));
const stamp = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
const receipt = `            <div class="divider footer-divider">
                ................................................................................
            </div>
            <footer class="receipt"><span data-receipt></span>{{SOURCE}}</footer>`;
// The receipt ends with a window into the machine: this page's own source.
const REPO = 'https://github.com/PranavPipariya/me';
const receiptFor = (source) => receipt.replace('{{SOURCE}}', `<a href="${source}" target="_blank">source</a>`);

// ── the tree: one ordered list for the whole site ──────────────────────────
// An entry only shows up once its page exists, so nothing is ever a
// "coming soon" placeholder. Add puzzles-and-games.html or books.html and they
// appear in their place.
const NAV = [
    { label: 'writings/', href: 'blog/index.html' },
    { label: 'other-writings/', href: 'other-writings.html' },
    { label: 'puzzles-and-games/', href: 'puzzles-and-games.html' },
    { label: 'books/', href: 'books.html' },
    { label: 'contact', href: 'contact.html' },
].filter((e) => existsSync(join(ROOT, e.href)));
// llms.txt, llms-full.txt, feed.xml and sitemap.xml are built too, but they're
// for machines, which find them by convention; they don't appear in the tree.

function treeHtml(prefix, current, postLine = '', under = 'writings/') {
    const rows = NAV.map((e, i) => {
        const twig = i === NAV.length - 1 ? '└── ' : '├── ';
        const inner = e.label === current ? `<span class="here">${e.label}</span>` : `<a href="${prefix}${e.href}">${e.label}</a>`;
        const row = `                    <div class="branch"><span class="twig">${twig}</span>${inner}</div>`;
        return e.label === under && postLine ? `${row}\n${postLine}` : row;
    });
    return `                <nav class="tree" aria-label="Site">
                    <h1 class="name"><a class="root" href="${prefix}index.html">pranav</a></h1>
${rows.join('\n')}
                </nav>`;
}

// ── copy the site ───────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(ROOT)) {
    if (SKIP.has(name)) continue;
    cpSync(join(ROOT, name), join(OUT, name), { recursive: true });
}
rmSync(join(OUT, 'blog', '_post.template.html'));

// Posts used to live at post.html?post=<slug>; they are now <slug>.html.
const fixLinks = (html) => html.replace(/post\.html\?post=([\w-]+)/g, '$1.html');

// HTML to plain text, for the .txt twins and the command line.
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

// ── render the posts ────────────────────────────────────────────────────────
const template = readFileSync(join(ROOT, 'blog', '_post.template.html'), 'utf8');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function timer(markdown) {
    const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/<[^>]+>/g, '');
    const words = prose.split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(30, Math.ceil((words / 230) * 60 / 30) * 30);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const postsDir = join(ROOT, 'blog', 'posts');
const posts = [];
for (const file of readdirSync(postsDir).filter((f) => f.endsWith('.md'))) {
    const slug = file.replace(/\.md$/, '');
    const raw = readFileSync(join(postsDir, file), 'utf8');
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
    // Honest history: when the post last changed, from git, if it changed after it was written.
    // The first commit only added the file; edits are the commits after it.
    const commits = git(`log --format=%cs -- blog/posts/${file}`).split('\n').filter(Boolean);
    const changed = commits.length > 1 ? commits[0] : '';
    const history = changed && changed > post.date
        ? `  <a class="changed" href="${REPO}/commits/main/blog/posts/${file}" target="_blank">changed ${changed}</a>`
        : '';
    const page = template
        .replaceAll('{{TITLE}}', escape(post.title))
        .replaceAll('{{EXCERPT}}', escape(post.excerpt))
        .replaceAll('{{SLUG}}', slug)
        .replaceAll('{{DATE_ISO}}', post.date)
        .replaceAll('{{TIMER}}', post.time)
        .replace('{{CONTENT}}', () => marked.parse(body))
        .replace('{{RECEIPT}}', () => receiptFor(`${REPO}/blob/main/blog/posts/${slug}.md`))
        .replace('<!--tree:post-->', () => treeHtml('../', null,
            `                    <div class="branch"><span class="twig">│   └── </span><span class="here">${slug}.md</span><span class="file-meta">  ${post.date}${history}  <span title="Reading time">${post.time}</span></span></div>`));
    writeFileSync(join(OUT, 'blog', `${slug}.html`), fixLinks(page));
    // Its .txt twin is the markdown itself, minus the front matter.
    writeFileSync(join(OUT, 'blog', `${slug}.txt`), `${post.title}\n${post.date}  ${post.time}\n\n${body.trim()}\n`);
    posts.push(post);
}
posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.slug.localeCompare(a.slug)));

// Old post.html?post=<slug> links keep working.
writeFileSync(join(OUT, 'blog', 'post.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pranav Pipariya</title>
<script>
const slug = new URLSearchParams(location.search).get('post');
location.replace(slug ? slug + '.html' : 'index.html');
</script></head><body></body></html>
`);

// ── plain-text twins of the other pages ─────────────────────────────────────
const homeHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const contactHtml = readFileSync(join(ROOT, 'contact.html'), 'utf8');
const othersHtml = readFileSync(join(ROOT, 'other-writings.html'), 'utf8');
// Live sites on the other-writings page (commented-out ones are skipped).
const others = [...othersHtml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<li><a href="([^"]+)"[^>]*>([^<]+)<\/a><div class="other-meta">([^<]*)<\/div><\/li>/g)]
    .map(([, url, title, meta]) => ({ url, title, meta: meta.trim(), name: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
const homeText = toText(between(homeHtml, '<section class="content">', '</section>'));
const contactText = toText(between(contactHtml, '<section class="content">', '</section>')).replace(/^Contact\n+/, '');
const writingsText = posts.map((p) => `${p.date}  ${p.time}  ${p.title}\n            ${SITE}/blog/${p.slug}.txt`).join('\n\n');
const children = { 'writings/': posts.map((p) => `${p.slug}.md`), 'other-writings/': others.map((o) => o.name) };
const tree = ['pranav', ...NAV.flatMap((e, i) => {
    const last = i === NAV.length - 1;
    const kids = children[e.label] || [];
    return [`${last ? '└──' : '├──'} ${e.label}`, ...kids.map((k, j) => `${last ? ' ' : '│'}   ${j === kids.length - 1 ? '└──' : '├──'} ${k}`)];
})].join('\n');
writeFileSync(join(OUT, 'index.txt'), `${tree}\n\n${homeText}\n\nwritings        ${SITE}/blog/index.txt\nother writings  ${SITE}/other-writings.txt\ncontact         ${SITE}/contact.txt\nfor agents      ${SITE}/llms.txt\n`);
writeFileSync(join(OUT, 'other-writings.txt'), `other-writings/\n\n${others.map((o) => `${o.title}\n${o.url}\n${o.meta}`).join('\n\n')}\n`);
writeFileSync(join(OUT, 'contact.txt'), `contact\n\n${contactText}\n`);
writeFileSync(join(OUT, 'blog', 'index.txt'), `writings/\n\n${writingsText}\n`);

// ── for agents: llms.txt and llms-full.txt ─────────────────────────────────
// The llms.txt convention (llmstxt.org): one plain file that tells an AI agent
// what the site is and where the plain-text versions live.
const link = (title, url, note) => `- [${title}](${url})${note ? `: ${note}` : ''}`;
writeFileSync(join(OUT, 'llms.txt'), [
    '# Pranav Pipariya',
    '',
    `> The personal site of Pranav Pipariya. Every page has a plain-text version; ${SITE}/llms-full.txt has all of it in one file.`,
    '',
    homeText,
    '',
    '## Writings',
    ...posts.map((p) => link(p.title, `${SITE}/blog/${p.slug}.txt`, p.excerpt)),
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

writeFileSync(join(OUT, 'llms-full.txt'), [
    '# Pranav Pipariya',
    '',
    homeText,
    '',
    '## Contact',
    '',
    contactText,
    '',
    ...posts.flatMap((p) => ['', '---', '', readFileSync(join(OUT, 'blog', `${p.slug}.txt`), 'utf8').trim(), '']),
].join('\n'));

// ── for readers: an RSS feed ────────────────────────────────────────────────
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rfc822 = (d) => new Date(d + 'T00:00:00Z').toUTCString();
writeFileSync(join(OUT, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Pranav Pipariya</title>
<link>${SITE}/</link>
<description>Writings by Pranav Pipariya.</description>
<language>en</language>
${posts.map((p) => `<item>
<title>${xml(p.title)}</title>
<link>${SITE}/blog/${p.slug}.html</link>
<guid>${SITE}/blog/${p.slug}.html</guid>
<pubDate>${rfc822(p.date)}</pubDate>
<description>${xml(p.excerpt)}</description>
</item>`).join('\n')}
</channel>
</rss>
`);

// ── for search engines and crawlers: sitemap and robots.txt ─────────────────
const pages = ['', 'blog/index.html', ...NAV.filter((e) => e.href !== 'blog/index.html').map((e) => e.href), ...posts.map((p) => `blog/${p.slug}.html`)];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `<url><loc>${SITE}/${p}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(OUT, 'robots.txt'), `# Humans, crawlers and agents are all welcome.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

// ── structured data: who runs this site, for search engines and agents ──────
// (Contact details live on the contact page, not here.)
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

// ── a 404 in the tree's language ────────────────────────────────────────────
// Served for any missing address, at any depth, so links are absolute.
writeFileSync(join(OUT, '404.html'), `<!doctype html>
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
${treeHtml('/', null)}

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

// ── stamp every page ────────────────────────────────────────────────────────
function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.html')) {
            const html = readFileSync(p, 'utf8');
            const prefix = dir === OUT ? '' : '../';
            const out = fixLinks(html)
                .replace('</head>', () => `${headExtras(dir === OUT && name === 'index.html')}\n</head>`)
                .replace('<!--receipt-->', () => receiptFor(REPO))
                .replace(/<!--tree:([\w/-]*)(:empty)?-->/, (_, current, empty) => {
                    if (!empty) return treeHtml(prefix, current || null);
                    const last = NAV[NAV.length - 1].label === current;
                    const line = `                    <div class="branch"><span class="twig">${last ? ' ' : '│'}   └── </span><span class="here empty">(empty)</span></div>`;
                    return treeHtml(prefix, current, line, current);
                });
            if (out !== html) writeFileSync(p, out);
        }
    }
}
walk(OUT);

console.log(`built ${posts.length} posts, .txt twins, llms.txt, feed and sitemap at ${short}, ${stamp} → ${relative(ROOT, OUT)}/`);

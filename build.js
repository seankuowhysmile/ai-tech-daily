// 核心建置腳本：讀 posts/ 的 Markdown，套 templates/ 的版型，輸出到 dist/。
//
// 兩個路徑觀念在這份檔案裡嚴格分開，不可混用：
//   *Path / *Dir  → 檔案系統路徑，用 path.join（Windows 上是反斜線）
//   *Url          → 網址路徑，一律用正斜線
// 混用會導致「本機正常、部署到 Linux 全部 404」。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { render, escapeHtml } from './render.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(ROOT, 'posts');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const STATIC_DIR = path.join(ROOT, 'static');
const DIST_DIR = path.join(ROOT, 'dist');

marked.setOptions({ gfm: true, breaks: false });

/* ---------- 小工具 ---------- */

const warnings = [];
function warn(message) {
  warnings.push(message);
}

// 檔名 / 標題 → 網址用的 slug。保留中日韓文字（可用，只是網址會被百分號編碼）。
function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// 日期全程當「字串」處理，絕不建立 Date 物件做時區運算。
// 唯一的例外是 YAML 會把未加引號的 2026-09-05 解析成 Date，這裡把它轉回字串。
function resolveDate(frontMatterDate, baseName) {
  if (frontMatterDate instanceof Date) {
    return frontMatterDate.toISOString().slice(0, 10);
  }
  if (typeof frontMatterDate === 'string') {
    const trimmed = frontMatterDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  // 同時支援 2026-09-04.md（純日期，每日產出常見）與 2026-09-04-標題.md
  const fromFileName = baseName.match(/^(\d{4}-\d{2}-\d{2})(?:-|$)/);
  if (fromFileName) return fromFileName[1];
  return null;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

// 把 Markdown 壓成純文字，用來產生首頁摘要。
function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/\*\*|__|\*|~~/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeExcerpt(text, maxLength) {
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength);
  // 英文在字詞邊界切；中文沒有空白，直接切才是對的。
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > maxLength - 15 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.trimEnd()}…`;
}

function firstHeading(markdown) {
  const match = markdown.match(/^\s{0,3}#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

// 取第一個「真正的段落」當摘要來源：跳過標題、清單、引言、表格、原生 HTML。
// 這樣每日摘要那種「# 大標 → ## 小標 → 一句話結論」的結構，
// 抓到的會是那句結論，而不是把標題再唸一遍。
function firstParagraph(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  for (const block of withoutCode.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue; // 標題
    if (/^</.test(trimmed)) continue; // 原生 HTML（<details> 之類）
    if (/^(?:[-*+]|\d+\.)\s/.test(trimmed)) continue; // 清單
    if (/^>/.test(trimmed)) continue; // 引言
    if (/^\|/.test(trimmed)) continue; // 表格
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) continue; // 分隔線
    const text = stripMarkdown(trimmed);
    if (text) return text;
  }
  return stripMarkdown(withoutCode);
}

// 網址路徑一律正斜線，且對每個路徑片段做百分號編碼（中文 slug 需要）。
function encodeUrlPath(...segments) {
  return segments
    .filter(Boolean)
    .map((segment) => segment.split('/').map(encodeURIComponent).join('/'))
    .join('/');
}

function copyDirFiltered(sourceDir, targetDir, shouldSkip = () => false) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (shouldSkip(entry)) continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(from, to, shouldSkip);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/* ---------- 讀取文章 ---------- */

// 支援兩種擺法：
//   posts/foo.md            → 純文字文章
//   posts/foo/index.md      → 有附圖的文章，同資料夾的非 .md 檔會一起複製過去
function findPostSources() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const sources = [];
  for (const entry of fs.readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      sources.push({
        markdownPath: path.join(POSTS_DIR, entry.name),
        baseName: entry.name.replace(/\.md$/, ''),
        assetDir: null,
      });
    } else if (entry.isDirectory()) {
      const indexPath = path.join(POSTS_DIR, entry.name, 'index.md');
      if (fs.existsSync(indexPath)) {
        sources.push({
          markdownPath: indexPath,
          baseName: entry.name,
          assetDir: path.join(POSTS_DIR, entry.name),
        });
      }
    }
  }
  return sources;
}

function readPosts(config) {
  const posts = [];
  const seenSlugs = new Map();

  for (const source of findPostSources()) {
    // 正規化 CRLF，避免 Windows 換行讓 front matter 的 --- 分隔線解析失敗。
    const raw = fs.readFileSync(source.markdownPath, 'utf8').replace(/\r\n/g, '\n');
    const { data, content } = matter(raw);

    if (data.draft === true) continue;

    const relativeSource = path.relative(ROOT, source.markdownPath);

    const date = resolveDate(data.date, source.baseName);
    if (!date) {
      warn(
        `${relativeSource} 沒有日期。請在 front matter 加上 date: YYYY-MM-DD，` +
          `或把檔名改成 YYYY-MM-DD-標題 的形式。這篇會被排到最後。`
      );
    }

    const slug = slugify(data.slug || source.baseName.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
    if (!slug) {
      warn(`${relativeSource} 無法產生有效的網址名稱，已略過。`);
      continue;
    }
    if (seenSlugs.has(slug)) {
      throw new Error(
        `網址名稱重複： "${slug}" 同時來自 ${seenSlugs.get(slug)} 與 ${relativeSource}。\n` +
          `   請改掉其中一個檔名，或用 front matter 的 slug: 指定不同名稱。`
      );
    }
    seenSlugs.set(slug, relativeSource);

    // 標題若是從內文第一個 # 抓來的，就把那一行從內文移除，
    // 否則版型的 <h1> 加上內文的 <h1> 會讓標題連續出現兩次。
    const headingTitle = firstHeading(content);
    let body = content;
    if (!data.title && headingTitle) {
      body = content.replace(/^\s{0,3}#\s+.+$/m, '').replace(/^\n+/, '');
    }

    const title = String(data.title || headingTitle || slug);
    const excerpt = data.description
      ? String(data.description)
      : makeExcerpt(firstParagraph(body), config.excerptLength ?? 120);

    posts.push({
      slug,
      baseName: source.baseName,
      title,
      date,
      dateLabel: formatDate(date),
      excerpt,
      contentHtml: marked.parse(body),
      assetDir: source.assetDir,
      sourcePath: relativeSource,
      url: `${encodeUrlPath('posts', slug)}/`,
    });
  }

  // 新到舊。沒有日期的排最後。
  // 同一天有多篇時（例如 2026-09-05.md 與 2026-09-05-補記.md）用檔名昇冪，
  // 純日期的那篇排在當天的衍生文章前面，順序才穩定可預期。
  posts.sort((a, b) => {
    if (!a.date && !b.date) return a.baseName.localeCompare(b.baseName);
    if (!a.date) return 1;
    if (!b.date) return -1;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.baseName.localeCompare(b.baseName);
  });

  return posts;
}

/* ---------- 產生頁面 ---------- */

const EXTERNAL_LINK = /^(https?:|mailto:|#)/;

// rootPrefix 是「從這一頁回到站台根目錄」的相對路徑。
// 首頁是 ''，文章頁在 posts/<slug>/ 底下所以是 '../../'。
// 全站不使用任何以 / 開頭的絕對路徑，這樣專案站、使用者站、自訂網域、本機都能通用。
function resolveNav(config, rootPrefix) {
  return (config.nav || []).map((item) => ({
    label: item.label,
    href: EXTERNAL_LINK.test(item.href) ? item.href : `${rootPrefix}${item.href}`,
  }));
}

function buildPage({ layout, bodyHtml, config, rootPrefix, pageTitle, metaDescription }) {
  return render(layout, {
    lang: config.lang || 'zh-Hant',
    siteTitle: config.title,
    author: config.author || '',
    pageTitle,
    metaDescription: metaDescription || config.description || '',
    root: rootPrefix,
    year: new Date().getFullYear(),
    nav: resolveNav(config, rootPrefix),
    // resolveNav 讀的是 config.nav，包一層就能重用同一套外部／相對連結判斷
    footerLinks: resolveNav({ nav: config.footerLinks }, rootPrefix),
    body: bodyHtml,
  });
}

function buildRss(config, posts) {
  const base = String(config.url || '').replace(/\/+$/, '');
  const items = posts
    .slice(0, 20)
    .map((post) => {
      const link = `${base}/${post.url}`;
      const pubDate = post.date ? new Date(`${post.date}T00:00:00Z`).toUTCString() : '';
      return [
        '    <item>',
        `      <title>${escapeHtml(post.title)}</title>`,
        `      <link>${escapeHtml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeHtml(link)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : '',
        `      <description>${escapeHtml(post.excerpt)}</description>`,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeHtml(config.title)}</title>`,
    `    <link>${escapeHtml(base)}/</link>`,
    `    <description>${escapeHtml(config.description || config.title)}</description>`,
    `    <language>${escapeHtml(config.lang || 'zh-Hant')}</language>`,
    `    <atom:link href="${escapeHtml(base)}/rss.xml" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/* ---------- 主流程 ---------- */

export async function build({ quiet = false } = {}) {
  const startedAt = Date.now();
  warnings.length = 0;

  // 加上時間戳記讓 dev 模式重新載入設定檔時不會吃到 ESM 的模組快取。
  const configUrl = `${pathToFileURL(path.join(ROOT, 'site.config.js')).href}?t=${Date.now()}`;
  const config = (await import(configUrl)).default;

  const layout = fs.readFileSync(path.join(TEMPLATES_DIR, 'layout.html'), 'utf8');
  const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf8');
  const postTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf8');
  const archiveTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'archive.html'), 'utf8');

  const posts = readPosts(config);

  // 每次都從乾淨的 dist/ 開始，否則刪掉的文章會留下幽靈 HTML。
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const toListItem = (post) => ({
    title: post.title,
    date: post.date || '',
    dateLabel: post.dateLabel,
    excerpt: post.excerpt,
    url: post.url,
  });

  // 首頁：只列最近 N 篇。每天一篇的節奏下，首頁的用途是「看最近發生什麼」，
  // 不是「一次載入兩年份」。完整清單放在 /archive/。
  const homeCount = config.homePostCount ?? 30;
  const indexBody = render(indexTemplate, {
    siteTitle: config.title,
    siteDescription: config.description || '',
    posts: posts.slice(0, homeCount).map(toListItem),
    emptyState: posts.length === 0 ? '還沒有任何文章。在 posts/ 放一個 .md 檔就會出現在這裡。' : '',
    // 模板引擎沒有 if，用「0 或 1 個元素的陣列」做條件顯示，把標記留在模板裡。
    more: posts.length > homeCount ? [{ total: posts.length }] : [],
  });
  fs.writeFileSync(
    path.join(DIST_DIR, 'index.html'),
    buildPage({
      layout,
      bodyHtml: indexBody,
      config,
      rootPrefix: '',
      pageTitle: config.title,
    }),
    'utf8'
  );

  // 彙整頁 /archive/：全部文章，精簡樣式（只有日期與標題，不含摘要）。
  const archiveDir = path.join(DIST_DIR, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archiveBody = render(archiveTemplate, {
    total: posts.length,
    posts: posts.map((post) => ({ ...toListItem(post), url: `../${post.url}` })),
  });
  fs.writeFileSync(
    path.join(archiveDir, 'index.html'),
    buildPage({
      layout,
      bodyHtml: archiveBody,
      config,
      rootPrefix: '../',
      pageTitle: `全部文章 — ${config.title}`,
      metaDescription: `${config.title} 的全部 ${posts.length} 篇文章。`,
    }),
    'utf8'
  );

  // 文章頁
  for (const post of posts) {
    const postDir = path.join(DIST_DIR, 'posts', post.slug);
    fs.mkdirSync(postDir, { recursive: true });

    const postBody = render(postTemplate, {
      title: post.title,
      date: post.date || '',
      dateLabel: post.dateLabel,
      content: post.contentHtml,
      root: '../../',
      // 模板引擎沒有 if，用「0 或 1 個元素的陣列」做條件顯示（同首頁的 more）。
      // 只有文章頁有留言區，首頁與 /archive/ 不傳。
      giscus: config.giscus && config.giscus.repoId ? [config.giscus] : [],
    });

    fs.writeFileSync(
      path.join(postDir, 'index.html'),
      buildPage({
        layout,
        bodyHtml: postBody,
        config,
        rootPrefix: '../../',
        pageTitle: `${post.title} — ${config.title}`,
        metaDescription: post.excerpt,
      }),
      'utf8'
    );

    // 文章資料夾裡的附件（圖片等）原樣複製，讓 ![](shot.svg) 這種相對路徑直接成立。
    if (post.assetDir) {
      copyDirFiltered(post.assetDir, postDir, (entry) => entry.isFile() && entry.name.endsWith('.md'));
    }
  }

  // 樣式表
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'style.css'), path.join(DIST_DIR, 'style.css'));

  // 全站共用的靜態檔（favicon、CNAME 之類），有這個資料夾才複製。
  if (fs.existsSync(STATIC_DIR)) {
    copyDirFiltered(STATIC_DIR, DIST_DIR);
  }

  // RSS
  fs.writeFileSync(path.join(DIST_DIR, 'rss.xml'), buildRss(config, posts), 'utf8');

  // 讓 GitHub Pages 不要用 Jekyll 處理輸出（Jekyll 會忽略底線開頭的檔案）。
  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');

  if (!quiet) {
    for (const message of warnings) console.warn(`⚠️  ${message}`);
    console.log(`✅ 已產生 ${posts.length} 篇文章，耗時 ${Date.now() - startedAt}ms → dist/`);
  }

  return { posts, warnings: [...warnings] };
}

// 直接用 node build.js 執行時才跑；被 dev.js import 時不跑。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  build().catch((error) => {
    console.error(`\n❌ 建置失敗：${error.message}\n`);
    process.exit(1);
  });
}

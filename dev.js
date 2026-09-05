// 開發模式：建置一次 → 起本機伺服器 → 監看檔案變動 → 自動重建 → 通知瀏覽器刷新。
//
// 只用 Node 內建模組，不增加任何依賴。
// 瀏覽器刷新是靠 SSE（Server-Sent Events）：dev 模式下會往每一頁的 HTML 注入一小段
// 客戶端腳本，正式 build（pnpm build）產出的檔案不會有這段東西。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4173;

const WATCH_TARGETS = [
  path.join(ROOT, 'posts'),
  path.join(ROOT, 'templates'),
  path.join(ROOT, 'static'),
  path.join(ROOT, 'site.config.js'),
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const LIVE_RELOAD_SNIPPET = `
<script>
  (function () {
    var source = new EventSource('/__dev/events');
    source.addEventListener('reload', function () { location.reload(); });
    source.addEventListener('error', function () { /* 伺服器重啟中，EventSource 會自己重連 */ });
  })();
</script>
`;

/* ---------- 建置狀態 ---------- */

// dist/ 每次重建都會先被清空，所以請求必須等目前這次建置結束再讀檔，
// 否則會在重建的那一瞬間讀到不存在的檔案。
let pendingBuild = Promise.resolve();

async function runBuild(label) {
  const startedAt = Date.now();
  try {
    const { posts, warnings } = await build({ quiet: true });
    for (const message of warnings) console.warn(`⚠️  ${message}`);
    console.log(`✅ ${label}：${posts.length} 篇文章，${Date.now() - startedAt}ms`);
    return true;
  } catch (error) {
    console.error(`\n❌ 建置失敗：${error.message}\n`);
    return false;
  }
}

/* ---------- SSE ---------- */

const clients = new Set();

function broadcastReload() {
  for (const client of clients) {
    client.write('event: reload\ndata: 1\n\n');
  }
}

/* ---------- 伺服器 ---------- */

function resolveFilePath(urlPath) {
  // decodeURIComponent 讓中文網址能對應到實際檔名。
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  const normalized = path
    .normalize(decoded)
    .replace(/^([/\\])+/, '')
    .replace(/[/\\]+$/, '');

  const candidate = path.join(DIST_DIR, normalized);

  // 擋住 ../ 之類想跳出 dist/ 的路徑。
  const relative = path.relative(DIST_DIR, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return path.join(candidate, 'index.html');
  }
  return candidate;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__dev/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write('retry: 500\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  await pendingBuild;

  const filePath = resolveFilePath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<h1>404</h1><p>找不到這個頁面。</p>');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';

  if (extension === '.html') {
    const html = fs.readFileSync(filePath, 'utf8');
    const withReload = html.includes('</body>')
      ? html.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`)
      : html + LIVE_RELOAD_SNIPPET;
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(withReload);
    return;
  }

  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
});

/* ---------- 監看 ---------- */

let debounceTimer = null;

function scheduleRebuild() {
  clearTimeout(debounceTimer);
  // 編輯器存檔常會觸發多次事件，稍微延遲把它們合併成一次重建。
  debounceTimer = setTimeout(() => {
    pendingBuild = runBuild('重新建置').then((ok) => {
      // 建置完成後才通知瀏覽器，避免刷新到還沒寫完的檔案。
      if (ok) broadcastReload();
    });
  }, 120);
}

function startWatching() {
  for (const target of WATCH_TARGETS) {
    if (!fs.existsSync(target)) continue;
    const isDirectory = fs.statSync(target).isDirectory();
    try {
      fs.watch(target, { recursive: isDirectory }, scheduleRebuild);
    } catch (error) {
      console.warn(`⚠️  無法監看 ${path.relative(ROOT, target)}：${error.message}`);
    }
  }
}

/* ---------- 啟動 ---------- */

pendingBuild = runBuild('初次建置');
await pendingBuild;

startWatching();

server.listen(PORT, () => {
  console.log(`\n🚀 開發伺服器： http://localhost:${PORT}`);
  console.log('   修改 posts/、templates/ 或 site.config.js 會自動重建並刷新瀏覽器。');
  console.log('   按 Ctrl+C 結束。\n');
});

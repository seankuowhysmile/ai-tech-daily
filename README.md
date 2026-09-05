# micro-blog-engine

一個輕量的個人 Markdown 靜態網誌產生器。沒有框架，只有兩個依賴（`marked`、`gray-matter`）與大約 500 行自己的程式碼。

```bash
pnpm install   # 只需要做一次
pnpm dev       # 開發模式：自動重建 + 瀏覽器自動刷新 → http://localhost:4173
pnpm build     # 正式建置 → dist/
```

## 專案結構

```
posts/               你的文章（.md）
├── welcome.md               純文字文章
└── typography-test/         有附圖的文章
    ├── index.md
    └── sample.svg           圖片跟文章放一起，路徑直接寫檔名

templates/           版型（純 HTML + {{token}}，打開就是網頁）
├── layout.html              外框：head、導覽列、頁尾、深色模式腳本
├── index.html               首頁的文章列表
├── post.html                單篇文章
└── style.css                樣式表

static/              （可選，自己建立）原樣複製到網站根目錄，放 favicon、CNAME 之類
dist/                建置產物，每次 build 會先清空，不進版控

site.config.js       站名、作者、網址、導覽列
build.js             建置腳本
dev.js               開發伺服器
render.js            模板引擎
```

## 寫一篇文章

在 `posts/` 放一個 `.md` 檔：

```markdown
---
title: 文章標題
date: 2026-09-05
description: 首頁列表要顯示的摘要
draft: false
slug: custom-url-name
---

正文從這裡開始。
```

五個欄位全部可省略：

| 欄位 | 省略時 |
| --- | --- |
| `title` | 取內文第一個 `#` 標題，再沒有就用檔名 |
| `date` | 取檔名的 `YYYY-MM-DD-` 前綴；再沒有就發出警告並排到最後 |
| `description` | 自動擷取內文前 120 字（先去除 Markdown 語法） |
| `draft` | 預設 `false`；設為 `true` 則完全不輸出 |
| `slug` | 由檔名產生，網址為 `/posts/<slug>/` |

建議檔名用英文。中文可用，但網址會變成百分號編碼。

## 部署到 GitHub Pages

`.github/workflows/deploy.yml` 已經寫好了，流程是 push → 自動 build → 自動部署。

**但有一個只有你能做的步驟**：到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。沒選這個，workflow 會跑但不會發佈。

另外記得把 `site.config.js` 的 `url` 改成你的實際網址（只影響 RSS 裡的連結）。

## 設計上的幾個決定

這些是刻意的，不是疏漏：

- **全站相對路徑**，不使用任何 `/` 開頭的絕對路徑。所以專案站、使用者站、自訂網域、本機都能通用，換部署位置不用改程式。
- **日期全程當字串處理**，不建立 `Date` 物件做時區運算，也絕不讀取檔案修改時間（`git clone` 不保留 mtime，用它當預設值會讓 CI 上的所有文章都變成「今天」）。
- **模板只做單次掃描替換**，`{{key}}` 自動 HTML 跳脫、`{{{key}}}` 不跳脫。文章內容裡的 `{{...}}` 不會被誤判成模板指令。
- **不做 Markdown 淨化**。內容來源是你自己的檔案，保留原生 HTML 讓你能直接嵌 `<details>`、`<iframe>` 等。若日後開放他人投稿，這個前提就不成立了。
- **不裝語法高亮**。`marked` 已輸出 `class="language-xxx"`，未來要加是純加法。

# AI 科技日報 — 靜態網誌

把 `ai-tech-vlog-bot` 每天產出的 Markdown 渲染成網站。沒有框架，兩個依賴（`marked`、`gray-matter`）加上約 550 行自己的程式碼。

```bash
pnpm install   # 只需要做一次
pnpm dev       # 開發模式：自動重建 + 瀏覽器自動刷新 → http://localhost:4173
pnpm build     # 正式建置 → dist/
```

## 整體架構

```
ai-tech-vlog-bot（private）              這個 repo（public）
├── src/            Python 產生器         ├── posts/       ← 收到的 .md
├── archive/*.md ───每天 push───────────▶ ├── templates/   版型
└── .github/workflows/daily.yml          ├── build.js 等
                                          └── .github/workflows/deploy.yml
                                                    │
                                                    ▼
                                            GitHub Pages
```

產生器留在私有 repo，只有文章內容跟網誌本身是公開的。

## 專案結構

```
posts/               文章（.md），由 bot 每天同步進來
templates/           版型（純 HTML + {{token}}，打開就是網頁）
├── layout.html          外框：head、導覽列、頁尾、深色模式腳本
├── index.html           首頁（最近 30 篇）
├── archive.html         全部文章列表
├── post.html            單篇文章
└── style.css            樣式表
static/              （可選，自己建立）原樣複製到網站根目錄，放 favicon、CNAME
dist/                建置產物，每次 build 會清空，不進版控
site.config.js       站名、網址、導覽列、首頁篇數
build.js dev.js render.js
docs/bot-publish-step.yml   要貼進 bot repo 的 workflow 片段
```

## 首次設定（四步）

### 1. 建立公開 repo 並推上去

```bash
git remote add origin https://github.com/<你的帳號>/ai-tech-daily.git
git push -u origin main
```

### 2. 開啟 GitHub Pages

到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。

> 這一步**只有你能做**，沒有任何腳本能代勞。沒選這個，workflow 會跑完但不會發佈。

接著把 `site.config.js` 的 `url` 改成 `https://<你的帳號>.github.io/ai-tech-daily`（只影響 RSS 裡的連結）。

### 3. 產生 PAT 讓 bot 能推文章過來

到 **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens**，建立一個：

- **Repository access**：只選這個網誌 repo
- **Permissions → Repository permissions → Contents**：**Read and write**

複製產生的 token，到 **ai-tech-vlog-bot 的 Settings → Secrets and variables → Actions**，新增 secret：

- Name：`BLOG_REPO_TOKEN`
- Secret：剛剛複製的 token

### 4. 在 bot 的 workflow 加上推送步驟

把 `docs/bot-publish-step.yml` 的內容貼進 `ai-tech-vlog-bot/.github/workflows/daily.yml`，位置在 `Commit sent history and article archive` 之後、`Archive video to GitHub Release` 之前。記得把裡面的 `BLOG_REPO` 改成你的實際 repo。

完成後，每天的流程是：bot 產文 → 推到這個 repo → 自動 build → Pages 更新。

## 文章格式

bot 產出的 `YYYY-MM-DD.md` **不需要任何 front matter**，這個引擎會自動處理：

| 欄位 | 來源 |
| --- | --- |
| 標題 | 內文第一個 `# ` 標題 |
| 日期 | 檔名的 `YYYY-MM-DD`（同時支援 `2026-09-04.md` 與 `2026-09-04-標題.md`）|
| 摘要 | 第一個「真正的段落」，會跳過標題、清單、`<details>`。剛好就是「【時事層：一句話看懂】」下面那句 |
| 網址 | `/posts/2026-09-04/` |

你也可以手寫文章並加上 front matter 覆寫這些預設值，`draft: true` 則完全不輸出。

## 設計上的幾個決定

這些是刻意的，不是疏漏：

- **全站相對路徑**，不使用任何 `/` 開頭的絕對路徑。專案站、使用者站、自訂網域、本機都通用，換部署位置不用改程式。
- **日期全程當字串處理**，不建立 `Date` 物件做時區運算，也絕不讀取檔案修改時間（`git clone` 不保留 mtime，用它當預設值會讓 CI 上的所有文章都變成「今天」）。
- **模板只做單次掃描替換**，`{{key}}` 自動 HTML 跳脫、`{{{key}}}` 不跳脫。文章內容裡的 `{{...}}` 不會被誤判成模板指令。
- **不做 Markdown 淨化**。bot 產出的 `<details>` 摺疊區塊需要原生 HTML 通過。前提是內容來源可信；若日後開放他人投稿，這個前提就不成立了。
- **首頁只列最近 30 篇**，完整清單在 `/archive/`。每天一篇的節奏下，首頁的用途是「看最近發生什麼」。
- **不裝語法高亮**。`marked` 已輸出 `class="language-xxx"`，未來要加是純加法。

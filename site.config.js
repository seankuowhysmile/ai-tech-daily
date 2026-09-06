// 網站設定。改這裡就好，不用碰 build.js。
export default {
  // 站名，會顯示在導覽列左側與瀏覽器分頁
  title: 'AI 科技日報',

  // 副標題，顯示在首頁標題下方（留空字串則不顯示）
  description: '每日自動彙整的 AI 與科技新聞。一天一篇，挑一則講透，其餘掃過就好。',

  // 作者名稱，用於 RSS 與頁尾
  author: 'Sean',

  // 網站的完整網址，RSS 需要絕對路徑才能正確運作。
  // GitHub Pages 專案站格式： https://<你的帳號>.github.io/<repo 名稱>
  // ⚠️ 建好 repo 後記得把這行改成你的實際網址。
  url: 'https://seankuowhysmile.github.io/ai-tech-daily',

  // 語言標籤，會寫進 <html lang="...">
  lang: 'zh-Hant',

  // 導覽列項目。href 若以 http / mailto / # 開頭視為外部連結，
  // 否則視為站內相對路徑（build 時會自動補上正確的層級前綴）。
  nav: [
    { label: '首頁', href: '' },
    { label: '全部文章', href: 'archive/' },
  ],

  // 首頁最多列出幾篇。超過的部分只會出現在 /archive/。
  homePostCount: 30,

  // 首頁摘要的最大字數
  excerptLength: 120,
};

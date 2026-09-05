// 網站設定。改這裡就好，不用碰 build.js。
export default {
  // 站名，會顯示在導覽列左側與瀏覽器分頁
  title: 'Sean 的筆記',

  // 副標題，顯示在首頁標題下方（留空字串則不顯示）
  description: '一些關於開發、工具與想法的隨手紀錄。',

  // 作者名稱，用於 RSS 與頁尾
  author: 'Sean',

  // 網站的完整網址，RSS 需要絕對路徑才能正確運作。
  // 部署到 GitHub Pages 專案站時格式為： https://<你的帳號>.github.io/<repo 名稱>
  // 尚未部署可以先留著，只會影響 rss.xml 裡的連結。
  url: 'https://example.github.io/micro-blog-engine',

  // 語言標籤，會寫進 <html lang="...">
  lang: 'zh-Hant',

  // 導覽列項目。href 若以 http / mailto / # 開頭視為外部連結，
  // 否則視為站內相對路徑（build 時會自動補上正確的層級前綴）。
  nav: [
    { label: '首頁', href: '' },
    // { label: 'GitHub', href: 'https://github.com/your-account' },
  ],

  // 首頁摘要的最大字數
  excerptLength: 120,
};

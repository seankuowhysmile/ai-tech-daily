// 極簡模板引擎。
//
// 支援三種語法：
//   {{key}}                     → 插入值，並做 HTML 跳脫（安全預設）
//   {{{key}}}                   → 插入值，不跳脫（只給已經是 HTML 的內容用，例如 marked 的輸出）
//   {{#each list}}...{{/each}}  → 對陣列每一項渲染一次區塊內容
//
// 關鍵設計：整份模板只做「單一次」掃描。三種語法合併成同一個正則，
// 在同一輪 String.replace 裡分派處理，所以替換進去的值永遠不會被再次掃描。
// 這表示文章內容若含有 {{something}}（例如一篇介紹 Vue 或 Handlebars 的文章）
// 不會被誤判成模板指令而消失。

// 注意：這裡刻意用「正則字面值」而不是 new RegExp('...')。
// 用字串建構正則時，\d 之類的跳脫要寫成 \\d，少一個反斜線 JS 會靜默降級成普通字母，
// 不報錯、只是永遠配對不到，非常難查。字面值沒有這個問題。
const PATTERN =
  /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}|\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function lookup(data, key) {
  return key.split('.').reduce((object, part) => (object == null ? undefined : object[part]), data);
}

export function render(template, data) {
  return String(template).replace(
    PATTERN,
    (_match, eachKey, eachBody, rawKey, escapedKey) => {
      // {{#each list}}...{{/each}}
      if (eachKey !== undefined) {
        const list = lookup(data, eachKey);
        if (!Array.isArray(list)) return '';
        return list.map((item) => render(eachBody, { ...data, ...item })).join('');
      }

      // {{{key}}} 或 {{key}}
      const key = rawKey ?? escapedKey;
      const value = lookup(data, key);
      if (value === undefined || value === null) return '';
      return rawKey !== undefined ? String(value) : escapeHtml(value);
    }
  );
}

# Reading Marker — 螢光筆・筆記・目錄

在任何網頁上畫螢光筆、寫筆記、開浮動目錄的 Chrome 擴充功能。
畫記以「文字引用錨」（exact＋前後文）定位，資料只存在本機 `chrome.storage`，不需帳號。

## 安裝（開發者模式）

1. 開啟 `chrome://extensions`
2. 右上角開啟「開發人員模式」
3. 點「載入未封裝項目」，選擇本資料夾

## 功能

- **螢光筆**：選取文字 → 浮出四色工具列；點「＋筆記」可直接寫筆記
- **筆記**：Enter 送出、Shift+Enter 換行；點畫記可再編輯、換色、刪除
- **筆記清單**：右下角浮動按鈕（有畫記時出現），點項目跳至原文
- **目錄**：掃描頁面 h1–h4，右下角浮動按鈕開啟，支援捲動高亮
- **popup 設定**：筆記／目錄各自開關、單一網站停用、四色槽自訂顏色與說明
- **匯出**：一鍵複製本頁畫記與筆記為 Markdown

## 開發

```bash
npm test   # node --test：錨定引擎與純邏輯單元測試
```

- `src/anchor.js`：text-quote 錨定引擎（純函式）
- `src/util.js`：設定合併、page key、Markdown 匯出（純函式）
- `src/content.js`：畫記引擎 + Shadow DOM UI
- `src/popup.*`：設定介面

畫記資料以頁面網址（不含 `#hash`）為 key，存於 `chrome.storage.local`；
設定存於同處 `settings` key。

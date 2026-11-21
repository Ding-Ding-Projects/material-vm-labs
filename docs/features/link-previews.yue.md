# 連結預覽

有人分享呢個網站嘅連結嗰陣，聊天 app 會顯示一張真正 app 嘅大圖。

狀態：**進行中**。

## 佢做啲咩

`scripts/make-social-preview.mjs` 會用 app 圖示同一張 manager 嘅真實截圖，喺 repository 根目錄整出 `social-preview.png`（1280 x 640）。網站建置會將佢抄去一個包含佢 hash 嘅檔名，檢查副本逐個 byte 一樣，再喺每一頁寫入 Open Graph 同 Twitter 標籤：標題、描述、URL、類型、網站名、一個連埋闊度、高度同替代文字嘅絕對圖片 URL、`summary_large_image`，同埋 `theme-color`。

## 狀態同仲有咩未做

網站嘅標籤已經整好。Repository 自己嘅預覽圖係一個 GitHub 設定，冇得用 script 做：喺 Settings、General、Social preview 底下上載 repository 根目錄嘅 `social-preview.png`。由已部署嘅網站讀返啲標籤出嚟核對，呢樣仲未做。

## 建議文章

- [第一個畫面顯示版本同建置時間](version-on-first-screen.md)
- [手機大細嘅 PDF 版](pdf-edition.md)
- [所有功能同佢哋嘅狀態](README.md)

# 手機大細嘅 PDF 版

成套文件整成一個 PDF，每頁係手機大細，仲有可以撳嘅目錄。

狀態：**已推出**。

## 佢做啲咩

`node scripts/build-docs-pdf.mjs` 會將建置好嘅網站轉做 `material-vm-labs-docs.pdf`，而 release workflow 會將佢附喺每個 release 上面。

## 點樣用

喺最新嘅 release 下載，或者先行 `node scripts/build-site.mjs` 再行 `node scripts/build-docs-pdf.mjs` 自己建置。

## 點樣檢查過

每次 release，release workflow 都會建置佢。

## 建議文章

- [App 入面嘅離線文件](offline-documentation.md)
- [連結預覽](link-previews.md)
- [所有功能同佢哋嘅狀態](README.md)

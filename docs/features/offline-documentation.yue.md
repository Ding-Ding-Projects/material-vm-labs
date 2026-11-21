# App 入面嘅離線文件

呢套文件入面每篇文章喺建置嗰陣都會打包入啲 app，冇網都睇得，仲搜尋得。

狀態：**已推出**。

## 佢做啲咩

建置嗰陣，`docs/` 底下每個 Markdown 檔，加埋 README、roadmap 同交接筆記，都會轉做 HTML 再打包。文件閱讀器同 manager 嘅 Docs（文件）頁會連埋搜尋功能顯示佢哋；文章之間嘅連結會喺 app 入面打開，圖片亦都會嵌入去。

## 出事嘅時候

連去一個冇打包到嘅檔案嘅連結，會顯示做失效連結，連埋缺少咗嘅路徑。一個喺有文章冇打包到嗰陣就會失敗嘅建置檢查，仲未做。

## 點樣檢查過

每次建置 companion，個包都係由 `companion/tools/prepare.mjs` 整出嚟。

## 建議文章

- [手機大細嘅 PDF 版](pdf-edition.md)
- [第一個畫面顯示版本同建置時間](version-on-first-screen.md)
- [所有功能同佢哋嘅狀態](README.md)

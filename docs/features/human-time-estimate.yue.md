# 行數同人手時間估算

每個 release 都會寫出個項目嘅行數，同埋估計一個人親手寫要用幾耐。

狀態：**進行中**。

## 佢做啲咩

Release workflow 會行 `node scripts/count-lines.mjs` 出行數表，再用同一次執行入面同一個計數器嘅 JSON 去行 `node scripts/human-time-estimate.mjs`。個估算係一個範圍，清楚標明係估算，附上佢嘅輸入（非空白嘅原始碼、測試同標記語言行數）、假設嘅速度同一行算式。佢會好似計行數咁，一樣唔計自動產生嘅檔案、lock 檔、字型、圖片、PDF 同設計畫框。

## 狀態同仲有咩未做

開始、完成時間同用咗幾耐已經記錄喺 release notes 入面。估算嗰部分已經加咗入 workflow，但係仲未喺任何已發佈嘅 release 出現過，所以 README 暫時未引用任何數字。

## 建議文章

- [README 版面同社群檔案](readme-and-community-files.md)
- [建置入口](build-entry-points.md)
- [所有功能同佢哋嘅狀態](README.md)

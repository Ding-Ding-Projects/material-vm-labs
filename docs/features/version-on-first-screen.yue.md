# 第一個畫面顯示版本同建置時間

每個 app 同個網站都會喺第一個畫面顯示行緊嘅版本同佢幾時整出嚟，精確到秒，仲有時區。

狀態：**進行中**。

## 佢做啲咩

喺 app 入面，嗰行資料嚟自建置本身嘅 metadata（`generated/docs.json`，建置嗰陣寫低）：版本、commit 同時間，用你本地嘅時區顯示，連埋 UTC 偏移同時區名。喺網站首頁，就係建置網站所用嘅版本、commit 同 commit 時間，由網站建置寫入頁面，再用你本地嘅時間顯示。佢永遠唔會用開 app 嘅時間、檔案日期或者時鐘。冇 metadata 就會顯示「unavailable」（唔可用）。

## 狀態同仲有咩未做

網站嗰行已經整好。App 嗰行亦整好咗，只要將佢嘅 script 加入每個 app，就會喺 manager 嘅第一個畫面出現。App 而家顯示嘅係建置時間；要改為顯示 commit 時間，就要建置 metadata 記錄埋佢先得。

## 建議文章

- [自動更新](automatic-updates.md)
- [App 入面嘅離線文件](offline-documentation.md)
- [連結預覽](link-previews.md)

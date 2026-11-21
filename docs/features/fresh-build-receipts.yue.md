# 全新主機建置收據

`mvl build` 證明某個 repository 嘅一個指定 commit 喺一部乾淨嘅機上面建置得到，仲會寫低一張收據講清楚發生咗咩事。

狀態：**已推出**。

## 佢做啲咩

佢會喺你指定嘅 commit 做一個全新 clone，將實驗機還原返基線，將 source 抄入去，再逐個入口程式用 `<entry>.bat /s` 加 `SILENT=1` 去行，一失敗就停。佢會記低前後嘅程式、PATH 項目同 Chocolatey 套件，所以收據會列出建置需要下載嘅每一個相依套件，而建置寫出嚟嘅每個安裝程式、套件或者壓縮檔，佢都會收集埋同計 hash。

## 點樣用

```bat
mvl build proof-1 --repo owner/name --ref <sha> --entry build,build-installer --evidence evidence\receipts
```

淨係每個入口程式都過晒，exit code 先會係 0。

## 設定

`--no-reset` 會跳過還原；`--evidence <dir>` 會將收據同 log 抄去你揀嘅資料夾。

## 出事嘅時候

收據嘅 `verdict` 會係 `failed`，連埋每個入口程式嘅 exit code 同 log。如果一個建置要管理員權限但係冇提升權限咁行，就會照實報返當時發生咗咩。

## 安全

你嘅 Git 憑證會留喺主機；淨係 clone 嘅 zip 會入客機。客機入面嘅 User Account Control 同 Defender 保持開住，咁樣結果先反映到一部真正全新嘅主機。

## 點樣檢查過

收據嘅 schema 有文件寫清楚，manager 嘅 Receipts（收據）畫面會讀佢。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [喺全新環境做建置](../building/fresh-build.md)
- [點樣睇收據](../building/receipts.md)
- [安裝程式測試](installer-tests.md)

# 官方安裝媒體下載同驗證

`mvl media` 會下載官方嘅 Windows 11 Enterprise 評估版映像，喺任何機用之前先檢查好佢。

狀態：**已推出**。

## 佢做啲咩

Microsoft 冇為評估版映像公佈 SHA-256，所以 `mvl media` 用第二個方法檢查：每一次轉址都一定要留喺 `microsoft.com` 嘅 HTTPS 上面、byte 數一定要同 Microsoft 傳過嚟嘅一樣、掛載咗嘅映像入面嘅 `setup.exe` 一定要有有效嘅 Microsoft Authenticode 簽署，而且安裝映像一定要存在。之後會記低映像嘅 SHA-256，每開一部新機之前都會再對一次。

## 點樣用

```bat
mvl media
mvl media --force
```

## 出事嘅時候

檢查唔過嘅話，下載咗嘅嘢就唔會俾人用，仲會話你知係邊個檢查唔過。行 `mvl media --force` 重新下載。

如果個 ISO 明明喺 `AppData` 入面，Windows 都話開唔到，通常係管理程式或者 CLI 喺一個封裝 app 嘅沙盒入面行緊。呢種沙盒會將 AppData 啲檔案轉去一個私人資料夾，Windows 嘅磁碟服務睇唔到。喺設定或者首次設定揀一個 `AppData` 以外嘅狀態資料夾，再將個 ISO 搬入佢嘅 `media` 資料夾。

## 安全

驗證過嘅映像紀錄放喺狀態資料夾入面嘅 `media\media-en-us.json`。Linux 機用各個發行版嘅 cloud image 同佢哋公佈嘅 checksum。

## 點樣檢查過

喺 2026-11-17 驗證過一個映像；佢嘅名、大細同 SHA-256 喺安裝媒體參考文件入面。

## 建議文章

- [安裝媒體同驗證](../reference/media-and-verification.md)
- [一個指令開一部實驗機](lab-machines.md)
- [全新主機建置收據](fresh-build-receipts.md)

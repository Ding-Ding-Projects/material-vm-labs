# 安裝程式測試

`mvl install` 會喺一部乾淨、已登入嘅客機入面行你嘅安裝程式，再記低佢做過啲咩。

狀態：**已推出**。

## 佢做啲咩

部機會先還原返基線，列出 LocalAppData、AppData、ProgramData 同 Program Files 底下嘅資料夾，然後喺已登入嘅客機 session 入面行安裝程式，等佢嘅表現同一個真人見到嘅一樣。等一陣之後會再列一次啲資料夾，同埋影一張客機截圖。安裝程式收據會記低安裝程式嘅 SHA-256、參數、exit code 同新出現嘅資料夾。

## 點樣用

```bat
mvl install proof-1 --file dist\installer\Setup.exe --evidence evidence\installs
```

`--args` 用嚟傳參數，例如 `--silent`；`--wait` 設定要等幾多秒（預設 60）。`.msi` 會經 `msiexec /i` 行。

## 出事嘅時候

Exit code 0 淨係代表安裝程式以 0 結束。截圖先至係佢有開到嘅證據；收據永遠唔會講多過實際觀察到嘅嘢。如果部機養緊一個自架 runner，就會拒絕執行，因為還原會刪咗個 runner。

## 點樣檢查過

佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [喺全新主機測試安裝程式](../building/installer-tests.md)
- [全新主機建置收據](fresh-build-receipts.md)
- [Squirrel 安裝程式，冇簽署](squirrel-installer.md)

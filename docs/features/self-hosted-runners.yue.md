# 私人 repository 用嘅自架 runner

一部實驗機可以幫你其中一個私人 repository 養一個 GitHub Actions runner。

狀態：**已推出**。

## 佢做啲咩

喺客機入面，會下載最新嘅 `actions/runner` release，用 release notes 對一次佢嘅 SHA-256，再登記做一個服務。標籤係 `self-hosted`、`Windows`、`X64`、`material-vm-labs`、`mvl-<project>`，同埋你自己加嘅任何標籤。養緊 runner 嘅機永遠唔會俾 `mvl build` 或者 `mvl up` 還原，所以個 runner 永遠唔會變成孤兒。

## 點樣用

```bat
gh api -X POST repos/owner/name/actions/runners/registration-token --jq .token | mvl runner add proof-1 --repo owner/name
mvl runner rm proof-1 --repo owner/name
```

喺 workflow 用 `runs-on: [self-hosted, windows, material-vm-labs]`。

## 安全

淨係接受私人 repository：`mvl` 會用 `gh` 讀 repository 嘅可見度，其他一律拒絕，包括讀唔到可見度嘅 repository。登記 token 由標準輸入傳入，淨係經 hypervisor 嘅記憶體內客機變數去到客機，用完就清除，永遠唔會寫入檔案或者 log。

## 點樣檢查過

佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [登記自架 runner](../runners/register.md)
- [安全模型](../reference/security.md)
- [一個指令開一部實驗機](lab-machines.md)

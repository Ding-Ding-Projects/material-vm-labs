# 命令列同鍵盤 TUI

`mvl` 會印出簡短嘅文字行或者 JSON 俾 script 同 agent 用，而 `mvl tui` 就係俾人用嘅鍵盤管理介面。

狀態：**已推出**。

## 佢做啲咩

每個指令都喺 Windows 原裝嘅 PowerShell 5.1 上面行得。`--json` 會印出一個精簡嘅 JSON object，錯誤就係 `{"ok":false,"error":"..."}`。Exit code 係 `0` 完成、`1` 有問題（包括建置失敗）同 `2` 用法唔啱。`mvl tui` 用單一個掣就可以行同樣嘅指令。

## 點樣用

```bat
mvl.bat install-cli
mvl ls --json
mvl tui
```

`install-cli` 會喺 `%LOCALAPPDATA%\Microsoft\WindowsApps` 寫一個 `mvl.cmd` shim；佢唔會改 PATH。

## 點樣檢查過

每次建置都會行 PowerShell 測試套件。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [CLI](../reference/cli.md)
- [管理實驗機](../getting-started/manage.md)
- [一個指令開一部實驗機](lab-machines.md)

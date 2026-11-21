# 一個指令開一部實驗機

`mvl up` 一個指令就俾你一部乾淨、已登入嘅 Windows 11、Ubuntu 24.04 或者 Debian 13 機，再行多次就會將部機還原返嗰個乾淨狀態。

狀態：**已推出**。

## 佢做啲咩

`mvl up <name>` 第一次會開部實驗機，之後每次行都會將佢還原返乾淨嘅基線快照（`mvl-baseline`）再開機。開機嘅過程會用官方評估版安裝媒體無人值守咁安裝系統、裝 hypervisor 嘅客機工具、開 Remote Desktop、喺客機入面將準備狀態寫去 `C:\MaterialVmLabs\ready.json`，然後影基線快照。一般要 25 至 50 分鐘。Windows Server 2025 仲係預覽階段：`mvl server-media` 會檢查佢嘅媒體，但係暫時未提供開 Server 機。

## 點樣用

```bat
mvl up proof-1 --project my-repo
```

如果你淨係想開機，`mvl new` 接受同樣嘅選項：`--hv auto|vmware|virtualbox`、`--mem`、`--cpus`、`--disk`、`--net nat|bridged|hostonly`、`--user`、`--password-stdin`、`--random-password` 同 `--require-tpm`。喺 manager 入面就用 **+ Create a new one**（開一部新嘅）。

## 設定

每部機喺 `%LOCALAPPDATA%\MaterialVmLabs\vms\<name>` 底下有自己嘅資料夾（用 `MVL_HOME` 或者 `--home` 可以改根目錄）。除非你揀咗自己嘅，否則客機帳戶預設係 `mvlbuilder`，密碼係 `1234`。

## 出事嘅時候

部機嘅狀態會變成 `failed`，錯誤會存喺 `vm.json`，仲會儲低一張 `failure.png` 截圖。安裝期間每五分鐘亦都會儲一張客機截圖，而 `mvl shot <name>` 可以隨時影一張。`mvl rm <name> --yes` 會刪晒所有嘢。

## 安全

追蹤緊嘅 answer file 範本淨係有佔位符。客機密碼會用 DPAPI blob 儲存，淨係你嘅 Windows 用戶讀得到；而載住編碼咗嘅密碼嘅 seed image，喺影完基線之後就會刪除。除咗部機自己嘅資料夾，你自己部 PC 上面乜都唔會改。

## 點樣檢查過

每次建置，PowerShell 測試套件都會檢查 answer file、佔位符範本同名稱驗證。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [開一部實驗機](../getting-started/create-a-lab-machine.md)
- [管理實驗機](../getting-started/manage.md)
- [揀 Hypervisor：VMware 優先，VirtualBox 後備](hypervisor-choice.md)

# 相依套件下載器

`download-dependencies.bat`（喺 Linux 同 macOS 就係 `download-dependencies.sh`）會攞齊鎖定咗版本嘅相依套件，再逐個對一次 SHA-256。

狀態：**進行中**。

## 佢做啲咩

佢會讀 `dependencies.json`，按你嘅平台由每個相依套件嘅官方來源下載鎖定咗嘅版本，放入一個每個用戶獨立嘅資料夾（`%LOCALAPPDATA%\MaterialVmLabs\deps`，或者 `~/.cache/material-vm-labs/deps`），解壓之前先對 SHA-256，再用一個有鎖、有日誌嘅調換方式啟用佢，同時保留上一份好嘅版本。之後佢會跟 lock 檔安裝 npm 套件。已經有齊嘢嘅情況下再行，佢會重新對一次每個記錄咗嘅檔案 hash，然後跳過下載；有檔案改過就會重新下載。如果日誌中途斷咗或者讀唔到，就會由驗證過嘅副本救返。

## 點樣用

```bat
download-dependencies.bat /s
```

`/s`、`--silent` 或者 `SILENT=1` 永遠唔會問你嘢（其實佢喺任何模式都唔會問）。`build.bat` 同 `build-installer.bat` 第一步就會叫佢。喺 Linux 或者 macOS，行 `./download-dependencies.sh`，再用 `eval "$(./download-dependencies.sh --print-path)"` 將啲工具加入 PATH。

## 出事嘅時候

第一個問題會印出 `problem:`，連埋個相依套件、版本、來源同原因，然後個 script 以非零 exit code 結束。

## 安全

唔使管理員權限、冇秘密資料、冇簽署證書，而且下載返嚟嘅嘢一樣都唔會入 repository。

## 狀態同仲有咩未做

Node.js 喺 Windows、Linux 同 macOS 都已經用 SHA-256 鎖定好。Git 同 .NET 8 SDK 仲未有記錄咗嘅 digest，所以暫時淨係會偵測佢哋，安裝仍然靠現有嘅 Chocolatey 路線。Linux 嗰個 script 試過冷行、暖行、有檔案俾人改過、調換中途斷咗、日誌讀唔到，同埋兩個同時行。Windows 嗰個 script 仲未喺真正嘅 Windows 主機上面行過。

## 建議文章

- [一個指令全新建置兼執行](fresh-build-and-run.md)
- [建置入口](build-entry-points.md)
- [喺全新環境做建置](../building/fresh-build.md)

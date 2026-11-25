# Squirrel 安裝程式，冇簽署

啲 app 用 Squirrel.Windows 安裝：`MaterialVmLabsSetup.exe`、`RELEASES` 同完整套件。

狀態：**已推出**。

## 佢做啲咩

`build-installer.bat` 會喺 `dist\installer` 整出嗰三個 Squirrel.Windows 檔案，每個 release 都會連埋佢哋嘅 SHA-256 附上。

行 `MaterialVmLabsSetup.exe` 會將管理程式裝落 `%LOCALAPPDATA%\MaterialVmLabs`，加開始功能表同桌面捷徑，跟住打開管理程式。Squirrel 會先用 `--squirrel-install` 開個 app（整好捷徑就退出），再用 `--squirrel-firstrun` 開，呢次會正常打開視窗。解除安裝會刪走啲捷徑。

## 安全

乜都冇 code signing。兩個 workflow 都會檢查每個 setup 執行檔都報告 `NotSigned`，release notes 亦都會講明。Windows 可能會顯示發行者不明或者 SmartScreen 警告；請喺 release 頁面核對 SHA-256。

## 點樣檢查過

每次 push，`build` 同 `release` workflow 都會建置同檢查佢。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [自動更新](automatic-updates.md)
- [建置入口](build-entry-points.md)
- [安全模型](../reference/security.md)

# 一個指令全新建置兼執行

喺一部全新嘅 Windows PC 上面行 `.\build.bat --run`，佢會攞齊所有嘢、建置、檢查結果，然後開 manager。

狀態：**進行中**。

## 佢做啲咩

`build.bat` 會叫相依套件下載器、行建置，加咗 `--run`（又或者 `/run`、`RUN_AFTER_BUILD=1`）就會交俾 `scripts/run-after-build.ps1`。嗰個 script 淨係喺以下情況先會開 `dependencies.json` 入面嘅預設目標：source 冇任何未 commit 或者未追蹤嘅改動、個 checkout 就係建置入面嵌咗嘅嗰個 commit、同埋便攜版執行檔同佢嘅 `app.asar` 存在而且唔係空嘅。佢永遠唔會建置、安裝或者提升權限。

## 點樣用

```powershell
.\build.bat --run
```

靜默自動化要兩個旗標一齊用，`/s /run`，咁樣靜默建置就永遠唔會突然開咗個 app。

## 狀態同仲有咩未做

啟動前嘅檢查同共用 manifest 已經整好。`--run` 旗標仲要由 `build.bat` 自己讀到先得。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [相依套件下載器](dependency-fetcher.md)
- [建置入口](build-entry-points.md)
- [喺全新環境做建置](../building/fresh-build.md)

# 自動更新

裝咗嘅 manager 會喺背景檢查有冇新版本，下載同檢查好，等你揀 **Restart to install update**（重新啟動嚟安裝更新）先至安裝。

狀態：**進行中**。

## 佢做啲咩

開咗大約 20 秒之後，之後每 4 個鐘，manager 會讀一次 GitHub 上面最新嘅 release。淨係喺以下情況佢先會接受個 release：個 `RELEASES` 檔格式正確、入面講嘅套件真係有附上而且大細啱，同埋 release notes 有寫出嗰個套件嘅 SHA-256。較新嘅 release 會喺背景下載，有大細上限，暫存之前會對一次佢嘅 SHA-1（嚟自 `RELEASES`）、SHA-256（嚟自 release notes）同大細。之後會彈出一條橫額，寫明版本、連去 release notes、講明呢個更新冇簽署，再俾你揀 **Restart to install update**（重新啟動嚟安裝更新）或者 **Later**（遲啲先）。暫存咗嘅更新喺真正套用之前會再檢查多一次。

## 點樣用

打開 **Tools**（工具）揀 **Updates**（更新），或者撳 `Ctrl+Shift+F` 再執行 **Check for updates**（檢查更新）。**Check for and download updates automatically**（自動檢查同下載更新）呢個掣預設係開咗嘅；關咗佢就變成你叫先至檢查同下載。

## 你會見到乜

| 狀態 | 意思 |
| --- | --- |
| You have the latest version（你用緊最新版本） | 個 release 同你行緊嘅 commit 一樣，或者你嗰個仲新啲 |
| Available、Downloading、Ready（有得更新、下載緊、準備好） | 搵到較新嘅版本、下載緊，或者已經檢查好同暫存咗 |
| Offline（離線） | 連唔到 GitHub；乜都冇改過 |
| Update refused（拒絕更新） | Feed 或者某個 hash 對唔上；乜都冇裝 |
| The download was damaged（下載壞咗） | 大細唔啱或者唔係套件；乜都冇裝 |
| Download cancelled（取消咗下載） | 你取消咗；乜都冇裝 |
| Not applied; this version stays（未套用；保留呢個版本） | 安裝程式套用唔到，所以繼續行緊而家呢個版本 |
| Cannot update itself（自己更新唔到） | 呢個係便攜版或者開發用嘅版本；請改為下載新版本 |

## 未儲存嘅嘢

如果有工作行緊，或者有個畫面話有嘢未儲存，重新啟動之前會用兩步確認先問你。冇你揀過，乜都唔會自己重新啟動。

## 安全

個更新冇 code signing（程式碼簽署），個 app 亦都永遠唔會話有。完整性靠 HTTPS 同公開咗嘅 hash 保證。所有網絡同磁碟嘅工作都喺 app 嘅 main process 入面做；畫面淨係顯示狀態。

## 狀態同仲有咩未做

更新邏輯、佢嘅檢查同條橫額都整好咗，而且有測試覆蓋（`tests/records.test.mjs`）。仲未做嘅有：將佢接駁去 manager 啟動嘅流程，同埋一個每次建置都會蓋上獨一無二套件版本嘅 release，因為如果套件版本同已經裝咗嗰個一樣，Squirrel.Windows 係唔會套用嘅；喺做到之前，個 app 會照直顯示呢個原因，唔會扮冇事。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [即將更新](update-coming-soon.md)
- [Squirrel 安裝程式，冇簽署](squirrel-installer.md)
- [第一個畫面顯示版本同建置時間](version-on-first-screen.md)

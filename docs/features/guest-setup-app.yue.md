# 客機 Setup app

喺 Windows 實驗機入面，Setup app 會一步步帶擁有者搞掂工具、登入、共用資料夾同最後檢查。

狀態：**已推出**。

## 佢做啲咩

一共六個步驟，有 Back（返轉頭）、Skip（跳過），重新啟動之後仲可以由上次嗰度繼續。安裝係喺一個排程工作入面行，永遠唔會喺 app 自己入面行，而且個 app 永遠唔會讀任何密碼或者 token。

## 點樣用

個 app 隨便攜版 zip 一齊附上（`guest-setup\out\MaterialVmLabsSetup.exe`），所以唔使 .NET SDK 都可以設定一部擁有者用嘅機。

## 點樣檢查過

`build.bat` 會將佢建置成一個自給自足嘅執行檔。Material 3 嘅新外觀仲做緊。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [幫你開一部實驗機](../getting-started/set-up-for-you.md)
- [一個指令開一部實驗機](lab-machines.md)
- [建置入口](build-entry-points.md)

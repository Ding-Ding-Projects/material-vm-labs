# 建置入口

`build.bat` 同 `build-installer.bat` 由一份 Windows checkout 一路整到出啲 app 同安裝程式。

狀態：**已推出**。

## 佢做啲咩

`build.bat` 會攞齊鎖定咗版本嘅相依套件、逐個 script 解析一次、行測試、將便攜版打包成 zip 連埋佢嘅 SHA-256，再建置客機用嘅 Setup app 同三個便攜版 app。`build-installer.bat` 建置冇簽署嘅 Squirrel.Windows 安裝程式。兩個都會將真正嘅 exit code 照樣傳返出嚟。

## 點樣用

```bat
build.bat /s
build-installer.bat /s
```

`/s`、`--silent` 或者 `SILENT=1` 會行得一聲唔出，唔會問你嘢。

## 出事嘅時候

每個階段開始嗰陣會印一行 `[..]`，完成嗰陣印 `[ok]`；第一個問題會印出 `problem:` 連埋原因，然後個 script 以非零 exit code 結束。

## 點樣檢查過

`build` workflow 每次 push 都會喺 `windows-latest` 上面行晒兩個。

## 建議文章

- [相依套件下載器](dependency-fetcher.md)
- [一個指令全新建置兼執行](fresh-build-and-run.md)
- [Squirrel 安裝程式，冇簽署](squirrel-installer.md)

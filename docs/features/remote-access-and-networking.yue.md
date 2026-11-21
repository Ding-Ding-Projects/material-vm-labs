# Remote Desktop、SSH、共用資料夾同網絡模式

照你需要嘅方式連去實驗機：已經登入好嘅 Remote Desktop、Linux 用嘅 SSH、共用資料夾，同埋 NAT、bridged 或者 host-only 網絡。

狀態：**已推出**。

## 佢做啲咩

`mvl rdp` 會喺客機開 Remote Desktop，將嗰個地址嘅客機憑證儲入你嘅 Credential Manager，再用已登入嘅狀態打開佢。`mvl ip` 會印出地址，呢個地址喺 `mvl ls` 都會見到。`mvl net <name> bridged` 會俾部機喺你嘅網絡上面有自己嘅地址，如果 3 分鐘之內都攞唔到地址，就會自己退返去 NAT。

## 點樣用

```bat
mvl ip proof-1
mvl rdp proof-1
mvl net proof-1 bridged
```

## 設定

| 模式 | 意思 |
| --- | --- |
| `nat`（預設） | 喺你部 PC 後面嘅私人地址；上得到網 |
| `bridged` | 喺你嘅網絡上面有自己嘅地址 |
| `hostonly` | 淨係呢部 PC 同其他實驗機；上唔到網 |

## 安全

如果用預設密碼 `1234` 加 bridged 網絡，你網絡上面任何人都可以登入嗰部客機，`mvl` 會警告你。`mvl rm` 會刪除儲存咗嘅憑證。

## 點樣檢查過

佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [管理實驗機](../getting-started/manage.md)
- [安全模型](../reference/security.md)
- [命令列同鍵盤 TUI](cli-and-tui.md)

# 揀 Hypervisor：VMware 優先，VirtualBox 後備

每次執行，用得到 VMware Workstation 就揀佢，唔得就退返去 VirtualBox，仲會話俾你知揀咗邊個同點解。

狀態：**已推出**。

## 佢做啲咩

如果 VMware Workstation 裝咗、`vmrun list` 有回應，而且佢嘅 Windows tools 媒體存在，就會揀 VMware Workstation。否則就用 VirtualBox。兩個都用 UEFI 同 Secure Boot 行。VirtualBox 有真正嘅虛擬 TPM 2.0；喺 VMware 上面冇辦法用自動化加虛擬 TPM，所以 `mvl` 會喺嗰部用完即棄嘅客機入面加一個 Setup 要求豁免，並且喺每張收據記低 `tpmMode`。

## 點樣用

```bat
mvl hv
mvl hv install --approve
```

`mvl hv` 會印出揀咗邊個同原因。如果兩個都冇裝，`mvl hv install --approve` 會經 Chocolatey 裝 VirtualBox，而 Windows 嘅 UAC 提示要你自己答。喺 `mvl new` 加 `--hv vmware|virtualbox` 可以指定用邊個，或者加 `--require-tpm` 指定用 VirtualBox。

## 出事嘅時候

喺開咗 Hyper-V 嘅 PC 上面，VirtualBox 會用一個慢啲嘅模式行，喺 Windows Setup 途中可能會卡住；`mvl hv` 會警告你。喺呢類 PC 請用 VMware，或者自己關咗 Hyper-V。

## 安全

冇 `--approve` 就乜都唔會裝，而且 `mvl` 永遠唔會改你嘅登入、UAC 或者電源狀態。

## 點樣檢查過

Hypervisor 參考文件入面關於 VMware 同 VirtualBox 嘅觀察係喺 2026-11-17 見到嘅。佢仲未有喺真正 Windows 主機上面行建置好嘅 release 嘅檢查紀錄；呢樣列咗喺 roadmap 嘅「Not yet verified」（未驗證）入面。

## 建議文章

- [Hypervisor](../reference/hypervisors.md)
- [一個指令開一部實驗機](lab-machines.md)
- [安全模型](../reference/security.md)

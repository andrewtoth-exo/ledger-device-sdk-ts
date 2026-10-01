---
"@ledgerhq/device-signer-kit-hyperliquid": major
---

Replace RxJS and XState dependencies with the observer-util-backed SDK reactivity package. Consumers importing stream operators or building custom state machines must switch to `@ledgerhq/device-sdk-reactivity`; subscription and cancellation APIs are unchanged.

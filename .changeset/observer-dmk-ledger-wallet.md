---
"@ledgerhq/dmk-ledger-wallet": minor
---

Replace RxJS and XState dependencies with the observer-util-backed SDK reactivity package. Consumers importing stream operators or building custom state machines must switch to `@exodus/device-reactivity`; the subscription and cancellation APIs are unchanged.

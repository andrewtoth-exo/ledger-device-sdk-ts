---
"@ledgerhq/device-management-kit-devtools-websocket-server": major
---

Replace RxJS and XState dependencies with the observer-util-backed SDK reactivity package. Consumers importing stream operators or building custom state machines must switch to `@exodus/device-reactivity`; subscription and cancellation APIs are unchanged.

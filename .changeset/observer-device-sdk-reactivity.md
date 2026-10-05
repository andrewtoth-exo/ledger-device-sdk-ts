---
"@ledgerhq/device-sdk-reactivity": minor
---

Add observer-util-backed streams and a sequential state-machine interpreter for the SDK.

Finalize concatenated sources before starting the next source, without recursive synchronous subscriptions. Ignore cancellation-triggered events while stopping actors.

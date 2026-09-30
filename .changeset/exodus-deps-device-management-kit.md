---
"@ledgerhq/device-management-kit": patch
---

Replace direct encoding and cryptographic dependencies with Exodus primitives. Use the host's global WebSocket instead of isomorphic-ws/ws; hosts without WebSocket must supply the API before connecting.

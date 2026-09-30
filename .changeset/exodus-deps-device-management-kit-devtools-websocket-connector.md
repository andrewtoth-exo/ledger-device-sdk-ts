---
"@ledgerhq/device-management-kit-devtools-websocket-connector": patch
---

Use the host's global WebSocket instead of isomorphic-ws. Hosts without WebSocket must supply the API before connecting.

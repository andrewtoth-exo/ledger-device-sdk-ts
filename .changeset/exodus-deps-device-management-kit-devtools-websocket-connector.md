---
"@ledgerhq/device-management-kit-devtools-websocket-connector": patch
---

Use the host's global WebSocket instead of isomorphic-ws. Hosts without WebSocket must supply the API before connecting.

Reconnect on close rather than relying on the ready state during error events. Ignore replaced sockets and cancel pending reconnections when destroyed.

---
"@ledgerhq/context-module": patch
---

Use Exodus SHA-224 and Base58 primitives instead of crypto-js and bs58, and replace runtime ethers ABI decoding with Exodus ethereumjs. The host must provide global Buffer before importing the package.

# Exodus dependency changes

This fork removes Sentry from the SDK transports and the Next.js sample while
preserving local error logging and propagation. Base58 and React Native BLE
Base64 use `@exodus/bytes@1.16.0`. Hashing, HMAC, UUIDs, secure randomness,
secp256k1 operations, and sample AES-CBC use `@exodus/crypto@1.0.0-rc.34`.

## Ethereum and WebSocket follow-up

- Context-module and the Ethereum signer no longer depend on ethers at runtime.
  ABI decoding and EIP-712 struct hashing use `@exodus/ethereumjs@1.12.0`;
  transaction envelopes use `@exodus/ethersproject-rlp@5.4.2-exodus.2` with
  Exodus bytes and crypto. Ethers remains a development-only compatibility
  oracle in these packages, and is still used by sample applications.
- ABI adapters preserve bigint values, named tuple/array fields and deferred
  decode failures. EIP-712 adapters normalize integer aliases and enforce
  schema, numeric, byte, address and fixed-array validation before hashing.
- Transaction parsing preserves types 0–4, signed-to-unsigned normalization,
  access lists, EIP-7702 authorizations and EIP-4844 network wrappers. It does
  not fall back to the older ethers5 transaction parser, which lacks types 3/4.
- The ethereumjs release assumes global `Buffer` already exists. The host must
  provide it before importing these SDK packages. Context-module and the
  Ethereum signer do not install a Buffer fallback, assign the global, or
  directly depend on the `buffer` package.
- DMK secure-channel and the devtools WebSocket connector use the host's
  global `WebSocket`. Their direct `isomorphic-ws` dependency and DMK's direct
  `ws` dependency are removed. Browsers and supported React Native hosts
  provide this API; Node applications must use a runtime with global
  WebSocket or provide it before connecting. There is no implicit fallback.
  Server-side WebSocket packages retain `ws`, and unrelated development and
  Solana dependencies can still resolve WebSocket implementations.

## Compatibility exceptions

- The optional ledger-keyring-protocol package still uses `@noble/curves@2.0.1`
  for P-256, which this version of Exodus crypto does not expose, and for the
  secp256k1 DER-to-compact signature codec. Secp256k1 signing, verification and
  shared-secret multiplication use Exodus crypto.
- Keyring retains `@noble/ciphers@1.2.1` for AES-GCM: its protocol uses 16-byte
  IVs, whereas this version of Exodus crypto requires 12-byte GCM nonces.
  Truncating the nonce to 12 bytes would break protocol compatibility.
- Keyring preserves signing of already-hashed data, including the original
  short-digest padding and long-digest truncation semantics. P-256 explicitly
  disables Noble 2's default prehashing. Signatures remain deterministic.
- Solana web3 and other third-party dependencies still bring their own crypto
  and encoding implementations. These transitive implementations have not
  been rewritten by this change. The ethereumjs ABI implementation also retains
  its Exodus ethersproject utility packages and its RLP/BN/CRC dependencies.

## Reproducible resolution

The workspace pins the Exodus packages and scopes Noble version overrides to
the Exodus dependency subtrees; it does not force incompatible Noble majors
onto third-party dependencies. These overrides do **not** propagate to consumers of
published packages. Consumers must maintain their own compatible resolutions.
The ethereumjs subtree is resolved with `rlp@2.2.6`, and that RLP version and
the Exodus ethersproject bignumber wrapper use `bn.js@4.12.2`. Integer-width
and malformed-input regression vectors cover this resolution explicitly.

All directly declared `@types/*` constraints are relaxed to `*`. The lockfile
still records the versions used for validation; relaxing a range does not
change their review status or relax constraints inside third-party packages.

The crypto release omits `utils/assertHash.d.ts`, which its published hash,
HMAC and PBKDF2 declarations import. A declaration-only pnpm patch restores
the algorithm unions from its runtime implementation. It changes no runtime
code and keeps `skipLibCheck: false`. Apply the patch when building this source
with that crypto release, or use a future release containing the declaration.

## Validation boundaries

Regression tests cover keyring signature vectors for both curves, DER and
compact signatures, shared-secret encodings, empty-key HMAC, 16-byte-IV GCM,
SHA-224 schema hashing, Base58 leading zeros and invalid input, and React Native
BLE Base64 framing. Device interaction still requires real-device smoke tests
on supported mobile and desktop platforms before release. This patch does not
remove EIP-712 support or alter the signer APIs.

The Ethereum follow-up compares ABI values, EIP-712 hashes and transaction
normalization against ethers, including malformed envelopes, authorization
lists and byte-level transaction mutations. WebSocket tests cover native-style
events, connection failures, reconnects and cleanup. Browser-bundle smoke tests
exercise the ABI, typed-data and transaction adapters with a host-provided
global Buffer and verify that the SDK does not replace or reconfigure it.

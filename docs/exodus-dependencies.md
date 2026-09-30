# Exodus dependency changes

This fork removes Sentry from the SDK transports and the Next.js sample while
preserving local error logging and propagation. Base58 and React Native BLE
Base64 use `@exodus/bytes@1.16.0`. Hashing, HMAC, UUIDs, secure randomness,
secp256k1 operations, and sample AES-CBC use `@exodus/crypto@1.0.0-rc.34`.

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
- Third-party dependencies such as ethers and Solana web3 still bring their own
  crypto and encoding implementations. These transitive implementations have
  not been rewritten by this change.

## Reproducible resolution

The workspace pins the Exodus packages and scopes Noble version overrides to
the Exodus dependency subtrees; it does not force incompatible Noble majors
onto ethers or Solana. These overrides do **not** propagate to consumers of
published packages. Consumers must maintain their own compatible resolutions.

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

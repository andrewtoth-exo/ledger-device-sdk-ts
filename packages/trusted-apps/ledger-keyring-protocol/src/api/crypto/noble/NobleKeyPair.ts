import { randomValues } from "@exodus/crypto/randomBytes";
import {
  ecdsaSignHash,
  ecdsaVerifyHash,
  privateKeyIsValid,
  privateKeyToPublicKey,
  publicKeyTweakMultiply,
} from "@exodus/crypto/secp256k1";
import { bufferToHexaString } from "@ledgerhq/device-management-kit";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

import { Curve } from "@api/crypto/CryptoService";
import { type KeyPair, SigFormat } from "@api/crypto/KeyPair";

function normalizeDigest(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const digest = new Uint8Array(32);
  const truncated = data.subarray(0, digest.length);
  digest.set(truncated, digest.length - truncated.length);
  return digest;
}

export class NobleKeyPair implements KeyPair {
  static async generate(curve: Curve): Promise<NobleKeyPair> {
    if (curve !== Curve.K256 && curve !== Curve.P256) {
      throw new Error(`Unsupported curve ${curve}`);
    }
    let privateKey: Uint8Array<ArrayBuffer>;
    do {
      privateKey = randomValues(32);
    } while (
      !(curve === Curve.K256
        ? privateKeyIsValid({ privateKey })
        : p256.utils.isValidSecretKey(privateKey))
    );
    return NobleKeyPair.from(privateKey, curve);
  }

  static from(privateKey: Uint8Array, curve: Curve): NobleKeyPair {
    switch (curve) {
      case Curve.K256:
        return new NobleKeyPair(
          curve,
          privateKey,
          privateKeyToPublicKey({ privateKey: privateKey.slice() }),
        );
      case Curve.P256:
        return new NobleKeyPair(
          curve,
          privateKey,
          p256.getPublicKey(privateKey),
        );
      default:
        throw new Error(`Unsupported curve ${curve}`);
    }
  }

  private constructor(
    private curve: Curve,
    private privateKey: Uint8Array,
    private publicKey: Uint8Array,
  ) {}

  get id() {
    return bufferToHexaString(this.privateKey);
  }

  async sign(data: Uint8Array, format?: SigFormat): Promise<Uint8Array> {
    if (this.curve === Curve.K256) {
      return ecdsaSignHash({
        hash: normalizeDigest(data),
        privateKey: this.privateKey.slice(),
        der: format === SigFormat.DER,
        extraEntropy: null,
      });
    }
    return p256.sign(data, this.privateKey, {
      prehash: false,
      format: format === SigFormat.DER ? "der" : "compact",
    });
  }

  async verify(
    data: Uint8Array,
    signature: Uint8Array,
    format?: SigFormat,
  ): Promise<boolean> {
    if (this.curve === Curve.K256) {
      try {
        return await ecdsaVerifyHash({
          hash: normalizeDigest(data),
          signature:
            format === SigFormat.DER
              ? secp256k1.Signature.fromBytes(signature, "der")
                  .toBytes("compact")
                  .slice()
              : signature.slice(),
          publicKey: this.publicKey.slice(),
        });
      } catch {
        return false;
      }
    }
    return p256.verify(signature, data, this.publicKey, {
      prehash: false,
      format: format === SigFormat.DER ? "der" : "compact",
    });
  }

  async deriveSharedSecret(
    peerPublicKey: Uint8Array,
    isCompressed: boolean = true,
  ): Promise<Uint8Array> {
    if (this.curve === Curve.K256) {
      return publicKeyTweakMultiply({
        publicKey: peerPublicKey.slice(),
        tweak: this.privateKey.slice(),
        compressed: isCompressed,
      });
    }
    return p256.getSharedSecret(this.privateKey, peerPublicKey, isCompressed);
  }

  getPublicKey(): Uint8Array {
    return this.publicKey;
  }

  getPublicKeyToHex(): string {
    return bufferToHexaString(this.publicKey, false);
  }
}

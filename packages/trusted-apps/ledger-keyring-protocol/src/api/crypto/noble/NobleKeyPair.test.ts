import { Curve } from "@api/crypto/CryptoService";
import { SigFormat } from "@api/crypto/KeyPair";

import { NobleKeyPair } from "./NobleKeyPair";

describe("NobleKeyPair", () => {
  const testData = new TextEncoder().encode("Test Data");

  it.each([
    [
      Curve.K256,
      "6373753029f33bfd2b17aa6abce86a82e9c86414b53ea7bea61e519f0455e280178694a5fbbb8af79b32796377161bb88f68b82eb2da9b73d22bbe487ad87492",
    ],
    [
      Curve.P256,
      "2de7dccf336ae9f7347cde7fb139d9c31603c54297e761e891f073879be066c6622148c0eab68ac11e136d61048682b18957dddf2dcfcd2d9ecd7eeddf36785b",
    ],
  ])("preserves the un-prehashed %s signature", async (curve, expected) => {
    const keyPair = NobleKeyPair.from(new Uint8Array(32).fill(1), curve);
    expect(toHex(await keyPair.sign(testData))).toBe(expected);
    expect(await keyPair.verify(testData, fromHex(expected))).toBe(true);
    const der = await keyPair.sign(testData, SigFormat.DER);
    expect(await keyPair.verify(testData, der, SigFormat.DER)).toBe(true);
    expect(await keyPair.verify(new Uint8Array([1]), der, SigFormat.DER)).toBe(
      false,
    );
    expect(
      await keyPair.verify(testData, new Uint8Array(), SigFormat.DER),
    ).toBe(false);
  });

  it.each([32, 33, 64])(
    "preserves digest truncation for %i bytes",
    async (length) => {
      const keyPair = NobleKeyPair.from(new Uint8Array(32).fill(1), Curve.K256);
      expect(toHex(await keyPair.sign(new Uint8Array(length).fill(7)))).toBe(
        "001af75f8a0ececcc4af0ccdbcccc1a81656eca444e3484151212ad1823ae1227cc07485ba5a779f1f12089090e4b013322db0dae4e8151592c0b1ee0fd0f74d",
      );
    },
  );

  it("preserves an empty digest", async () => {
    const keyPair = NobleKeyPair.from(new Uint8Array(32).fill(1), Curve.K256);
    expect(toHex(await keyPair.sign(new Uint8Array()))).toBe(
      "6734cb4e3c071082482bf0f8579484f28dcdb1ca15b0cce72fbf130b2673d00c5fbeecc4075cfd6a52634210486f24ce6db20f2870e606acc43ade814d48394a",
    );
  });

  it.each([Curve.K256, Curve.P256])(
    "preserves both shared-secret encodings for %s",
    async (curve) => {
      const alice = NobleKeyPair.from(new Uint8Array(32).fill(1), curve);
      const bob = NobleKeyPair.from(new Uint8Array(32).fill(2), curve);
      for (const compressed of [true, false]) {
        const secret = await alice.deriveSharedSecret(
          bob.getPublicKey(),
          compressed,
        );
        expect(secret.length).toBe(compressed ? 33 : 65);
        expect(secret).toEqual(
          await bob.deriveSharedSecret(alice.getPublicKey(), compressed),
        );
      }
    },
  );

  it("should generate a key pair with correct public key", async () => {
    const keyPair = await NobleKeyPair.generate(Curve.K256);
    const publicKey = keyPair.getPublicKey();
    expect(publicKey).toBeDefined();
    expect(publicKey.byteLength).toBeGreaterThan(0);
  });

  it("should create a key pair from a private key", () => {
    const privateKey = new Uint8Array(32).fill(1);
    const keyPair = NobleKeyPair.from(privateKey, Curve.K256);
    expect(keyPair.getPublicKey()).toBeDefined();
  });

  it("should sign and verify data correctly", async () => {
    const keyPair = await NobleKeyPair.generate(Curve.K256);
    const signature = await keyPair.sign(testData);
    const isVerified = await keyPair.verify(testData, signature);
    expect(isVerified).toBeTruthy();
  });

  it("should sign and verify data correctly, in DER format", async () => {
    const keyPair = await NobleKeyPair.generate(Curve.K256);
    const signature = await keyPair.sign(testData, SigFormat.DER);
    const isVerified = await keyPair.verify(testData, signature, SigFormat.DER);
    expect(isVerified).toBeTruthy();
  });

  it("should derive a shared secret with another public key", async () => {
    const keyPair = await NobleKeyPair.generate(Curve.K256);
    const otherKeyPair = await NobleKeyPair.generate(Curve.K256);
    const sharedSecret1 = await keyPair.deriveSharedSecret(
      otherKeyPair.getPublicKey(),
    );
    const sharedSecret2 = await otherKeyPair.deriveSharedSecret(
      keyPair.getPublicKey(),
    );

    expect(sharedSecret1).toBeDefined();
    expect(sharedSecret1.byteLength).toBeGreaterThan(0);
    expect(sharedSecret1).toStrictEqual(sharedSecret2);
  });

  it("should convert public key to hex string", async () => {
    const keyPair = await NobleKeyPair.generate(Curve.K256);
    const hexPublicKey = keyPair.getPublicKeyToHex();
    expect(typeof hexPublicKey).toBe("string");
    expect(hexPublicKey.length).toBeGreaterThan(0);
  });
});
import { fromHex, toHex } from "@exodus/bytes/hex.js";

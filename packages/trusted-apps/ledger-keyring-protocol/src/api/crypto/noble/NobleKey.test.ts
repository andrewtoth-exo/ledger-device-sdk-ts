import { fromHex } from "@exodus/bytes/hex.js";

import { AES256_BLOCK_SIZE, AES256_KEY_SIZE } from "@api/crypto/Key";

import { NobleKey } from "./NobleKey";

describe("NobleKey", () => {
  const testData = new TextEncoder().encode("Test Data");

  it("preserves the protocol's 16-byte GCM IV and authentication tag", async () => {
    const key = NobleKey.from(new Uint8Array(32).fill(1));
    const iv = new Uint8Array(16).fill(2);
    const expected = fromHex(
      "2453e43eff854e60bf0e911f4968152afcf103364949328755",
    );
    expect(await key.encrypt(iv, testData)).toEqual(expected);
    expect(await key.decrypt(iv, expected)).toEqual(testData);
    expected[0] = expected[0]! ^ 1;
    await expect(key.decrypt(iv, expected)).rejects.toThrow();
  });

  it("should encrypt and decrypt data correctly", async () => {
    const key = await NobleKey.generate();
    const iv = new Uint8Array(AES256_BLOCK_SIZE).fill(0x02);
    const encryptedData = await key.encrypt(iv, testData);
    const decryptedData = await key.decrypt(iv, encryptedData);

    expect(encryptedData).not.toEqual(testData);
    expect(decryptedData).toEqual(testData);
  });

  it("should encrypt and decrypt data from key material", async () => {
    const keyMaterial = new Uint8Array(AES256_KEY_SIZE).fill(0x01);
    const key = NobleKey.from(keyMaterial);
    const iv = new Uint8Array(AES256_BLOCK_SIZE).fill(0x02);
    const encryptedData = await key.encrypt(iv, testData);
    const decryptedData = await key.decrypt(iv, encryptedData);

    expect(encryptedData).not.toEqual(testData);
    expect(decryptedData).toEqual(testData);
  });
});

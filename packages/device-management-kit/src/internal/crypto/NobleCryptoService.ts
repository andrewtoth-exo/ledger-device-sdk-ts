import { hashSync } from "@exodus/crypto/hash";

import { type CryptoService } from "./CryptoService";

/**
 * Noble implementation of the crypto service
 */
export class NobleCryptoService implements CryptoService {
  sha3_256(data: Uint8Array): Uint8Array {
    return hashSync("sha3-256", data.slice(), "uint8");
  }
}

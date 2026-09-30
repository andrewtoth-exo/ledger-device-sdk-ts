import { hashSync } from "@exodus/crypto/hash";

import { type HasherService } from "./HasherService";

export class Sha256HasherService implements HasherService {
  hash(buffer: Uint8Array): Uint8Array {
    return hashSync("sha256", buffer.slice(), "uint8");
  }
}

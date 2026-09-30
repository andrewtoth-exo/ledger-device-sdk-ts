import { fromBase58, toBase58 } from "@exodus/bytes/base58.js";

export interface Bs58Encoder {
  encode(data: Uint8Array): string;
  decode(encoded: string): Uint8Array;
}

export class DefaultBs58Encoder {
  static encode(data: Uint8Array): string {
    return toBase58(data);
  }
  static decode(encoded: string): Uint8Array {
    return fromBase58(encoded);
  }
}

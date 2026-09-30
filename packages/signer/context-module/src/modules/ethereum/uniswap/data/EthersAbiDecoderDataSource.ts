import { injectable } from "inversify";

import { decodeAbiParameters } from "@/shared/utils/abi";

import { type AbiDecoderDataSource } from "./AbiDecoderDataSource";

@injectable()
export class EthersAbiDecoderDataSource implements AbiDecoderDataSource {
  decode(types: string[], data: string): unknown[] {
    try {
      return decodeAbiParameters(types, data);
    } catch (_) {
      return [];
    }
  }
}

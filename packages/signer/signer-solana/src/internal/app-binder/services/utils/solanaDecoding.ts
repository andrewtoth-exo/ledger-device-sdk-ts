import {
  type Message,
  type MessageV0,
  VersionedMessage,
} from "@exodus/solana-web3.js";
import { getCompiledTransactionMessageDecoder } from "@solana/transaction-messages";

const messageDecoder = getCompiledTransactionMessageDecoder();

export function deserializeSolanaMessage(
  bytes: Uint8Array,
): Message | MessageV0 {
  messageDecoder.decode(bytes);
  const message = VersionedMessage.deserialize(bytes);
  if (!message.serialize().every((byte, index) => byte === bytes[index])) {
    throw new Error("Malformed Solana message");
  }
  return message;
}

export function getTransactionMessageOffset(bytes: Uint8Array): number {
  let signatureCount = 0;
  for (let index = 0; index < 3; index++) {
    const byte = bytes[index];
    if (byte === undefined) break;
    signatureCount |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) !== 0) continue;
    if (signatureCount > 0xffff) break;

    const offset = index + 1 + signatureCount * 64;
    const message = deserializeSolanaMessage(bytes.subarray(offset));
    if (message.header.numRequiredSignatures !== signatureCount) {
      throw new Error("Signature count does not match message header");
    }
    return offset;
  }
  throw new Error("Invalid compact-u16 signature count");
}

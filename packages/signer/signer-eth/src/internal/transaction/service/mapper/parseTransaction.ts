import "@internal/shared/utils/ethereumBuffer";

import { fromHex } from "@exodus/bytes/hex.js";
import { hashSync } from "@exodus/crypto/hash";
import { getAddress } from "@exodus/ethereumjs/ethers5-address";
import { decode, encode } from "@exodus/ethersproject-rlp";

type RlpValue = string | RlpValue[];

function list(value: RlpValue | undefined): RlpValue[] {
  if (!Array.isArray(value)) throw new Error("Expected RLP list");
  return value;
}

function hex(value: RlpValue | undefined, size?: number): string {
  if (
    typeof value !== "string" ||
    (size !== undefined && value.length !== 2 + 2 * size)
  ) {
    throw new Error("Invalid RLP bytes");
  }
  return value;
}

function uint(value: RlpValue | undefined, max = (1n << 256n) - 1n): bigint {
  const encoded = hex(value);
  const result = encoded === "0x" ? 0n : BigInt(encoded);
  if (result > max) throw new Error("Integer overflow");
  return result;
}

function numberHex(value: bigint): string {
  if (value === 0n) return "0x";
  const result = value.toString(16);
  return `0x${result.length % 2 ? "0" : ""}${result}`;
}

function signature(fields: RlpValue[]): void {
  if (fields.length !== 3 || uint(fields[0]) > 1n)
    throw new Error("Invalid signature parity");
  for (const scalar of fields.slice(1)) {
    if (hex(scalar).length > 66) throw new Error("Invalid signature scalar");
    uint(scalar);
  }
  if (uint(fields[2]) >= 1n << 255n) throw new Error("Non-canonical signature");
}

function accessList(value: RlpValue | undefined): RlpValue[] {
  return list(value).map((entry) => {
    const fields = list(entry);
    if (fields.length !== 2) throw new Error("Invalid access list");
    return [
      getAddress(hex(fields[0], 20)),
      list(fields[1]).map((key) => hex(key, 32)),
    ];
  });
}

function authorizations(value: RlpValue | undefined): RlpValue[] {
  return list(value).map((entry) => {
    const fields = list(entry);
    if (fields.length !== 6) throw new Error("Invalid authorization");
    signature(fields.slice(3));
    return [
      numberHex(uint(fields[0])),
      getAddress(hex(fields[1], 20)),
      numberHex(uint(fields[2])),
      numberHex(uint(fields[3])),
      `0x${hex(fields[4]).slice(2).padStart(64, "0")}`,
      `0x${hex(fields[5]).slice(2).padStart(64, "0")}`,
    ];
  });
}

export function parseTransaction(serialized: string) {
  const prefix = Number.parseInt(serialized.slice(2, 4), 16);
  const type = prefix >= 0xc0 ? 0 : prefix;
  if (![0, 1, 2, 3, 4].includes(type) || prefix === 0)
    throw new Error("Unsupported transaction type");
  let fields = list(
    decode(type === 0 ? serialized : `0x${serialized.slice(4)}`) as RlpValue,
  );
  let commitments: RlpValue[] | undefined;
  if (type === 3 && fields.length === 4 && Array.isArray(fields[0])) {
    const blobs = list(fields[1]);
    commitments = list(fields[2]);
    const proofs = list(fields[3]);
    if (blobs.length !== commitments.length || blobs.length !== proofs.length)
      throw new Error("Invalid blob sidecars");
    [...blobs, ...commitments, ...proofs].forEach((value) => hex(value));
    fields = list(fields[0]);
  }
  const unsignedLength = [6, 8, 9, 11, 10][type]!;
  if (fields.length !== unsignedLength && fields.length !== unsignedLength + 3)
    throw new Error("Invalid transaction field count");
  const unsigned = fields.slice(0, unsignedLength);
  const nonceIndex = type === 0 ? 0 : 1;
  const toIndex = type === 0 ? 3 : type === 1 ? 4 : 5;
  const valueIndex = toIndex + 1;
  const data = hex(fields[toIndex + 2]);
  const recipient = hex(fields[toIndex]);
  const to = recipient === "0x" ? undefined : getAddress(recipient);
  if (type === 3 && !to)
    throw new Error("Missing blob transaction destination");
  const value = uint(fields[valueIndex]);
  for (const index of [...Array(toIndex).keys(), valueIndex]) {
    unsigned[index] = numberHex(
      uint(
        fields[index],
        index === nonceIndex ? BigInt(Number.MAX_SAFE_INTEGER) : undefined,
      ),
    );
  }
  unsigned[toIndex] = to ?? "0x";
  let chainId = type === 0 ? 0n : uint(fields[0]);
  if (type === 0 && fields.length === 9) {
    const networkV = uint(fields[6]);
    const scalarR = uint(fields[7]);
    const scalarS = uint(fields[8]);
    if (scalarR === 0n && scalarS === 0n) {
      chainId = networkV;
    } else {
      chainId = networkV >= 35n ? (networkV - 35n) / 2n : 0n;
      if (chainId === 0n && networkV !== 27n && networkV !== 28n)
        throw new Error("Invalid legacy signature");
      signature([
        numberHex(networkV >= 35n ? (networkV - 35n) % 2n : networkV - 27n),
        hex(fields[7]),
        hex(fields[8]),
      ]);
    }
  } else if (type !== 0 && fields.length !== unsignedLength) {
    signature(fields.slice(unsignedLength));
  }
  if (type === 0 && chainId !== 0n)
    unsigned.push(numberHex(chainId), "0x", "0x");
  if (type !== 0) unsigned[toIndex + 3] = accessList(fields[toIndex + 3]);
  if (type >= 2 && uint(fields[2]) > uint(fields[3]))
    throw new Error("Priority fee exceeds maximum fee");
  if (type === 3) {
    unsigned[9] = numberHex(uint(fields[9]));
    unsigned[10] = list(fields[10]).map((blobHash) => hex(blobHash, 32));
    if (commitments)
      unsigned[10] = commitments.map(
        (commitment) =>
          `0x01${hashSync("sha256", fromHex(hex(commitment).slice(2)), "hex").slice(2)}`,
      );
  }
  if (type === 4) unsigned[9] = authorizations(fields[9]);
  const encoded = encode(unsigned);
  return {
    chainId,
    to,
    value,
    data,
    type,
    unsignedSerialized: type === 0 ? encoded : `0x0${type}${encoded.slice(2)}`,
  };
}

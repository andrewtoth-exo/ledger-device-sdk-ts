import { fromHex, toHex } from "@exodus/bytes/hex.js";
import {
  SignTypedDataVersion,
  TypedDataUtils,
} from "@exodus/ethereumjs/eth-sig-util";
import { getAddress } from "@exodus/ethereumjs/ethers5-address";

import type { TypedDataDomain, TypedDataField } from "@api/model/TypedData";

type Types = Record<string, TypedDataField[]>;

function primitive(type: string): boolean {
  if (["address", "bool", "bytes", "string"].includes(type)) return true;
  const integer = /^(u?int)([1-9]\d*)$/.exec(type);
  if (integer) return Number(integer[2]) <= 256 && Number(integer[2]) % 8 === 0;
  const bytes = /^bytes([1-9]\d*)$/.exec(type);
  return bytes !== null && Number(bytes[1]) <= 32;
}

function normalizeTypes(input: Types): Types {
  const types: Types = Object.create(null) as Types;
  for (const [name, fields] of Object.entries(input)) {
    types[name] = fields.map((field) => {
      const base = field.type.split("[")[0]!;
      return {
        ...field,
        type:
          ["uint", "int"].includes(base) && !Object.hasOwn(input, base)
            ? field.type.replace(base, `${base}256`)
            : field.type,
      };
    });
  }
  const parents = new Set<string>();
  const links = new Map<string, string[]>();
  for (const [name, fields] of Object.entries(types)) {
    const names = new Set<string>();
    const children: string[] = [];
    for (const field of fields) {
      if (names.has(field.name)) throw new Error("Duplicate typed data field");
      names.add(field.name);
      const match = /^([^\x5b\x5d]+)(?:\[\d*\])*$/.exec(field.type);
      if (!match) throw new Error("Invalid typed data type");
      const base = match[1]!;
      if (base === name) throw new Error("Circular typed data type");
      if (primitive(base)) continue;
      if (!Object.hasOwn(types, base))
        throw new Error("Unknown typed data type");
      parents.add(base);
      children.push(base);
    }
    links.set(name, children);
  }
  if (Object.keys(types).filter((name) => !parents.has(name)).length !== 1)
    throw new Error("Ambiguous typed data root");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (visiting.has(name)) throw new Error("Circular typed data type");
    if (visited.has(name)) return;
    visiting.add(name);
    for (const child of links.get(name) ?? []) visit(child);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of links.keys()) visit(name);
  return types;
}

function normalizeValue(type: string, value: unknown, types: Types): unknown {
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    if (
      !Array.isArray(value) ||
      (array[2] !== "" && value.length !== Number(array[2]))
    )
      throw new Error("Invalid typed data array");
    return value.map((entry) => normalizeValue(array[1]!, entry, types));
  }
  if (Object.hasOwn(types, type) && !primitive(type)) {
    if (!value || typeof value !== "object")
      throw new Error("Missing typed data struct");
    return Object.fromEntries(
      types[type]!.map((field) => [
        field.name,
        normalizeValue(
          field.type,
          (value as Record<string, unknown>)[field.name],
          types,
        ),
      ]),
    );
  }
  if (type === "address") {
    if (typeof value !== "string")
      throw new Error("Invalid typed data address");
    return getAddress(value).toLowerCase();
  }
  if (type === "bool") return Boolean(value);
  if (type === "string") {
    if (typeof value !== "string") throw new Error("Invalid typed data string");
    return value;
  }
  if (type.startsWith("bytes")) {
    const bytes =
      value instanceof Uint8Array
        ? value
        : typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value)
          ? fromHex(value.slice(2))
          : undefined;
    if (!bytes || (type !== "bytes" && bytes.length !== Number(type.slice(5))))
      throw new Error("Invalid typed data bytes");
    return `0x${toHex(bytes)}`;
  }
  const integer = /^(u?int)(\d+)$/.exec(type);
  if (integer) {
    if (
      !["string", "number", "bigint"].includes(typeof value) ||
      value === "" ||
      (typeof value === "number" && !Number.isSafeInteger(value))
    )
      throw new Error("Invalid typed data integer");
    const number =
      typeof value === "string" && value.startsWith("-") && value[1] !== "-"
        ? -BigInt(value.slice(1))
        : BigInt(value as string | number | bigint);
    const signed = integer[1] === "int";
    const limit = 1n << BigInt(Number(integer[2]) - (signed ? 1 : 0));
    if (number < (signed ? -limit : 0n) || number >= limit)
      throw new Error("Typed data integer out of bounds");
    return number.toString();
  }
  throw new Error("Unknown typed data type");
}

export function hashTypedDataStruct(
  primaryType: string,
  input: Types,
  message: Record<string, unknown>,
): string {
  const types = normalizeTypes(input);
  if (!Object.hasOwn(types, primaryType))
    throw new Error("Unknown primary type");
  const normalized = normalizeValue(primaryType, message, types) as Record<
    string,
    unknown
  >;
  return `0x${toHex(TypedDataUtils.hashStruct(primaryType, normalized, { EIP712Domain: [], ...types }, SignTypedDataVersion.V4))}`;
}

export function hashTypedDataDomain(domain: TypedDataDomain): string {
  const fields = {
    name: "string",
    version: "string",
    chainId: "uint256",
    verifyingContract: "address",
    salt: "bytes32",
  };
  for (const [name, value] of Object.entries(domain)) {
    if (value != null && !Object.hasOwn(fields, name))
      throw new Error("Invalid typed data domain key");
  }
  const definition = Object.entries(fields)
    .filter(([name]) => domain[name as keyof TypedDataDomain] != null)
    .map(([name, type]) => ({ name, type }));
  return hashTypedDataStruct(
    "EIP712Domain",
    { EIP712Domain: definition },
    { ...domain },
  );
}

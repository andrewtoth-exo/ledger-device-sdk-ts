import { TypedDataEncoder } from "ethers";

import type { TypedDataDomain, TypedDataField } from "@api/model/TypedData";

import { hashTypedDataDomain, hashTypedDataStruct } from "./typedData";

describe("Exodus typed data adapter", () => {
  it.each([
    {},
    { name: "Test", version: "1", chainId: 1 },
    {
      salt: `0x${"12".repeat(32)}`,
      verifyingContract: "0x000000000000000000000000000000000000dead",
      chainId: 137,
    },
    { name: null, version: null, chainId: null },
  ])("matches domain hash %j", (domain) => {
    expect(hashTypedDataDomain(domain as TypedDataDomain)).toBe(
      TypedDataEncoder.hashDomain(domain),
    );
  });

  const cases: [string, unknown][] = [
    ["uint", "123"],
    ["int", "-456"],
    ["int", "-0x01"],
    ["uint8", 255],
    ["int8", -128],
    ["uint256", (1n << 256n) - 1n],
    ["int256", -(1n << 255n)],
    [
      "uint[2][]",
      [
        [0, 1],
        [2, 3],
      ],
    ],
    ["bytes", "0xabcdef"],
    ["bytes4", "0x00010203"],
    ["bytes", new Uint8Array([1, 2, 3])],
    ["string", "0x1234 😃"],
    ["address", "0x000000000000000000000000000000000000dead"],
    ["bool", false],
    ["bool", 1],
  ];
  it.each(cases)("matches %s", (type, value) => {
    const types = { Message: [{ name: "value", type }] };
    expect(hashTypedDataStruct("Message", types, { value })).toBe(
      TypedDataEncoder.hashStruct("Message", types, { value }),
    );
  });

  it("matches nested structs and fixed arrays", () => {
    const types = {
      Message: [{ name: "people", type: "Person[2]" }],
      Person: [
        { name: "name", type: "string" },
        { name: "balances", type: "uint[]" },
      ],
    };
    const message = {
      people: [
        { name: "Alice", balances: [1, 2] },
        { name: "Bob", balances: [] },
      ],
    };
    expect(hashTypedDataStruct("Message", types, message)).toBe(
      TypedDataEncoder.hashStruct("Message", types, message),
    );
  });

  it.each([
    ["uint8", 256],
    ["int8", -129],
    ["uint", -1],
    ["uint", Number.MAX_SAFE_INTEGER + 1],
    ["uint8[2]", [1]],
    ["bytes", "hello"],
    ["bytes4", "0x1234"],
    ["string", 1],
    ["address", "0x1234"],
    ["uint7", 1],
    ["bytes33", "0x"],
    ["uint", ""],
  ])("rejects invalid %s", (type, value) => {
    const types = { Message: [{ name: "value", type: type as string }] };
    expect(() =>
      TypedDataEncoder.hashStruct("Message", types, { value }),
    ).toThrow();
    expect(() => hashTypedDataStruct("Message", types, { value })).toThrow();
  });

  it.each<Record<string, TypedDataField[]>>([
    { Message: [{ name: "value", type: "Unknown" }] },
    { Message: [{ name: "value", type: "Message" }] },
    {
      Message: [
        { name: "value", type: "uint8" },
        { name: "value", type: "uint8" },
      ],
    },
    { Message: [], Unused: [] },
    {
      Message: [{ name: "value", type: "Child" }],
      Child: [{ name: "value", type: "Message" }],
    },
  ])("rejects invalid type graphs", (input) => {
    const types = input;
    expect(() => TypedDataEncoder.hashStruct("Message", types, {})).toThrow();
    expect(() => hashTypedDataStruct("Message", types, {})).toThrow();
  });

  it("rejects null structs rather than hashing a zero value", () => {
    const types = { Message: [{ name: "child", type: "Child" }], Child: [] };
    expect(() =>
      hashTypedDataStruct("Message", types, { child: null }),
    ).toThrow();
    expect(() =>
      hashTypedDataDomain({ unknown: true } as TypedDataDomain),
    ).toThrow();
  });
});

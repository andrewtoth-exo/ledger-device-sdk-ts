import { AbiCoder, Interface } from "ethers";

import { decodeAbiParameters, decodeFunctionData } from "./abi";

describe("Exodus ABI adapter", () => {
  const oracle = AbiCoder.defaultAbiCoder();
  const valuesOnly = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(valuesOnly) : value;

  it.each([
    ["uint8", 255],
    ["int8", -128],
    ["uint48", 2 ** 47],
    ["uint256", 1n << 255n],
    ["int256", -(1n << 255n)],
    ["bool", true],
    ["bytes", "0xabcdef"],
    ["string", "hello"],
    ["address", "0x000000000000000000000000000000000000dead"],
    [
      "uint8[2][]",
      [
        [1, 2],
        [3, 4],
      ],
    ],
    [
      "tuple(uint8 count, tuple(bytes data, int256 amount)[] children)",
      [3, [["0xab", -1n]]],
    ],
  ])("matches ethers decoding %s", (type, value) => {
    const encoded = oracle.encode([type as string], [value]);
    const actual = decodeAbiParameters([type], encoded);
    const expected = oracle.decode([type as string], encoded).toArray(true);
    expect(valuesOnly(actual)).toEqual(expected);
  });

  const abi = [
    {
      type: "function",
      name: "swap",
      inputs: [
        { name: "amount", type: "uint" },
        {
          name: "items",
          type: "tuple[]",
          components: [{ name: "value", type: "uint8" }],
        },
      ],
    },
  ];
  const iface = new Interface(abi);
  const calldata = iface.encodeFunctionData("swap", [123n, [[7]]]);

  it.each([
    undefined,
    "swap",
    "swap(uint,(uint8)[])",
    "swap(uint256,(uint8)[])",
    calldata.slice(0, 10),
  ])("decodes by method %s", (method) => {
    const result = decodeFunctionData(abi, calldata, method);
    expect(result["amount"]).toBe(123n);
    expect(
      (result["items"] as Array<Record<string, unknown>>)[0]!["value"],
    ).toBe(7n);
  });

  it("deduplicates identical fragments but rejects ambiguous names and incorrect selectors", () => {
    expect(
      decodeFunctionData([...abi, ...abi], calldata, "swap")["amount"],
    ).toBe(123n);
    const overloaded = [...abi, { type: "function", name: "swap", inputs: [] }];
    expect(() => decodeFunctionData(overloaded, calldata, "swap")).toThrow();
    expect(() => decodeFunctionData(abi, calldata, "other")).toThrow();
    expect(() =>
      decodeFunctionData(abi, `0x00000000${calldata.slice(10)}`),
    ).toThrow();
  });

  it("keeps invalid unrelated values lazy", () => {
    const encoded = oracle.encode(["uint256", "bytes"], [42, "0xff"]);
    const result = decodeAbiParameters(["uint256", "string"], encoded);
    expect(result[0]).toBe(42n);
    expect(() => result[1]).toThrow();
  });

  it("matches every integer width and malformed high-bit normalization", () => {
    for (let width = 8; width <= 256; width += 8) {
      for (const type of [`uint${width}`, `int${width}`]) {
        for (const word of ["00", "01", "55", "80", "ff"]) {
          const encoded = `0x${word.repeat(32)}`;
          expect(decodeAbiParameters([type], encoded)[0]).toBe(
            oracle.decode([type], encoded)[0],
          );
        }
      }
    }
  });
});

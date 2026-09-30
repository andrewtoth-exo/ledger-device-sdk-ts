import { DefaultBs58Encoder } from "./bs58Encoder";

describe("DefaultBs58Encoder", () => {
  it.each([
    [[], ""],
    [[0], "1"],
    [[0, 0, 1], "112"],
    [[255], "5Q"],
  ])("round-trips %j with leading zeros", (bytes, encoded) => {
    const data = new Uint8Array(bytes);
    expect(DefaultBs58Encoder.encode(data)).toBe(encoded);
    expect(DefaultBs58Encoder.decode(encoded)).toEqual(data);
  });

  it.each(["0", "O", "I", "l", " 1", "1 "])(
    "rejects invalid input %s",
    (encoded) => {
      expect(() => DefaultBs58Encoder.decode(encoded)).toThrow();
    },
  );
});

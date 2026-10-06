import {
  AddressLookupTableAccount,
  PublicKey,
  type VersionedMessage,
} from "@exodus/solana-web3.js";
import { describe, expect, it } from "vitest";

import { RpcAddressLookupTableResolver } from "./AddressLookupTableResolver";

describe("RpcAddressLookupTableResolver", () => {
  const rpc = { getAddressLookupTable: vi.fn() };

  beforeEach(() => vi.resetAllMocks());

  it("returns undefined when the message has no address table lookups", async () => {
    const resolver = new RpcAddressLookupTableResolver(rpc);

    const fakeMsg = {
      addressTableLookups: [],
    } as unknown as VersionedMessage;

    const result = await resolver.resolve(fakeMsg);
    expect(result).toBeUndefined();
    expect(rpc.getAddressLookupTable).not.toHaveBeenCalled();
  });

  it("returns undefined when addressTableLookups is absent", async () => {
    const resolver = new RpcAddressLookupTableResolver(rpc);

    const fakeMsg = {} as unknown as VersionedMessage;

    const result = await resolver.resolve(fakeMsg);
    expect(result).toBeUndefined();
    expect(rpc.getAddressLookupTable).not.toHaveBeenCalled();
  });

  it("keeps writable and readonly addresses in lookup order", async () => {
    const keys = [1, 2, 3, 4].map(
      (value) => new PublicKey(new Uint8Array(32).fill(value)),
    );
    const [firstKey, secondKey] = keys;
    const table = (key: PublicKey) =>
      new AddressLookupTableAccount({
        key,
        state: {
          deactivationSlot: 0xffffffffffffffffn,
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: keys,
        },
      });
    rpc.getAddressLookupTable
      .mockResolvedValueOnce(table(firstKey!))
      .mockResolvedValueOnce(table(secondKey!));
    const message = {
      addressTableLookups: [
        { accountKey: firstKey, writableIndexes: [2, 0], readonlyIndexes: [1] },
        {
          accountKey: secondKey,
          writableIndexes: [3],
          readonlyIndexes: [2, 0],
        },
      ],
    } as unknown as VersionedMessage;

    await expect(
      new RpcAddressLookupTableResolver(rpc).resolve(message),
    ).resolves.toEqual({
      writable: [keys[2], keys[0], keys[3]],
      readonly: [keys[1], keys[2], keys[0]],
    });
    expect(rpc.getAddressLookupTable).toHaveBeenNthCalledWith(1, firstKey);
    expect(rpc.getAddressLookupTable).toHaveBeenNthCalledWith(2, secondKey);
  });

  it("skips missing tables", async () => {
    rpc.getAddressLookupTable.mockResolvedValue(null);
    const message = {
      addressTableLookups: [
        {
          accountKey: PublicKey.default,
          writableIndexes: [0],
          readonlyIndexes: [],
        },
      ],
    } as unknown as VersionedMessage;
    await expect(
      new RpcAddressLookupTableResolver(rpc).resolve(message),
    ).resolves.toEqual({ writable: [], readonly: [] });
  });

  it("propagates RPC failures", async () => {
    rpc.getAddressLookupTable.mockRejectedValue(new Error("RPC unavailable"));
    const message = {
      addressTableLookups: [
        {
          accountKey: PublicKey.default,
          writableIndexes: [0],
          readonlyIndexes: [],
        },
      ],
    } as unknown as VersionedMessage;
    await expect(
      new RpcAddressLookupTableResolver(rpc).resolve(message),
    ).rejects.toThrow("RPC unavailable");
  });
});

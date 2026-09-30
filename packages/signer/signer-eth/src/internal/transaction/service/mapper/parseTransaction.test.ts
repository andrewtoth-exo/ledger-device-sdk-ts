import { decodeRlp, encodeRlp, getBytes, Signature, Transaction } from "ethers";

import { EthersTransactionMapperService } from "./EthersTransactionMapperService";
import { parseTransaction } from "./parseTransaction";

const address = "0x000000000000000000000000000000000000dead";
const key = `0x${"12".repeat(32)}`;

function fixture(type: number, signed = false, seed = 1) {
  const tx = Transaction.from({
    type,
    chainId: seed,
    nonce: seed,
    to: address,
    gasLimit: 21000n,
    value: BigInt(seed),
    data: seed % 2 ? "0x12345678ff" : "0x",
    ...(type < 2
      ? { gasPrice: 20n }
      : { maxFeePerGas: 30n, maxPriorityFeePerGas: 10n }),
    ...(type > 0 ? { accessList: [{ address, storageKeys: [key, key] }] } : {}),
    ...(type === 3 ? { maxFeePerBlobGas: 5n, blobVersionedHashes: [key] } : {}),
    ...(type === 4
      ? {
          authorizationList: [
            {
              address,
              chainId: 1n,
              nonce: 0n,
              signature: Signature.from({ r: key, s: key, yParity: 1 }),
            },
          ],
        }
      : {}),
    ...(signed ? { signature: { r: key, s: key, yParity: 1 } } : {}),
  });
  return signed ? tx.serialized : tx.unsignedSerialized;
}

function compare(serialized: string) {
  const mapper = new EthersTransactionMapperService();
  const result = mapper.mapTransactionToSubset(getBytes(serialized));
  let expected;
  try {
    const tx = Transaction.from(serialized);
    if (tx.chainId <= 0n) throw new Error("Unsupported chain");
    expected = {
      type: tx.type || 0,
      serializedTransaction: getBytes(tx.unsignedSerialized),
      subset: {
        chainId: Number(tx.chainId),
        to: tx.to ?? undefined,
        value: tx.value,
        data: tx.data,
        selector: tx.data.length >= 10 ? tx.data.slice(0, 10) : tx.data,
      },
    };
  } catch {
    expect(result.isLeft(), serialized).toBe(true);
    return;
  }
  expect(result.isRight(), serialized).toBe(true);
  expect(result.unsafeCoerce(), serialized).toEqual(expected);
}

describe("Exodus transaction envelope adapter", () => {
  it.each([0, 1, 2, 3, 4])(
    "preserves unsigned and signed type %i transactions",
    (type) => {
      for (let seed = 1; seed <= 20; seed++) {
        compare(fixture(type, false, seed));
        compare(fixture(type, true, seed));
      }
    },
  );

  it.each([0, 1, 2, 3, 4])(
    "matches validation and normalization for type %i mutations",
    (type) => {
      for (const signed of [false, true]) {
        const serialized = fixture(type, signed);
        const fields = decodeRlp(
          type ? `0x${serialized.slice(4)}` : serialized,
        ) as string[];
        const serialize = (changed: unknown[]) =>
          `${type ? `0x0${type}` : "0x"}${encodeRlp(changed as string[]).slice(2)}`;
        for (let index = 0; index < fields.length; index++) {
          for (const replacement of [
            "0x",
            "0x00",
            "0x01",
            "0x02",
            "0x0001",
            "0x1234",
            `0x${"ff".repeat(32)}`,
            `0x${"01".repeat(33)}`,
            [],
            ["0x"],
          ]) {
            const changed: unknown[] = [...fields];
            changed[index] = replacement;
            compare(serialize(changed));
          }
        }
        compare(serialize(fields.slice(1)));
        compare(serialize([...fields, "0x"]));
      }
    },
  );

  it("strips blob sidecars and matches commitment-derived versioned hashes", () => {
    const fields = decodeRlp(`0x${fixture(3, true).slice(4)}`);
    const wrapped = `0x03${encodeRlp([fields, ["0x1234"], [`0x${"ab".repeat(48)}`], [`0x${"cd".repeat(48)}`]]).slice(2)}`;
    compare(wrapped);
    expect(parseTransaction(wrapped).unsignedSerialized).toBe(
      Transaction.from(wrapped).unsignedSerialized,
    );
  });

  it("normalizes authorization signatures and rejects malformed lists", () => {
    const fields = decodeRlp(`0x${fixture(4).slice(4)}`) as (
      | string
      | string[][]
    )[];
    for (const authorization of [
      ["0x", address, "0x", "0x01", "0x01", "0x01"],
      ["0x", address, "0x", "0x02", "0x01", "0x01"],
      ["0x", address, "0x", "0x", key, `0x${"ff".repeat(32)}`],
      ["0x", "0x", "0x", "0x", "0x", "0x"],
      ["0x", address],
    ]) {
      fields[9] = [authorization];
      compare(`0x04${encodeRlp(fields).slice(2)}`);
    }
  });

  it("matches rejection and parsing of deterministically corrupted encodings", () => {
    for (const type of [0, 1, 2, 3, 4]) {
      const original = getBytes(fixture(type, true));
      for (let index = 0; index < original.length; index++) {
        for (const mask of [1, 0x80, 0xff]) {
          const changed = original.slice();
          changed[index] = changed[index]! ^ mask;
          compare(`0x${Buffer.from(changed).toString("hex")}`);
        }
      }
    }
  });

  it.each(["0x", "0x00", "0x05c0", "0x80", "0xc0", "0xff"])(
    "rejects malformed envelopes %s",
    (serialized) => compare(serialized),
  );
});

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from "@exodus/solana-web3.js";
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessagePriorityFeeLamports,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import { TransactionInputNormaliser } from "./TransactionInputNormaliser";

const SIGNATURE_LENGTH = 64;

function buildMessage(version: "legacy" | 0, signerCount = 1): Uint8Array {
  const keys = [1, 2].map(
    (value) => new PublicKey(new Uint8Array(32).fill(value)),
  );
  const message = new TransactionMessage({
    payerKey: keys[0]!,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: keys.map((pubkey, index) => ({
          pubkey,
          isSigner: index < signerCount,
          isWritable: true,
        })),
        data: Buffer.from([1, 2, 3]),
      }),
    ],
  });
  return (
    version === "legacy"
      ? message.compileToLegacyMessage()
      : message.compileToV0Message()
  ).serialize();
}

function buildWireFormat(sigCount: number, message: Uint8Array): Uint8Array {
  // compact-u16 for values < 128 is a single byte
  const wire = new Uint8Array(1 + sigCount * SIGNATURE_LENGTH + message.length);
  wire[0] = sigCount;
  wire.set(message, 1 + sigCount * SIGNATURE_LENGTH);
  return wire;
}

/**
 * Builds a real v1 (SIMD-0385) instruction via `@solana/kit`, with a random
 * program address, a random number of accounts, and random data bytes.
 */
async function buildRandomInstruction(): Promise<Instruction> {
  const program = await generateKeyPairSigner();
  const numAccounts = 1 + Math.floor(Math.random() * 3);
  const accounts = await Promise.all(
    Array.from({ length: numAccounts }, async () => ({
      address: (await generateKeyPairSigner()).address,
      role: AccountRole.WRITABLE,
    })),
  );
  const data = new Uint8Array(1 + Math.floor(Math.random() * 16));
  crypto.getRandomValues(data);
  return { programAddress: program.address, accounts, data };
}

/**
 * Builds and signs a real v1 transaction via `@solana/kit`, with 1-3 random
 * instructions and (optionally) a `TransactionConfigMask` (priority fee +
 * compute-unit limit) set. Returns both the bare message bytes and the
 * signed full-wire bytes (message + real Ed25519 signature).
 */
async function buildRandomV1Transaction(options?: { withConfig?: boolean }) {
  const feePayer = await generateKeyPairSigner();
  const blockhashHolder = await generateKeyPairSigner();
  const numInstructions = 1 + Math.floor(Math.random() * 3);
  const instructions = await Promise.all(
    Array.from({ length: numInstructions }, () => buildRandomInstruction()),
  );

  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(blockhashHolder.address),
          lastValidBlockHeight: 1000n,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) =>
      options?.withConfig
        ? pipe(setTransactionMessagePriorityFeeLamports(5000n, m), (m2) =>
            setTransactionMessageComputeUnitLimit(200000, m2),
          )
        : m,
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const messageBytes = new Uint8Array(signedTx.messageBytes);
  const wireBytes = getTransactionEncoder().encode(signedTx) as Uint8Array;

  return { messageBytes, wireBytes };
}

/**
 * Builds a real v1 transaction with exactly 2 required signers (fee payer +
 * one co-signer, both referenced by their `TransactionSigner`, not just
 * their address, so `signTransactionMessageWithSigners` signs for both).
 * Deterministic in signer count (always 2), unlike `buildRandomV1Transaction`
 * which only ever produces a single (fee-payer) signer.
 */
async function buildTwoSignerV1Transaction() {
  const feePayer = await generateKeyPairSigner();
  const coSigner = await generateKeyPairSigner();
  const program = await generateKeyPairSigner();

  const instruction = {
    programAddress: program.address,
    accounts: [
      {
        address: feePayer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: feePayer,
      },
      {
        address: coSigner.address,
        role: AccountRole.READONLY_SIGNER,
        signer: coSigner,
      },
    ],
    data: new Uint8Array([1, 2, 3]),
  } as const;

  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(coSigner.address),
          lastValidBlockHeight: 1000n,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const messageBytes = new Uint8Array(signedTx.messageBytes);
  const wireBytes = getTransactionEncoder().encode(signedTx) as Uint8Array;

  return { messageBytes, wireBytes, numRequiredSignatures: messageBytes[1]! };
}

describe("TransactionInputNormaliser", () => {
  let normaliser: TransactionInputNormaliser;

  beforeEach(() => {
    vi.resetAllMocks();
    normaliser = new TransactionInputNormaliser();
  });

  it.each(["legacy", 0] as const)(
    "passes bare %s message bytes through unchanged",
    (version) => {
      const message = buildMessage(version);
      const result = normaliser.normalize(message);

      expect(result.messageBytes).toBe(message);
      expect(result.serializedForTxCheck).toBeUndefined();
    },
  );

  it.each(["legacy", 0] as const)(
    "extracts %s message bytes and preserves the original transaction",
    (version) => {
      const message = buildMessage(version);
      const wire = buildWireFormat(1, message);
      wire.fill(42, 1, 1 + SIGNATURE_LENGTH);
      const result = normaliser.normalize(wire);

      expect(Array.from(result.messageBytes)).toEqual(Array.from(message));
      expect(result.serializedForTxCheck).toBe(wire);
    },
  );

  it.each(["legacy", 0] as const)(
    "extracts %s message bytes correctly for a 2-signer transaction",
    (version) => {
      const message = buildMessage(version, 2);
      const wire = buildWireFormat(2, message);
      wire.fill(42, 1, 1 + 2 * SIGNATURE_LENGTH);
      const result = normaliser.normalize(wire);

      expect(Array.from(result.messageBytes)).toEqual(Array.from(message));
      expect(result.serializedForTxCheck).toBe(wire);
    },
  );

  it("messageBytes is a subarray of the original wire buffer (no copy)", () => {
    const message = buildMessage(0);
    const wire = buildWireFormat(1, message);
    const result = normaliser.normalize(wire);

    // subarray shares the same underlying ArrayBuffer
    expect(result.messageBytes.buffer).toBe(wire.buffer);
  });

  it("falls back to raw bytes on garbage input", () => {
    const garbage = new Uint8Array([0xf0, 0xca, 0xcc, 0x1a]);
    const result = normaliser.normalize(garbage);

    expect(result.messageBytes).toBe(garbage);
    expect(result.serializedForTxCheck).toBeUndefined();
  });

  it.each([
    new Uint8Array([0x80]),
    new Uint8Array([0xff, 0xff, 0xff, 0x00]),
    new Uint8Array([0xff, 0xff, 0x04]),
    buildWireFormat(2, buildMessage(0)),
    buildWireFormat(1, buildMessage(0)).subarray(0, -1),
    buildWireFormat(1, buildMessage("legacy")).subarray(0, -1),
    buildWireFormat(1, buildMessage(0)).subarray(0, 64),
  ])("does not strip signatures from malformed or truncated input", (bytes) => {
    const result = normaliser.normalize(bytes);
    expect(result.messageBytes).toBe(bytes);
    expect(result.serializedForTxCheck).toBeUndefined();
  });

  describe("v1 transactions (SIMD-0385, built with @solana/kit)", () => {
    it("passes a bare v1 message through unchanged", async () => {
      const { messageBytes } = await buildRandomV1Transaction();

      const result = normaliser.normalize(messageBytes);

      expect(result.messageBytes).toBe(messageBytes);
      expect(result.serializedForTxCheck).toBeUndefined();
    });

    it("extracts message bytes and sets serializedForTxCheck for a signed full-wire v1 transaction", async () => {
      const { messageBytes, wireBytes } = await buildRandomV1Transaction();

      const result = normaliser.normalize(wireBytes);

      expect(Array.from(result.messageBytes)).toEqual(Array.from(messageBytes));
      expect(result.serializedForTxCheck).toBe(wireBytes);
    });

    it("messageBytes is a subarray of the original v1 wire buffer (no copy)", async () => {
      const { wireBytes } = await buildRandomV1Transaction();

      const result = normaliser.normalize(wireBytes);

      expect(result.messageBytes.buffer).toBe(wireBytes.buffer);
    });

    it("handles a TransactionConfigMask (priority fee + compute-unit limit) correctly", async () => {
      const { messageBytes, wireBytes } = await buildRandomV1Transaction({
        withConfig: true,
      });

      const result = normaliser.normalize(wireBytes);

      expect(Array.from(result.messageBytes)).toEqual(Array.from(messageBytes));
      expect(result.serializedForTxCheck).toBe(wireBytes);
    });

    it("extracts message bytes correctly for a v1 transaction with 2 required signers", async () => {
      const { messageBytes, wireBytes, numRequiredSignatures } =
        await buildTwoSignerV1Transaction();
      expect(numRequiredSignatures).toBe(2);

      const result = normaliser.normalize(wireBytes);

      expect(Array.from(result.messageBytes)).toEqual(Array.from(messageBytes));
      expect(result.serializedForTxCheck).toBe(wireBytes);
      // the tail is exactly 2 signatures, not 1 — proves the
      // numRequiredSignatures * 64 boundary is computed from the real count.
      expect(wireBytes.length - result.messageBytes.length).toBe(2 * 64);
    });

    it("handles multiple random instructions with varying account/data sizes", async () => {
      // buildRandomV1Transaction already picks 1-3 random instructions with
      // random account counts and data lengths; run it a few times to
      // exercise a spread of shapes.
      for (let i = 0; i < 5; i++) {
        const { messageBytes, wireBytes } = await buildRandomV1Transaction();

        const result = normaliser.normalize(wireBytes);

        expect(Array.from(result.messageBytes)).toEqual(
          Array.from(messageBytes),
        );
        expect(result.serializedForTxCheck).toBe(wireBytes);
      }
    });

    it("falls back to raw bytes for truncated v1 input shorter than the fixed header", () => {
      const truncated = new Uint8Array([0x81, 1, 0, 0]);

      const result = normaliser.normalize(truncated);

      expect(result.messageBytes).toBe(truncated);
      expect(result.serializedForTxCheck).toBeUndefined();
    });

    it("falls back to raw bytes for a real v1 message truncated mid-structure", async () => {
      const { messageBytes } = await buildRandomV1Transaction();
      const truncated = messageBytes.subarray(0, messageBytes.length - 3);

      const result = normaliser.normalize(truncated);

      expect(result.messageBytes).toBe(truncated);
      expect(result.serializedForTxCheck).toBeUndefined();
    });

    it("falls back to raw bytes for v1 input whose length matches neither a bare message nor a full transaction", async () => {
      const { messageBytes } = await buildRandomV1Transaction();
      // append a partial, incomplete signature (not a full 64-byte block)
      const malformed = new Uint8Array(messageBytes.length + 10);
      malformed.set(messageBytes, 0);

      const result = normaliser.normalize(malformed);

      expect(result.messageBytes).toBe(malformed);
      expect(result.serializedForTxCheck).toBeUndefined();
    });
  });
});

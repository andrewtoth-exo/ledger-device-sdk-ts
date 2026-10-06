import { fromBase58 } from "@exodus/bytes/base58.js";
import { toBase64 } from "@exodus/bytes/base64.js";
import { AddressLookupTableProgram, PublicKey } from "@exodus/solana-web3.js";

import { SolanaRpc } from "./SolanaRpc";

const RPC_URL = "https://rpc.example.com";
const BLOCKHASH = "a3PD566oU2nE9JHwuC897aaT7ispdqaQ63Si6jzyKAg";
const TABLE_KEY = new PublicKey(new Uint8Array(32).fill(1));
const ADDRESSES = [2, 3].map(
  (value) => new PublicKey(new Uint8Array(32).fill(value)),
);

function tableAccount() {
  const data = new Uint8Array(56 + ADDRESSES.length * 32);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  view.setBigUint64(4, 0xffffffffffffffffn, true);
  view.setBigUint64(12, 123n, true);
  data[20] = 1;
  data[21] = 1;
  data.set(TABLE_KEY.toBytes(), 22);
  ADDRESSES.forEach((address, index) =>
    data.set(address.toBytes(), 56 + index * 32),
  );
  return {
    owner: AddressLookupTableProgram.programId.toBase58(),
    data: [toBase64(data), "base64"],
  };
}

describe("SolanaRpc", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const rpc = new SolanaRpc(RPC_URL);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function respond(value: unknown) {
    fetchMock.mockResolvedValueOnce(
      Response.json({ jsonrpc: "2.0", id: 1, result: { value } }),
    );
  }

  function expectRequest(method: string, params: unknown[]) {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(RPC_URL);
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(options?.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });
  }

  it("fetches a finalized blockhash", async () => {
    respond({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 });
    await expect(rpc.getLatestBlockhash()).resolves.toEqual(
      fromBase58(BLOCKHASH),
    );
    expectRequest("getLatestBlockhash", [{ commitment: "finalized" }]);
  });

  it.each(["ws://rpc.example.com", "file:///rpc", "data:application/json,{}"])(
    "rejects non-HTTP RPC URLs: %s",
    (url) => {
      expect(() => new SolanaRpc(url)).toThrow("HTTP or HTTPS");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("decodes a confirmed lookup table's metadata and addresses", async () => {
    respond(tableAccount());
    const table = await rpc.getAddressLookupTable(TABLE_KEY);
    expect(table?.key).toEqual(TABLE_KEY);
    expect(table?.state).toEqual({
      deactivationSlot: 0xffffffffffffffffn,
      lastExtendedSlot: 123,
      lastExtendedSlotStartIndex: 1,
      authority: TABLE_KEY,
      addresses: ADDRESSES,
    });
    expectRequest("getAccountInfo", [
      TABLE_KEY.toBase58(),
      { commitment: "confirmed", encoding: "base64" },
    ]);
  });

  it("returns null for a missing lookup table", async () => {
    respond(null);
    await expect(rpc.getAddressLookupTable(TABLE_KEY)).resolves.toBeNull();
  });

  it.each([
    null,
    {},
    { blockhash: 12 },
    { blockhash: "invalid0" },
    { blockhash: "1" },
  ])("rejects an invalid blockhash: %j", async (value) => {
    respond(value);
    await expect(rpc.getLatestBlockhash()).rejects.toThrow();
  });

  it.each([
    {},
    { ...tableAccount(), owner: PublicKey.default.toBase58() },
    { ...tableAccount(), data: "not a tuple" },
    { ...tableAccount(), data: [42, "base64"] },
    { ...tableAccount(), data: ["", "base64+zstd"] },
    { ...tableAccount(), data: ["%%%", "base64"] },
    { ...tableAccount(), data: ["", "base64"] },
    { ...tableAccount(), data: [toBase64(new Uint8Array(56)), "base64"] },
    {
      ...tableAccount(),
      data: [toBase64(new Uint8Array([1, ...new Uint8Array(56)])), "base64"],
    },
  ])("rejects an invalid lookup table: %j", async (value) => {
    respond(value);
    await expect(rpc.getAddressLookupTable(TABLE_KEY)).rejects.toThrow();
  });

  it.each([
    null,
    [],
    {},
    { jsonrpc: "1.0", id: 1, result: { value: null } },
    { jsonrpc: "2.0", id: 2, result: { value: null } },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, result: null },
    { jsonrpc: "2.0", id: 1, result: {} },
  ])("rejects a malformed RPC envelope: %j", async (payload) => {
    fetchMock.mockResolvedValueOnce(Response.json(payload));
    await expect(rpc.getAddressLookupTable(TABLE_KEY)).rejects.toThrow(
      "Invalid getAccountInfo RPC",
    );
  });

  it("propagates JSON-RPC errors", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "Invalid params" },
      }),
    );
    await expect(rpc.getLatestBlockhash()).rejects.toThrow(
      "getLatestBlockhash RPC error: Invalid params",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    await expect(rpc.getLatestBlockhash()).rejects.toThrow();
  });

  it("propagates network failures without retrying", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    await expect(rpc.getLatestBlockhash()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates non-rate-limit HTTP errors without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unavailable", { status: 503 }),
    );
    await expect(rpc.getLatestBlockhash()).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries rate limits with the existing exponential backoff", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 }),
    );
    respond({ blockhash: BLOCKHASH });
    const pending = rpc.getLatestBlockhash();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual(fromBase58(BLOCKHASH));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after five rate-limited attempts", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("Rate limited", { status: 429 })),
    );
    const rejected = expect(rpc.getLatestBlockhash()).rejects.toThrow("429");
    await vi.advanceTimersByTimeAsync(7499);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

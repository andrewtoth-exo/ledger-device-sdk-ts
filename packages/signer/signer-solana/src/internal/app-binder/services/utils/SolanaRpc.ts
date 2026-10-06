import { fromBase58 } from "@exodus/bytes/base58.js";
import { fromBase64 } from "@exodus/bytes/base64.js";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type PublicKey,
} from "@exodus/solana-web3.js";
import {
  DmkNetworkClient,
  DmkNetworkClientError,
} from "@ledgerhq/device-management-kit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SolanaRpc {
  private readonly network = new DmkNetworkClient();

  constructor(private readonly rpcUrl: string) {
    if (!/^https?:/.test(rpcUrl)) {
      throw new Error("Solana RPC URL must use HTTP or HTTPS");
    }
  }

  async getLatestBlockhash(): Promise<Uint8Array> {
    const value = await this.request("getLatestBlockhash", [
      { commitment: "finalized" },
    ]);
    if (!isRecord(value) || typeof value["blockhash"] !== "string") {
      throw new Error("Invalid RPC blockhash");
    }
    const blockhash = fromBase58(value["blockhash"]);
    if (blockhash.length !== 32) {
      throw new Error("Invalid RPC blockhash length");
    }
    return blockhash;
  }

  async getAddressLookupTable(
    accountKey: PublicKey,
  ): Promise<AddressLookupTableAccount | null> {
    const value = await this.request("getAccountInfo", [
      accountKey.toBase58(),
      { commitment: "confirmed", encoding: "base64" },
    ]);
    if (value === null) return null;
    if (
      !isRecord(value) ||
      value["owner"] !== AddressLookupTableProgram.programId.toBase58() ||
      !Array.isArray(value["data"]) ||
      value["data"].length !== 2 ||
      typeof value["data"][0] !== "string" ||
      value["data"][1] !== "base64"
    ) {
      throw new Error("Invalid RPC address lookup table account");
    }
    return new AddressLookupTableAccount({
      key: accountKey,
      state: AddressLookupTableAccount.deserialize(
        fromBase64(value["data"][0]),
      ),
    });
  }

  private async request(method: string, params: unknown[]): Promise<unknown> {
    let payload: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        payload = await this.network.post(this.rpcUrl, {
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        });
        break;
      } catch (error) {
        if (
          !(error instanceof DmkNetworkClientError) ||
          error.status !== 429 ||
          attempt === 4
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (
      !isRecord(payload) ||
      payload["jsonrpc"] !== "2.0" ||
      payload["id"] !== 1
    ) {
      throw new Error(`Invalid ${method} RPC response`);
    }
    if ("error" in payload) {
      const message = isRecord(payload["error"])
        ? payload["error"]["message"]
        : undefined;
      throw new Error(
        `${method} RPC error: ${typeof message === "string" ? message : "Unknown error"}`,
      );
    }
    if (!isRecord(payload["result"]) || !("value" in payload["result"])) {
      throw new Error(`Invalid ${method} RPC result`);
    }
    return payload["result"]["value"];
  }
}

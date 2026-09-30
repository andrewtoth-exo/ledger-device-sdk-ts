import "./ethereumBuffer";

import { hashSync } from "@exodus/crypto/hash";
import { defaultAbiCoder } from "@exodus/ethereumjs/ethers5-abi";

type AbiParameter = {
  type: string;
  name?: string;
  components?: AbiParameter[];
};
type AbiFragment = {
  type: string;
  name: string;
  inputs?: AbiParameter[] | null;
};
export type AbiResult = unknown[] & Record<string, unknown>;

function normalizeValue(value: unknown): unknown {
  if (typeof value === "number") return BigInt(value);
  if (Array.isArray(value)) {
    const result: unknown[] = new Array(value.length);
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, {
        enumerable: true,
        get: () => normalizeValue((value as AbiResult)[key]),
      });
    }
    return result;
  }
  if (value && typeof value === "object" && "_isBigNumber" in value) {
    return BigInt(String(value));
  }
  return value;
}

export function decodeAbiParameters(
  types: readonly unknown[],
  data: string,
): AbiResult {
  return normalizeValue(defaultAbiCoder.decode(types, data)) as AbiResult;
}

function formatParameter(parameter: AbiParameter): string {
  if (parameter.type.startsWith("tuple")) {
    if (!Array.isArray(parameter.components))
      throw new Error("Missing tuple components");
    return `(${parameter.components.map(formatParameter).join(",")})${parameter.type.slice(5)}`;
  }
  return parameter.type.replace(/^(u?int)(?=\[|$)/, "$1256");
}

export function decodeFunctionData(
  abi: readonly object[],
  data: string,
  method?: string,
): AbiResult {
  const functions = new Map<string, AbiFragment>();
  for (const entry of abi) {
    const fragment = entry as AbiFragment;
    if (fragment.type !== "function") continue;
    const signature = `${fragment.name}(${(fragment.inputs ?? []).map(formatParameter).join(",")})`;
    if (!functions.has(signature)) functions.set(signature, fragment);
  }
  const selector = data.slice(0, 10).toLowerCase();
  const canonicalMethod = method
    ?.replace(/\s/g, "")
    .replace(/\b(u?int)(?=[,[)])/g, "$1256");
  const candidates = [...functions].filter(
    ([signature, fragment]) =>
      method === undefined ||
      (method.startsWith("0x")
        ? `0x${hashSync("keccak256", signature, "hex").slice(0, 8)}` ===
          method.toLowerCase()
        : method.includes("(")
          ? signature === canonicalMethod
          : fragment.name === method),
  );
  if (method !== undefined && candidates.length !== 1)
    throw new Error("Unknown or ambiguous ABI method");
  for (const [signature, fragment] of candidates) {
    if (
      `0x${hashSync("keccak256", signature, "hex").slice(0, 8)}` === selector
    ) {
      return decodeAbiParameters(fragment.inputs ?? [], `0x${data.slice(10)}`);
    }
  }
  throw new Error("Function selector does not match ABI method");
}

declare module "@exodus/ethereumjs/ethers5-abi" {
  export const defaultAbiCoder: {
    decode(types: readonly unknown[], data: string): unknown[];
  };
}

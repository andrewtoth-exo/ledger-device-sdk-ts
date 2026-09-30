import { Buffer as PortableBuffer } from "buffer/index.js";

if (typeof globalThis.Buffer === "undefined") {
  Object.defineProperty(globalThis, "Buffer", {
    value: PortableBuffer,
    configurable: true,
    writable: true,
  });
}

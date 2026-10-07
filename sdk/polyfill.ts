// Classic Solana token SDK dependencies expect the Node Buffer API in browsers.
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = Buffer;

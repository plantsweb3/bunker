import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/rpc/route";
import { boundedText, BodyLimitError } from "../lib/bounded-body";
import { MAINNET_GENESIS } from "../lib/bunker-config";
function request(body: unknown, origin = "https://bunkermode.io") {
  return new Request("https://bunkermode.io/api/rpc", {
    method: "POST", headers: { origin }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const read = { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] };
const write = { ...read, method: "sendTransaction", params: ["AA=="] };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("RPC boundary", () => {
  it("blocks mainnet writes before making an upstream request", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await (await POST(request(write))).json()).error.code).toBe(-32601);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects batches, invalid JSON, cross-origin calls and oversized request bytes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    expect((await POST(request([read]))).status).toBe(400);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(read, "https://elsewhere.example"))).status).toBe(403);
    expect((await POST(request("é".repeat(10000)))).status).toBe(413);
  });
  it("rejects unexpected or mainnet genesis before forwarding test writes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "true");
    vi.stubEnv("BUNKER_TEST_NETWORK", "localnet");
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "test");
    for (const [expected, actual] of [["local", "wrong"], [MAINNET_GENESIS, MAINNET_GENESIS]]) {
      vi.stubEnv("BUNKER_LOCAL_GENESIS", expected);
      const fetch = vi.fn().mockResolvedValue(Response.json({ result: actual })); vi.stubGlobal("fetch", fetch);
      expect((await POST(request(write))).status).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("forwards test writes only after a pinned local genesis match", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "true"); vi.stubEnv("BUNKER_TEST_NETWORK", "localnet");
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "test"); vi.stubEnv("BUNKER_LOCAL_GENESIS", "local");
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ result: "local" })).mockResolvedValueOnce(Response.json({ result: "signature" }));
    vi.stubGlobal("fetch", fetch);
    expect((await (await POST(request(write))).json()).result).toBe("signature");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("caps upstream response bytes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(3000001))));
    expect((await POST(request(read))).status).toBe(502);
  });
  it("cancels a stream as soon as its byte limit is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel });
    await expect(boundedText(stream, 10)).rejects.toBeInstanceOf(BodyLimitError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

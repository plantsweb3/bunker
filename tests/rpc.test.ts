import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/rpc/route";
import { boundedText, BodyLimitError } from "../lib/bounded-body";
import { MAINNET_GENESIS } from "../lib/bunker-config";
function request(body: unknown, origin = "https://bunkermode.io") {
  return new Request("https://bunkermode.io/api/rpc", {
    method: "POST",
    headers: { origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const read = { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] };
const write = { ...read, method: "sendTransaction", params: ["AA=="] };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("RPC boundary", () => {
  it("blocks mainnet writes before making an upstream request", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await (await POST(request(write))).json()).error.code).toBe(-32601);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the browser-facing Host when Next has a different internal hostname, without trusting forwarded hosts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 1, result: 123 }));
    vi.stubGlobal("fetch", fetcher);
    const local = (origin: string, forwardedHost = "attacker.example") =>
      new Request("http://localhost:5175/api/rpc", {
        method: "POST",
        headers: {
          host: "127.0.0.1:5175",
          origin,
          "x-forwarded-host": forwardedHost,
        },
        body: JSON.stringify(read),
      });
    expect((await POST(local("http://127.0.0.1:5175"))).status).toBe(200);
    expect((await POST(local("http://attacker.example"))).status).toBe(403);
    expect((await POST(local("https://127.0.0.1:5175"))).status).toBe(403);
    expect((await POST(local("http://127.0.0.1:5176"))).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("forwards only the read methods the app uses and refuses everything else", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ jsonrpc: "2.0", id: 1, result: null })),
      );
    vi.stubGlobal("fetch", fetcher);
    const call = async (method: string) =>
      (await (await POST(request({ ...read, method }))).json()) as {
        error?: { code: number };
      };
    for (const method of [
      "getBalance",
      "getAccountInfo",
      "getTokenAccountsByOwner",
      "getSignaturesForAddress",
      "getTransaction",
    ])
      expect((await call(method)).error, method).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const method of [
      "sendTransaction",
      "simulateTransaction",
      "requestAirdrop",
      "getProgramAccounts",
      "getBlock",
      "getTokenLargestAccounts",
    ])
      expect((await call(method)).error?.code, method).toBe(-32601);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("rejects batches, invalid JSON, cross-origin calls and oversized request bytes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    expect((await POST(request([read]))).status).toBe(400);
    expect((await POST(request("{"))).status).toBe(400);
    expect(
      (await POST(request(read, "https://elsewhere.example"))).status,
    ).toBe(403);
    expect((await POST(request("é".repeat(10000)))).status).toBe(413);
  });
  it("rejects unexpected or mainnet genesis before forwarding test writes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "true");
    vi.stubEnv("BUNKER_TEST_NETWORK", "localnet");
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "test");
    for (const [expected, actual] of [
      ["local", "wrong"],
      [MAINNET_GENESIS, MAINNET_GENESIS],
    ]) {
      vi.stubEnv("BUNKER_LOCAL_GENESIS", expected);
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ result: actual }));
      vi.stubGlobal("fetch", fetch);
      expect((await POST(request(write))).status).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("forwards test writes only after a pinned local genesis match", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "true");
    vi.stubEnv("BUNKER_TEST_NETWORK", "localnet");
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "test");
    vi.stubEnv("BUNKER_LOCAL_GENESIS", "local");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: "local" }))
      .mockResolvedValueOnce(Response.json({ result: "signature" }));
    vi.stubGlobal("fetch", fetch);
    expect((await (await POST(request(write))).json()).result).toBe(
      "signature",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("caps upstream response bytes", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(3000001))),
    );
    expect((await POST(request(read))).status).toBe(502);
  });
  it("cancels a stream as soon as its byte limit is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(20));
      },
      cancel,
    });
    await expect(boundedText(stream, 10)).rejects.toBeInstanceOf(
      BodyLimitError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});

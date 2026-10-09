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
  it("checks that the network is mainnet before forwarding a mainnet write", async () => {
    vi.stubEnv("BUNKER_ENABLE_TEST_CUSTODY", "false");
    const elsewhere = vi.fn().mockResolvedValue(Response.json({ result: "wrong" }));
    vi.stubGlobal("fetch", elsewhere);
    expect((await POST(request(write))).status).toBe(403);
    expect(elsewhere).toHaveBeenCalledTimes(1);
    const mainnet = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: MAINNET_GENESIS }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: "signature" }));
    vi.stubGlobal("fetch", mainnet);
    expect((await (await POST(request(write))).json()).result).toBe("signature");
    expect(mainnet).toHaveBeenCalledTimes(2);
  });
  it("limits how fast one client can simulate or send", async () => {
    const from = (ip: string) =>
      new Request("https://bunkermode.io/api/rpc", {
        method: "POST",
        headers: { origin: "https://bunkermode.io", "x-real-ip": ip },
        body: JSON.stringify(write),
      });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ result: MAINNET_GENESIS }))));
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) statuses.push((await POST(from("203.0.113.9"))).status);
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(40).every((s) => s === 429)).toBe(true);
    // Someone else is not held back by it.
    expect((await POST(from("203.0.113.10"))).status).toBe(200);
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
    const key = "11111111111111111111111111111111";
    const call = async (method: string) =>
      (await (
        await POST(
          request({
            ...read,
            method,
            params: method === "getSignaturesForAddress" ? [key, { limit: 15 }] : [],
          }),
        )
      ).json()) as {
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
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn");
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
    vi.stubEnv("BUNKER_TEST_PROGRAM_ID", "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn");
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
describe("RPC request limits", () => {
  const ok = () => vi.fn().mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 1, result: [] }));
  const call = (method: string, params: unknown[], headers: Record<string, string> = {}) =>
    POST(
      new Request("https://bunkermode.io/api/rpc", {
        method: "POST",
        headers: { origin: "https://bunkermode.io", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  it("refuses list reads that ask for more than the site needs", async () => {
    const fetcher = ok();
    vi.stubGlobal("fetch", fetcher);
    const key = "11111111111111111111111111111111";
    expect((await call("getSignaturesForAddress", [key, { limit: 15 }])).status).toBe(200);
    for (const params of [[key], [key, {}], [key, { limit: 1000 }], [key, { limit: 0 }], [key, { limit: "9" }]])
      expect((await call("getSignaturesForAddress", params)).status, JSON.stringify(params)).toBe(400);
    expect((await call("getMultipleAccounts", [Array(100).fill(key)])).status).toBe(200);
    expect((await call("getMultipleAccounts", [Array(101).fill(key)])).status).toBe(400);
    expect((await call("getSignatureStatuses", [Array(33).fill("s")])).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("limits how fast one client address can call, and no other", async () => {
    vi.stubGlobal("fetch", ok());
    const from = (ip: string) => call("getSlot", [], { "x-forwarded-for": `${ip}, 10.0.0.1` });
    let last = 200;
    for (let i = 0; i < 301; i++) last = (await from("203.0.113.9")).status;
    expect(last).toBe(429);
    expect((await from("203.0.113.10")).status).toBe(200);
  });
});
describe("Client identity for rate limiting", () => {
  it("prefers the platform's address, groups an IPv6 subscriber, and cannot be reset by filling the table", async () => {
    const { clientOf, rateLimiter } = await import("../lib/rate-limit");
    const req = (h: Record<string, string>) => new Request("https://bunkermode.io/api/rpc", { headers: h });
    expect(clientOf(req({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.9");
    expect(clientOf(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientOf(req({}))).toBeNull();
    // Two addresses in one /64 are one client.
    expect(clientOf(req({ "x-real-ip": "2001:db8:1:2:aaaa::1" }))).toBe(
      clientOf(req({ "x-real-ip": "2001:DB8:1:2:bbbb::2" })),
    );
    const allow = rateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) expect(allow("victim", 0)).toBe(true);
    expect(allow("victim", 0)).toBe(false);
    // Thousands of other addresses arrive; the limited client stays limited.
    for (let i = 0; i < 6000; i++) allow(`other-${i}`, 1);
    expect(allow("victim", 2)).toBe(false);
    // Addresses beyond the table share one allowance instead of each getting a new one.
    const late = Array.from({ length: 10 }, (_, i) => allow(`late-${i}`, 3));
    expect(late.filter(Boolean).length).toBeLessThanOrEqual(3);
    // A new window restores it.
    expect(allow("victim", 60_001)).toBe(true);
  });
});

import { test, expect } from "@playwright/test";
test("brand, navigation, release gate, and wallet empty state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "One bad click shouldn’t cost you everything.",
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("bunker-preview.png") });
  await page.getByRole("link", { name: "Launch app", exact: true }).click();
  await expect(
    page.getByText("MAINNET · BETA", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Build a Bunker", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("No compatible wallet detected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
});
test("practice run: pack the Bunker, take the bait, press stop", async ({ page }) => {
  await page.goto("/demo");
  const game = page.locator(".practice");
  await expect(game.getByRole("heading", { name: "Put your coins behind the door." })).toBeVisible();
  // Two coins by hand, then the rest of eight with the helper.
  await game.getByRole("button", { name: /Coin 1, in the wallet/ }).click();
  await expect(game.locator(".practice-tally")).toContainText("Wallet 9");
  await game.getByRole("button", { name: /Coin 1, in the Bunker/ }).click();
  await game.getByRole("button", { name: "Move 8 in for me" }).click();
  await expect(game.locator(".practice-tally")).toContainText("Bunker 8");
  await game.getByRole("button", { name: "I’m ready" }).click();
  await game.getByRole("button", { name: /FREE COINS/ }).click();
  await expect(game.getByRole("heading", { name: "He took your 2." })).toBeVisible();
  await expect(game.getByText("The 8 behind the door did not move.", { exact: false })).toBeVisible();
  await game.getByRole("button", { name: "What if he gets my door key too?" }).click();
  await game.getByRole("button", { name: "STOP" }).click();
  await expect(game.getByText("You kept 8 of 10.", { exact: false })).toBeVisible();
  await expect(game.getByRole("link", { name: "Build my Bunker" })).toBeVisible();
  // Without a Bunker, everything goes; and not pressing stop loses the rest.
  await game.getByRole("button", { name: "Play again" }).click();
  await game.getByRole("button", { name: "Skip the Bunker and see what happens" }).click();
  await game.getByRole("button", { name: /FREE COINS/ }).click();
  await expect(game.getByRole("heading", { name: "He took everything." })).toBeVisible();
  await game.getByRole("button", { name: "Try again, with a Bunker" }).click();
  await game.getByRole("button", { name: "Move 8 in for me" }).click();
  await game.getByRole("button", { name: "I’m ready" }).click();
  await game.getByRole("button", { name: /FREE COINS/ }).click();
  await game.getByRole("button", { name: "What if he gets my door key too?" }).click();
  await expect(game.getByRole("heading", { name: "Too slow." })).toBeVisible({ timeout: 12000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});
test("demo has a complete, resettable journey", async ({ page }) => {
  await page.goto("/demo");
  await page.getByText("For the curious", { exact: false }).click();
  await page.getByRole("button", { name: "Move assets into Bunker" }).click();
  await page
    .getByRole("button", { name: "Approve the fake airdrop" })
    .click();
  await page
    .getByRole("button", { name: "Let the drainer try the vault" })
    .click();
  await expect(
    page.getByText("WITHDRAWAL REJECTED", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Withdraw $500 with your Bunker key" })
    .click();
  // The balance counts up to its value, so give it time on a busy machine.
  await expect(page.getByText("$3,500", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(
    page.getByRole("button", { name: "Move assets into Bunker" }),
  ).toBeVisible();
});
test("security, documentation, verification and no horizontal overflow", async ({
  page,
}) => {
  // The verify page now reads the program from mainnet, which can be slow.
  test.setTimeout(60_000);
  for (const path of [
    "/",
    "/vault",
    "/demo",
    "/check",
    "/recovery",
    "/integrate",
    "/emergency",
    "/terms",
    "/privacy",
    "/security",
    "/docs",
    "/verify",
  ]) {
    const response = await page.goto(path);
    expect(
      response!.headers()["content-security-policy"],
      `${path} policy`,
    ).toContain("'strict-dynamic'");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "Unhandled Script Error",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `${path} overflow`).toBe(false);
  }
  await expect(
    page.getByText("DGXACBwbUqRKRVR1TQojZBoRuV2TZJ8wVnQSuLKm2nJJ").first(),
  ).toBeVisible();
  await expect(
    page.getByText("Not independently verified", { exact: true }),
  ).toBeVisible();
});
test("wallet check summarises balances and open approvals without a wallet", async ({
  page,
}) => {
  const owner = "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg";
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const account = (pubkey: string, info: object) => ({
    pubkey,
    account: {
      data: { parsed: { info, type: "account" }, program: "spl-token", space: 165 },
      executable: false,
      lamports: 2039280,
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      rentEpoch: 0,
    },
  });
  await page.route("**/api/rpc", async (route) => {
    const body = route.request().postDataJSON();
    const classic =
      body.params?.[1]?.programId ===
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const value =
      body.method === "getBalance"
        ? 1_500_000_000
        : classic
          ? [
              account("So11111111111111111111111111111111111111112", {
                mint,
                state: "initialized",
                tokenAmount: { amount: "25000000", decimals: 6 },
                delegate: "11111111111111111111111111111111",
                delegatedAmount: { amount: "25000000", decimals: 6 },
              }),
            ]
          : [];
    await route.fulfill({
      json: { jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value } },
    });
  });
  await page.goto("/check");
  await page.getByLabel("Solana wallet address").fill("not an address");
  await page.getByRole("button", { name: "Check wallet" }).click();
  await expect(page.locator(".error-box")).toContainText(
    "not a valid Solana",
  );
  await page.getByLabel("Solana wallet address").fill(owner);
  await page.getByRole("button", { name: "Check wallet" }).click();
  await expect(page.getByText(owner, { exact: true })).toBeVisible();
  await expect(page.locator(".check-card.exposed strong")).toContainText("1.5");
  await expect(page.locator(".check-card.warn strong")).toHaveText("1");
  await expect(
    page.getByRole("heading", { name: "Open approvals" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});
test("wallet check reads a very large wallet and flags tokens their issuer can move", async ({
  page,
}) => {
  const owner = "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg";
  const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const controlled = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
  const issuer = "Sysvar1nstructions1111111111111111111111111";
  // The first 129 bytes of a token account holding 5 units, approved to nobody.
  const raw = Buffer.alloc(129);
  raw.fill(7, 0, 64);
  raw.writeBigUInt64LE(5n, 64);
  raw[108] = 1;
  const seen: string[] = [];
  await page.route("**/api/rpc", async (route) => {
    const body = route.request().postDataJSON();
    const reply = (value: unknown) =>
      route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value } } });
    if (body.method === "getBalance") return reply(2_000_000_000);
    if (body.method === "getMultipleAccounts") {
      seen.push(`mints:${body.params[0].join(",")}`);
      return reply([
        {
          data: {
            parsed: {
              info: { decimals: 6, extensions: [{ extension: "permanentDelegate", state: { delegate: issuer } }] },
              type: "mint",
            },
            program: "spl-token-2022",
            space: 200,
          },
          executable: false,
          lamports: 1,
          owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          rentEpoch: 0,
        },
      ]);
    }
    const classic = body.params?.[1]?.programId === CLASSIC;
    const parsed = body.params?.[2]?.encoding === "jsonParsed";
    seen.push(`${classic ? "classic" : "2022"}:${body.params?.[2]?.encoding}:${JSON.stringify(body.params?.[2]?.dataSlice ?? null)}`);
    // The classic accounts are too many to return parsed.
    if (classic && parsed) return route.fulfill({ status: 502, body: "RPC response too large" });
    if (classic)
      return reply(
        Array.from({ length: 3 }, (_, i) => ({
          pubkey: ["So11111111111111111111111111111111111111112", "SysvarC1ock11111111111111111111111111111111", "SysvarRent111111111111111111111111111111111"][i],
          account: { data: [raw.toString("base64"), "base64"], executable: false, lamports: 2039280, owner: CLASSIC, rentEpoch: 0, space: 165 },
        })),
      );
    return reply([
      {
        pubkey: "Vote111111111111111111111111111111111111111",
        account: {
          data: {
            parsed: { info: { mint: controlled, state: "initialized", tokenAmount: { amount: "9000000", decimals: 6 } }, type: "account" },
            program: "spl-token-2022",
            space: 165,
          },
          executable: false,
          lamports: 2039280,
          owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          rentEpoch: 0,
        },
      },
    ]);
  });
  await page.goto(`/check?a=${owner}`);
  await expect(page.locator(".check-card.exposed")).toContainText("4 token balances");
  // The large wallet was read again as account prefixes, and only then.
  expect(seen).toContain('classic:base64:{"offset":0,"length":129}');
  expect(seen.filter((s) => s.startsWith("2022:"))).toEqual(["2022:jsonParsed:null"]);
  expect(seen).toContain(`mints:${controlled}`);
  await expect(page.getByText("amount not loaded").first()).toBeVisible();
  await expect(page.getByText("too many token accounts to load amounts", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Balances the token’s issuer can move" })).toBeVisible();
  await expect(page.getByText("Movable by", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});
test("the landing page tells the story in pictures, one step at a time", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const story = page.locator(".story");
  await story.scrollIntoViewIfNeeded();
  // With reduced motion it does not start by itself.
  await page.waitForTimeout(600);
  await expect(story).toHaveAttribute("data-beat", "0");
  await expect(story.getByRole("heading", { name: "This is everything you own." })).toBeVisible();
  const steps = story.getByRole("tab");
  await expect(steps).toHaveCount(6);
  await steps.nth(2).click();
  await expect(story.getByText("That was your pocket money.")).toBeVisible();
  await steps.nth(4).click();
  await expect(story.getByText("You press cancel. Nothing leaves.", { exact: false })).toBeVisible();
  await expect(story.locator(".story-cancelled")).toHaveCSS("opacity", "1");
  await steps.nth(5).click();
  await expect(story.getByRole("button", { name: "Play again" })).toBeVisible();
  await story.getByRole("button", { name: "Play again" }).click();
  await expect(story).toHaveAttribute("data-beat", "0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});
test("unknown paths are served with the browser policy too", async ({
  page,
}) => {
  const response = await page.goto("/no-such-page");
  expect(response!.status()).toBe(404);
  expect(response!.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  );
  await expect(page.locator("h1")).toBeVisible();
});
test("paths outside the page policy still cannot run anything", async ({ request }) => {
  // Not-found responses under prefixes the proxy skips.
  for (const path of ["/api/nope", "/_next/nope", "/assets/nope", "/brand/nope", "/x/opengraph-image-nope"]) {
    const r = await request.get(path);
    expect(r.headers()["content-security-policy"], path).toContain("default-src 'none'");
  }
  // Paths that merely start like a static file are ordinary pages and get the page policy.
  for (const path of ["/favicon.icoX", "/robots.txtfoo", "/sitemap.xmlx/y"]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(404);
    expect(r.headers()["content-security-policy"], path).toContain("'strict-dynamic'");
  }
  expect((await request.get("/")).headers()["cross-origin-opener-policy"]).toBe("same-origin");
  // The recovery tool is handed over as a download and never runs on this origin.
  const tool = await request.get("/source/bunker-recovery-tool.html");
  expect(tool.status()).toBe(200);
  expect(tool.headers()["content-disposition"]).toContain("attachment");
  expect(tool.headers()["content-security-policy"]).toContain("sandbox");
  expect((await request.get("/source/nope.html")).headers()["content-security-policy"]).toContain("sandbox");
});
test("server refuses calls the app never makes", async ({ request }) => {
  const r = await request.post("/api/rpc", {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "requestAirdrop",
      params: ["11111111111111111111111111111111", 1],
    },
  });
  const body = await r.json();
  expect(body.error.code).toBe(-32601);
});

test("production browser policy uses a fresh nonce and rejects injected inline scripts", async ({ page, request }) => {
  const first = await page.goto("/");
  const policy = first!.headers()["content-security-policy"];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy.split("script-src")[1].split(";")[0]).not.toContain("'unsafe-inline'");
  expect(first!.headers()["x-content-type-options"]).toBe("nosniff");
  const second = await request.get("/");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({ response, body: html.replace("<head>", "<head><script>document.documentElement.dataset.injected = 'yes'</script>") });
  });
  await page.reload();
  const executed = await page.evaluate(() => document.documentElement.dataset.injected);
  expect(executed).toBeUndefined();
  await expect(page.getByRole("link", { name: "Launch app", exact: true })).toBeVisible();
});

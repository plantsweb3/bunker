import { test, expect } from "@playwright/test";
test("brand, navigation, release gate, and wallet empty state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "One bad signature shouldn’t cost you everything.",
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("bunker-preview.png") });
  await page.getByRole("link", { name: "Launch app", exact: true }).click();
  await expect(
    page.getByText("MAINNET · READ ONLY", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Bunker", exact: true }),
  ).toBeDisabled();
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
test("demo has a complete, resettable journey", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Move assets into Bunker" }).click();
  await page
    .getByRole("button", { name: "Approve the fake airdrop" })
    .click();
  await page
    .getByRole("button", { name: "Let the drainer try the vault" })
    .click();
  await expect(
    page.getByText("WITHDRAWAL REJECTED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Withdraw $500 with your Bunker key" })
    .click();
  await expect(page.getByText("$3,500", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(
    page.getByRole("button", { name: "Move assets into Bunker" }),
  ).toBeVisible();
});
test("security, documentation, verification and no horizontal overflow", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/vault",
    "/demo",
    "/check",
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
    page.getByText("No mainnet deployment", { exact: true }),
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
test("server rejects mainnet transaction submission", async ({ request }) => {
  const r = await request.post("/api/rpc", {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: ["AA=="],
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

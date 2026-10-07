import { test, expect } from "@playwright/test";
test("brand, navigation, release gate, and wallet empty state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Your assets. A stronger place to stay.",
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
    .getByRole("button", { name: "Simulate wallet compromise" })
    .click();
  await page
    .getByRole("button", { name: "Attempt unauthorized withdrawal" })
    .click();
  await expect(
    page.getByText("WITHDRAWAL REJECTED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Authorize $10,000 withdrawal" })
    .click();
  await expect(page.getByText("$240,000", { exact: true })).toBeVisible();
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
    "/security",
    "/docs",
    "/verify",
  ]) {
    await page.goto(path);
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

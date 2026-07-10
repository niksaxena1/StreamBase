import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const hasStoredAuth = (() => {
  try {
    return (
      JSON.parse(readFileSync("e2e/.auth/state.json", "utf8")).cookies?.length >
      0
    );
  } catch {
    return false;
  }
})();

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function navigate(page: Page, route: string) {
  try {
    await page.goto(route, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED"))
      throw error;
    await page.waitForLoadState("domcontentloaded");
  }
}

test("protected routes redirect to login", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F/);
  await expect(page.getByRole("heading", { name: "StreamBase" })).toBeVisible();
});

test.describe("authenticated analytics universes", () => {
  test.skip(
    (!email || !password) && !hasStoredAuth,
    "Configure credentials or a local service-role session to run authenticated universe tests",
  );

  test.beforeEach(async ({ page }) => {
    if (email && password) await login(page);
  });

  test("own catalog core routes render without blank screens", async ({
    page,
  }) => {
    const reset = await page.request.patch(
      "/api/user-settings/dataset-context",
      { data: { dataset_mode: "own" } },
    );
    expect(reset.ok()).toBeTruthy();
    for (const route of [
      "/",
      "/playlists",
      "/catalog",
      "/collectors",
      "/health",
    ]) {
      await navigate(page, route);
      await expect(page.locator("#main-content")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Rendering…");
      await expect(page.getByText("An unexpected error occurred")).toHaveCount(
        0,
      );
    }
  });

  test("competitor mode stays scoped across core routes", async ({ page }) => {
    const reset = await page.request.patch(
      "/api/user-settings/dataset-context",
      { data: { dataset_mode: "own" } },
    );
    expect(reset.ok()).toBeTruthy();
    await page.goto("/");
    const switcher = page
      .getByRole("button", { name: /competitor|catalog mode|dataset/i })
      .first();
    await expect(switcher).toBeVisible();
    await switcher.click();
    const competitorItems = page.getByRole("menuitem");
    expect(await competitorItems.count()).toBeGreaterThan(2);
    await competitorItems.nth(2).click();
    await expect(page.locator('[data-mode="competitor"]')).toBeVisible({
      timeout: 20_000,
    });
    for (const route of ["/", "/playlists", "/catalog", "/competitors"]) {
      await navigate(page, route);
      await expect(page.locator('[data-mode="competitor"]')).toBeVisible();
      await expect(page.getByText("An unexpected error occurred")).toHaveCount(
        0,
      );
    }
  });
});

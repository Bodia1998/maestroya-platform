import { expect, test } from "@playwright/test";

/**
 * Module 29 — Internationalization end-to-end.
 *
 * Kept at the same level as smoke.spec.ts (the only pre-existing e2e
 * file): public pages only, no fixtures, no seeded database — so it runs
 * against a plain `npm run build && npm run start` exactly like the
 * existing suite does. The signed-in half of the flow (the database
 * write) is covered by the integration tests, which do not need a
 * browser.
 */

test("a guest's language choice survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await page.getByRole("button", { name: "Idioma" }).click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // Persisted, not just re-rendered: a fresh navigation must come back in
  // English from the server, with no flash of Spanish.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Language" })).toBeVisible();
});

test("the browser's Accept-Language is honoured before any choice is made", async ({ browser }) => {
  const context = await browser.newContext({ locale: "pl-PL" });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");

  await context.close();
});

test("switching language does not sign the visitor out or navigate away", async ({ page }) => {
  await page.goto("/professionals");
  const url = page.url();

  await page.getByRole("button", { name: "Idioma" }).click();
  await page.getByRole("menuitemradio", { name: /Deutsch/ }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(page.url()).toBe(url);
});

import { test, expect, type Page } from "@playwright/test";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
test.describe("eligibility and manual booking journeys", () => {
  test.setTimeout(60000);
  test.skip(process.env.E2E_DEMO_READY !== "1", "Use local journey runner.");
  async function login(page: Page, customer = false) {
    await page.goto("/auth?returnTo=/parking");
    await page
      .getByLabel("Email")
      .fill(
        (customer ? process.env.E2E_CUSTOMER_EMAIL : process.env.E2E_EMAIL)!,
      );
    await page
      .getByLabel("Password")
      .fill(
        (customer
          ? process.env.E2E_CUSTOMER_PASSWORD
          : process.env.E2E_PASSWORD)!,
      );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your plans. Your parking bay." }),
    ).toBeVisible();
  }
  async function command(page: Page, path: string, body: unknown = {}) {
    const r = await page.request.post("/api/admin/demo/" + path, {
      headers: { origin },
      data: body,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return (await r.json()).data;
  }
  test("manual arrival and completion retain time and owner checks", async ({
    page,
  }) => {
    await login(page);
    const d = await command(page, "reset", { confirmation: "RESET" }),
      b = d.bookings.find(
        (b: { demo_scenario: string }) => b.demo_scenario === "A",
      );
    await page.goto("/bookings/" + b.id + "/arrival");
    await expect(
      page.getByRole("button", { name: "Simulate check-in", exact: true }),
    ).toBeDisabled();
    await command(page, "advance", { minutes: 5 });
    await page.getByRole("button", { name: "Refresh status" }).click();
    await page
      .getByRole("button", { name: "Simulate check-in", exact: true })
      .click();
    await expect(
      page.getByText("Parking in progress", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simulate departure / complete parking" })
      .click();
    await expect(
      page.getByText("completed", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('img[alt*="QR"]')).toHaveCount(0);
  });
  test("late unarrived booking releases through cleanup", async ({ page }) => {
    await login(page);
    const d = await command(page, "reset", { confirmation: "RESET" }),
      b = d.bookings.find(
        (b: { demo_scenario: string }) => b.demo_scenario === "A",
      );
    await command(page, "advance", { minutes: 40 });
    await command(page, "cleanup");
    await page.goto("/bookings/" + b.id);
    await expect(page.getByText("no show", { exact: true })).toBeVisible();
  });
  test("standard customer books a standard bay without eligibility", async ({
    page,
  }) => {
    await login(page, true);
    await page
      .getByRole("button", { name: "Use suggested visit times" })
      .click();
    await page.getByLabel("Bay category").selectOption("standard");
    await page
      .getByRole("button", { name: /^Select bay / })
      .first()
      .click();
    await page.getByRole("button", { name: "Review exact bay" }).click();
    const plate =
      "STD" +
      crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    await page.getByLabel("Vehicle plate", { exact: true }).fill(plate);
    await page
      .getByRole("button", {
        name: "Confirm your plate: " + plate,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Confirm exact bay", exact: true })
      .click();
    await expect(page).toHaveURL(/\/bookings\/[a-f0-9-]+$/);
    await page
      .getByRole("button", { name: "Cancel reservation · no fee" })
      .click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  });
  test("standard customer is blocked, receives mall approval and books exact OKU bay", async ({
    page,
    browser,
  }) => {
    await login(page, true);
    if (test.info().project.name === "mobile") {
      await page
        .getByRole("combobox", { name: "Choose your mall", exact: true })
        .click();
      await page.getByRole("option", { name: /Garden Square Mall/ }).click();
    }
    await page
      .getByRole("button", { name: "Use suggested visit times" })
      .click();
    await page.getByLabel("Bay category").selectOption("oku");
    await expect(
      page.getByRole("button", { name: /^Select bay / }),
    ).toHaveCount(0);
    await page
      .getByRole("group", { name: /Interactive fictional parking layout/ })
      .getByRole("button", { name: /OKU-only/ })
      .first()
      .click();
    await expect(
      page.getByText("Approved eligibility is required.", { exact: false }),
    ).toBeVisible();
    const mallIndex = test.info().project.name === "mobile" ? 1 : 0;
    await page.goto("/eligibility");
    await page
      .getByLabel("Mall", { exact: true })
      .selectOption({ index: mallIndex });
    await page
      .getByRole("button", { name: "Request simulated eligibility review" })
      .click();
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/admin/eligibility")).status()).toBe(
      403,
    );
    const ctx = await browser.newContext(),
      reviewer = await ctx.newPage();
    try {
      await login(reviewer);
      await reviewer.goto("/admin/eligibility");
      await reviewer
        .locator("article")
        .filter({ has: reviewer.getByText("pending", { exact: true }) })
        .getByRole("button", { name: "Approve demo request" })
        .first()
        .click();
      await expect(
        reviewer.getByText("Eligibility request updated."),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
    await page.goto("/eligibility");
    await page
      .getByLabel("Mall", { exact: true })
      .selectOption({ index: mallIndex });
    await expect(page.getByText("approved", { exact: true })).toBeVisible();
    if (process.env.CAPTURE_JOURNEY_VISUALS === "1")
      await page.screenshot({
        path: "artifacts/oku-eligibility-" + test.info().project.name + ".png",
        fullPage: true,
      });
    await page.goto("/parking");
    if (mallIndex === 1) {
      await page
        .getByRole("combobox", { name: "Choose your mall", exact: true })
        .click();
      await page.getByRole("option", { name: /Garden Square Mall/ }).click();
    }
    await page
      .getByRole("button", { name: "Use suggested visit times" })
      .click();
    await page.getByLabel("Bay category").selectOption("oku");
    await page
      .getByRole("button", { name: /^Select bay / })
      .first()
      .click();
    await page.getByRole("button", { name: "Review exact bay" }).click();
    const plate =
      "OKU" +
      crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    await page.getByLabel("Vehicle plate", { exact: true }).fill(plate);
    await page
      .getByRole("button", {
        name: "Confirm your plate: " + plate,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Confirm exact bay", exact: true })
      .click();
    await expect(page).toHaveURL(/\/bookings\/[a-f0-9-]+$/);
    await expect(
      page.getByText(/Simulated mall approval was recorded/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  test("gate route and endpoints are absent", async ({ page }) => {
    await login(page);
    expect(
      (
        await page.request.post("/api/admin/gate/entry", {
          headers: { origin },
          data: { plate: "ABC123", gateId: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(404);
    await page.goto("/admin/gate");
    await expect(
      page.getByRole("heading", { name: /not found/i }),
    ).toBeVisible();
  });
});

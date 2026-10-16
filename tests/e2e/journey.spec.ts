import { test, expect, type Page } from "@playwright/test";
const origin = "http://localhost:3000";
test.describe("real local database parking journey", () => {
  test.skip(
    process.env.E2E_DEMO_READY !== "1",
    "Run scripts/test-journey.mjs for isolated LOCAL auth and demo setup.",
  );
  async function signIn(page: Page) {
    await page.goto("/auth?returnTo=/");
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Less circling/ }),
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
  test("successful cinema + step-free journey through map, arrival and departure", async ({
    page,
  }) => {
    await signIn(page);
    await command(page, "reset", { confirmation: "RESET" });
    await page.reload();
    await page
      .getByLabel("Where are you headed?", { exact: false })
      .selectOption({ label: "Cinema" });
    await page.getByLabel("Route preference").selectOption("step_free");
    await page
      .getByRole("button", { name: "Find parking", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Choose zone" }).first().click();
    await page.getByRole("button", { name: "Confirm reservation" }).click();
    await expect(
      page.getByRole("heading", { name: "Your booking details" }),
    ).toBeVisible();
    await expect(
      page.getByText("Arrival deadline:", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByAltText("QR link to this booking’s authorized arrival screen"),
    ).toBeVisible();
    await page.getByRole("link", { name: "Find my parking zone" }).click();
    await expect(
      page.getByRole("heading", { name: "Driving: entrance → reserved zone" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Walking: lobby → destination" }),
    ).toBeVisible();
    await expect(
      page.getByText("Verified step-free demo route", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (process.env.CAPTURE_JOURNEY_VISUALS === "1")
      await page.screenshot({
        path: `artifacts/zone-${test.info().project.name}.png`,
        fullPage: true,
      });
    await page.getByRole("link", { name: "Open arrival screen" }).click();
    await expect(
      page.getByRole("button", { name: "Simulate check-in" }),
    ).toBeDisabled();
    await command(page, "advance", { minutes: 5 });
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByRole("button", { name: "Simulate check-in" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Simulate check-in" }).click();
    await expect(
      page.getByText("Parking in progress", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (process.env.CAPTURE_JOURNEY_VISUALS === "1")
      await page.screenshot({
        path: `artifacts/arrival-${test.info().project.name}.png`,
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Simulate departure / complete parking" })
      .click();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
  });
  test("no-show cleanup refreshes a focused booking, releases capacity and stores an explicit rebooking", async ({
    page,
  }) => {
    await signIn(page);
    const setup = await command(page, "reset", { confirmation: "RESET" });
    const b = setup.bookings.find(
      (r: { demo_scenario: string }) => r.demo_scenario === "B",
    );
    await page.goto("/bookings/" + b.id);
    await expect(page.getByText("confirmed", { exact: true })).toBeVisible();
    const query = new URLSearchParams({
      mallId: "10000000-0000-4000-8000-000000000001",
      startAt: "2030-01-15T02:12:00Z",
      endAt: "2030-01-15T03:00:00Z",
      preference: "none",
    });
    const before = (
      await (await page.request.get("/api/availability?" + query)).json()
    ).data.find(
      (z: { zoneName: string }) => z.zoneName === "Zone A",
    ).availableBayCount;
    await command(page, "advance", { minutes: 11 });
    await command(page, "cleanup");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("no show", { exact: true })).toBeVisible();
    const after = (
      await (await page.request.get("/api/availability?" + query)).json()
    ).data.find(
      (z: { zoneName: string }) => z.zoneName === "Zone A",
    ).availableBayCount;
    expect(after).toBe(before + 1);
    await page.goto("/admin/demo");
    await page
      .getByRole("button", { name: "Book the remaining interval" })
      .click();
    await expect(
      page.getByText("A subsequent booking was stored.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("explicit subsequent booking", { exact: false }),
    ).toBeVisible();
  });
  test("late arrival is rejected by the API and offers a new search without restoring the old booking", async ({
    page,
  }) => {
    await signIn(page);
    const setup = await command(page, "reset", { confirmation: "RESET" });
    const b = setup.bookings.find(
      (r: { demo_scenario: string }) => r.demo_scenario === "B",
    );
    await command(page, "advance", { minutes: 11 });
    await command(page, "cleanup");
    const r = await page.request.post(
      "/api/arrival/" + b.check_in_token + "/check-in",
      { headers: { origin }, data: { now: "2030-01-15T02:00:00Z" } },
    );
    expect(r.status()).toBe(409);
    expect((await r.json()).error.message).toContain(
      "released after the arrival deadline",
    );
    await page.goto("/arrival/" + b.check_in_token);
    await expect(
      page.getByRole("button", { name: "Simulate check-in" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: "Search again and create a new booking.",
      }),
    ).toBeVisible();
    await expect(page.getByText("no show", { exact: true })).toBeVisible();
  });
});
test("public story labels hypotheses and illustrative voice honestly", async ({
  page,
}) => {
  await page.goto("/demo-story");
  await expect(page.getByText("01 · Problem hypotheses")).toBeVisible();
  await expect(
    page.getByText("Illustrative user statement — not a research interview", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Scheduled minutes released in simulation", { exact: true }),
  ).toBeVisible();
});

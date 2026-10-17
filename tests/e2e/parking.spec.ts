import { test, expect, type Page } from "@playwright/test";
import { instantInMall, localInMall, preferenceKeys } from "../../lib/parking";
const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
test.describe("exact numbered-bay booking with real local persistence", () => {
  test.setTimeout(60000);
  test.skip(
    process.env.E2E_DEMO_READY !== "1",
    "Use the isolated local journey runner.",
  );
  async function login(page: Page) {
    await page.goto("/auth?returnTo=/parking");
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
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
  async function confirmPlate(page: Page) {
    const value =
      "MAP" +
      crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    await page.getByLabel("Vehicle plate", { exact: true }).fill(value);
    await page
      .getByRole("button", {
        name: "Confirm your plate: " + value,
        exact: true,
      })
      .click();
  }
  async function suggested(page: Page) {
    await expect(
      page.getByRole("button", { name: "Use suggested visit times" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Use suggested visit times" })
      .click();
    await expect(
      page.getByText(/bays available for this interval/),
    ).toBeVisible();
  }
  async function firstBay(page: Page) {
    const button = page.getByRole("button", { name: /^Select bay / }).first();
    await expect(button).toBeVisible();
    const label = (await button.innerText()).replace("Select bay ", "").trim();
    await button.click();
    return label;
  }
  async function visitInput(page: Page) {
    return {
      mallId: "10000000-0000-4000-8000-000000000001",
      startAt: instantInMall(
        await page.getByLabel("Arrival · mall time").inputValue(),
        "Asia/Kuala_Lumpur",
      ),
      endAt: instantInMall(
        await page.getByLabel("Departure · mall time").inputValue(),
        "Asia/Kuala_Lumpur",
      ),
      destinationId: null,
      selectedPreferences: [],
      requiredPreferences: [],
    };
  }
  test("map shows neutral numbered bays before dates; floor and mall changes clear stale choices", async ({
    page,
  }) => {
    await login(page);
    const map = page.getByRole("group", {
      name: /Interactive fictional parking layout/,
    });
    await expect(map).toBeVisible();
    await expect(
      map.getByRole("button", { name: /^Bay B1-A01,/ }),
    ).toBeVisible();
    await expect(
      map.getByRole("button", { name: /Unknown/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Select this bay" }),
    ).toHaveCount(0);
    await page
      .getByRole("group", { name: "Parking floors", exact: true })
      .getByRole("button", { name: "B2", exact: true })
      .click();
    await expect(
      page.getByRole("group", {
        name: /Interactive fictional parking layout.*floor B2/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Bay B2-A01,/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Bay B1-A01,/ }),
    ).toHaveCount(0);
    await suggested(page);
    await firstBay(page);
    await expect(
      page.getByRole("button", { name: "Review exact bay" }),
    ).toBeEnabled();
    await page
      .getByLabel("Destination", { exact: true })
      .selectOption({ label: "Cinema" });
    await page.getByRole("checkbox", { name: /^Near a lift lobby/ }).check();
    await page
      .getByRole("combobox", { name: "Choose your mall", exact: true })
      .click();
    await page.getByRole("option", { name: /Garden Square Mall/ }).click();
    await expect(
      page.getByRole("button", { name: "Review exact bay" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Destination", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByRole("checkbox", { name: /^Near a lift lobby/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("group", {
        name: /Interactive fictional parking layout, Garden Square Mall, floor B1/,
      }),
    ).toBeVisible();
  });
  test("all preferences remain selected, competing must-haves show an empty state, and relaxing them is explicit", async ({
    page,
  }) => {
    await login(page);
    await suggested(page);
    await page
      .getByLabel("Destination", { exact: true })
      .selectOption({ label: "Cinema" });
    const names = [
      "Shorter walk",
      "Verified step-free route",
      "Near a lift lobby",
      "Near a vehicle exit",
      "Wider standard bay",
      "Near a pedestrian walkway",
    ];
    for (const name of names)
      await page
        .getByRole("checkbox", { name: new RegExp("^" + name) })
        .check();
    await page
      .getByRole("checkbox", {
        name: "Must have: Near a lift lobby",
        exact: true,
      })
      .check();
    await page
      .getByRole("checkbox", {
        name: "Must have: Near a vehicle exit",
        exact: true,
      })
      .check();
    await expect(
      page.getByText("No available bays meet all your required preferences.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of names)
      await expect(
        page.getByRole("checkbox", { name: new RegExp("^" + name) }),
      ).toBeChecked();
    await page
      .getByRole("button", { name: "Clear must-haves, keep nice-to-haves" })
      .click();
    await expect(
      page.getByRole("button", { name: /^Select bay / }).first(),
    ).toBeVisible();
    for (const name of names)
      await expect(
        page.getByRole("checkbox", { name: new RegExp("^" + name) }),
      ).toBeChecked();
    expect(preferenceKeys).toHaveLength(names.length);
  });
  test("choose another mall, select preferences and an exact map bay, then use existing arrival and completion", async ({
    page,
  }) => {
    await login(page);
    await command(page, "reset", { confirmation: "RESET" });
    await page.reload();
    await page
      .getByRole("combobox", { name: "Choose your mall", exact: true })
      .click();
    await page.getByRole("option", { name: /Skyline Galleria/ }).click();
    await suggested(page);
    await page
      .getByLabel("Destination", { exact: true })
      .selectOption({ label: "Cinema" });
    for (const name of [
      "Verified step-free route",
      "Near a lift lobby",
      "Wider standard bay",
    ])
      await page
        .getByRole("checkbox", { name: new RegExp("^" + name) })
        .check();
    await page
      .getByRole("checkbox", {
        name: "Must have: Verified step-free route",
        exact: true,
      })
      .check();
    const label = await firstBay(page);
    await expect(
      page.getByRole("button", { name: "Review exact bay" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Review exact bay" }).click();
    await expect(
      page.getByRole("heading", { name: "Review your exact bay" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Booking review" }),
    ).toContainText(label);
    await expect(
      page.getByRole("region", { name: "Booking review" }),
    ).toContainText("Must have");
    if (process.env.CAPTURE_JOURNEY_VISUALS === "1")
      await page.screenshot({
        path: `artifacts/numbered-map-${test.info().project.name}.png`,
        fullPage: true,
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await confirmPlate(page);
    await page
      .getByRole("button", { name: "Confirm exact bay", exact: true })
      .click();
    await expect(page).toHaveURL(/\/bookings\/[a-f0-9-]+$/);
    const id = page.url().split("/").pop();
    const details = (
      await (await page.request.get("/api/reservations/" + id)).json()
    ).data;
    expect(details.bays.label).toBe(label);
    expect(details.bays.zones.malls.name).toBe("Skyline Galleria");
    expect(details.booking_mode).toBe("exact");
    expect(details.required_preferences).toEqual(["step_free"]);
    await expect(
      page.getByRole("heading", { name: "Preferences saved at booking" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Find my parking zone" }).click();
    await expect(
      page.getByRole("group", {
        name: /Interactive fictional parking layout, Skyline Galleria/,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("bay-" + details.bay_id)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("link", { name: "Manual arrival fallback" }).click();
    await expect(page).toHaveURL(/\/bookings\/[a-f0-9-]+\/arrival$/);
    await expect(
      page.getByRole("heading", { name: "Your arrival screen", exact: true }),
    ).toBeVisible();
    await command(page, "advance", { minutes: 5 });
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByRole("button", { name: "Simulate check-in" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Simulate check-in" }).click();
    await page
      .getByRole("button", { name: "Simulate departure / complete parking" })
      .click();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
  });
  test("list view and keyboard inspection provide equivalent exact-bay booking and cancellation", async ({
    page,
  }) => {
    await login(page);
    await page
      .getByRole("combobox", { name: "Choose your mall", exact: true })
      .click();
    await page
      .getByRole("option", { name: /Riverside Shopping Centre/ })
      .click();
    await suggested(page);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    const bay = page
      .getByRole("list", { name: "Bays on this floor" })
      .getByRole("button", { name: /Available for selected time/ })
      .first();
    const label = (await bay.innerText()).split("\n")[0].trim();
    await bay.focus();
    await bay.press("Enter");
    await page
      .getByRole("button", { name: "Select this bay", exact: true })
      .click();
    await page.getByRole("button", { name: "Review exact bay" }).click();
    await confirmPlate(page);
    await page
      .getByRole("button", { name: "Confirm exact bay", exact: true })
      .click();
    await expect(page).toHaveURL(/\/bookings\/[a-f0-9-]+$/);
    await expect(
      page.getByRole("heading", { name: label, exact: true, level: 2 }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel reservation · no fee" })
      .click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  });
  test("a second authenticated session gets a conflict, clears its selection and refreshes instead of substituting", async ({
    page,
    browser,
  }) => {
    await login(page);
    await suggested(page);
    const label = await firstBay(page);
    await page.getByRole("button", { name: "Review exact bay" }).click();
    const body = await visitInput(page);
    const rec = (
      await (
        await page.request.post("/api/recommendations", {
          headers: { origin },
          data: body,
        })
      ).json()
    ).data;
    const chosen = rec.bays.find((b: { label: string }) => b.label === label);
    const other = await browser.newContext();
    try {
      const p = await other.newPage();
      await login(p);
      const booked = await p.request.post("/api/reservations", {
        headers: { origin },
        data: {
          ...body,
          plate: "R" + crypto.randomUUID().replaceAll("-", "").slice(0, 12),
          bayId: chosen.id,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      expect(booked.ok(), await booked.text()).toBe(true);
      await confirmPlate(page);
      await page
        .getByRole("button", { name: "Confirm exact bay", exact: true })
        .click();
      await expect(page.getByText(/selected bay was cleared/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review exact bay" }),
      ).toHaveCount(0);
      await expect(page.getByTestId("bay-" + chosen.id)).toHaveAttribute(
        "aria-label",
        /Reserved during/,
      );
    } finally {
      await other.close();
    }
  });
  test("no-show release refreshes the exact numbered bay from reserved to available", async ({
    page,
  }) => {
    await login(page);
    const setup = await command(page, "reset", { confirmation: "RESET" });
    const fixture = setup.bookings.find(
      (b: {
        demo_scenario: string;
        bays: { zones: { malls: { name: string } } };
      }) =>
        b.demo_scenario === "B" &&
        b.bays.zones.malls.name === "Demo Central Mall",
    );
    await page.reload();
    const base = Date.parse(setup.clock.now);
    await page
      .getByLabel("Arrival · mall time")
      .fill(
        localInMall(
          new Date(base + 30 * 60000).toISOString(),
          "Asia/Kuala_Lumpur",
        ),
      );
    await page
      .getByLabel("Departure · mall time")
      .fill(
        localInMall(
          new Date(base + 120 * 60000).toISOString(),
          "Asia/Kuala_Lumpur",
        ),
      );
    await expect(page.getByTestId("bay-" + fixture.bay_id)).toHaveAttribute(
      "aria-label",
      /Reserved during/,
    );
    await command(page, "advance", { minutes: 26 });
    await command(page, "cleanup");
    await page.getByRole("button", { name: "Refresh availability" }).click();
    await expect(page.getByTestId("bay-" + fixture.bay_id)).toHaveAttribute(
      "aria-label",
      /Available for selected time/,
    );
  });
});

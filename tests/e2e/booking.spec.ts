import { test, expect } from "@playwright/test";
const localAuthConfigured =
  !!process.env.E2E_EMAIL &&
  !!process.env.E2E_PASSWORD &&
  /^http:\/\/(localhost|127\.0\.0\.1):/.test(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  );
test("search is responsive and shows honest configuration state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Less circling. More getting there." }),
  ).toBeVisible();
  await expect(
    page.getByText("Demo: availability is based on reservations", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test.describe("configured local Supabase", () => {
  test.skip(
    !localAuthConfigured,
    "Set E2E_EMAIL and E2E_PASSWORD for a confirmed local customer.",
  );
  test("sign in → search → review → confirmation → own bookings → cancel", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .click();
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: /Less circling/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Find parking", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Choose zone" }).first().click();
    await page.getByRole("button", { name: "Confirm reservation" }).click();
    await expect(
      page.getByRole("heading", { name: "Your booking details" }),
    ).toBeVisible();
    await expect(page.getByText("Reference:", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "My bookings" }).click();
    await page.getByRole("button", { name: "Details" }).first().click();
    await page
      .getByRole("button", { name: "Cancel reservation · no fee" })
      .click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  });
});

test("shows no available zones without claiming success", async ({ page }) => {
  await page.route("**/api/malls", (r) =>
    r.fulfill({
      json: {
        data: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "Demo Central Mall",
          },
        ],
      },
    }),
  );
  await page.route("**/api/malls/*/destinations", (r) =>
    r.fulfill({
      json: {
        data: [{ id: "30000000-0000-4000-8000-000000000001", name: "Cinema" }],
      },
    }),
  );
  await page.route("**/api/recommendations?*", (r) =>
    r.fulfill({ json: { data: [] } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find parking", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "No available zones" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit search", exact: true })
    .last()
    .click();
  await page
    .getByLabel("Where are you headed?", { exact: false })
    .selectOption("30000000-0000-4000-8000-000000000001");
  await page.getByLabel("Route preference").selectOption("step_free");
  await page
    .getByRole("button", { name: "Find parking", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "No suitable verified step-free route" }),
  ).toBeVisible();
});

test("reports an allocation conflict after recommendations without showing a confirmation", async ({
  page,
}) => {
  test.skip(
    !localAuthConfigured,
    "Requires a confirmed local customer. Only the final conflict response is stubbed.",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: /Less circling/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Find parking", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Choose zone" }).first().click();
  await page.route("**/api/reservations", (r) =>
    r.fulfill({
      status: 409,
      json: {
        error: {
          code: "CONFLICT",
          message: "Availability changed. Search again.",
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Availability changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your booking details" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm reservation" }),
  ).toBeEnabled();
});

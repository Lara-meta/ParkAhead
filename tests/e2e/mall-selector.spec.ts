import { test, expect, type Page } from "@playwright/test";
import type { Mall } from "../../lib/parking";
const uuid = (n: number) =>
  `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Explicit UI fixtures only: production selection continues to use /api/malls.
const malls: Mall[] = [
  "Demo Central Mall",
  "Garden Square Mall",
  "Riverside Shopping Centre",
  "Inactive Mall",
].map((name, i) => ({
  id: uuid(i + 1),
  name,
  description: "Fixture description must not become a large selection card.",
  timezone: "Asia/Kuala_Lumpur",
  layout_key: null,
  is_demo: true,
  is_active: i !== 3,
  parking_floors: [
    {
      id: uuid(i + 11),
      mall_id: uuid(i + 1),
      name: "B1",
      sort_order: 1,
      map_width: 800,
      map_height: 600,
      is_active: true,
    },
  ],
  destinations: [
    { id: uuid(i + 21), name: "Cinema" },
    { id: uuid(i + 31), name: "Supermarket" },
  ],
}));
const trigger = (page: Page) =>
  page.getByRole("combobox", { name: "Choose your mall", exact: true });
async function catalog(
  page: Page,
  options: { rows?: Mall[]; failFirst?: boolean; wait?: Promise<void> } = {},
) {
  let calls = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/malls") {
      calls++;
      if (options.wait) await options.wait;
      if (options.failFirst && calls === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Unavailable" } },
        });
      return route.fulfill({ json: { data: options.rows ?? malls } });
    }
    if (path === "/api/clock")
      return route.fulfill({
        json: {
          data: {
            demoMode: true,
            mallDemo: true,
            now: "2030-01-15T02:00:00Z",
            realNow: "2030-01-15T02:00:00Z",
            graceMinutes: 30,
          },
        },
      });
    if (path.endsWith("/preferences"))
      return route.fulfill({ json: { data: [] } });
    if (path.includes("/map")) {
      const m = malls.find((m) => m.id === url.searchParams.get("mallId"))!;
      return route.fulfill({
        json: {
          data: {
            mall: m,
            floor: m.parking_floors[0],
            zones: [],
            bays: [],
            features: [],
          },
        },
      });
    }
    if (path === "/api/recommendations")
      return route.fulfill({
        json: {
          data: {
            serverNow: "2030-01-15T02:00:00Z",
            bays: [],
            algorithmVersion: "fixture",
          },
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { message: "Unknown test route" } },
    });
  });
  return () => calls;
}
test("mall search is local, name-only and separate from the selected mall", async ({
  page,
}) => {
  const calls = await catalog(page);
  await page.goto("/parking");
  await expect(trigger(page)).toContainText("Demo Central Mall");
  await page.getByLabel("Arrival · mall time").fill("2030-01-15T11:00");
  await page.getByLabel("Departure · mall time").fill("2030-01-15T13:00");
  await page
    .getByLabel("Destination", { exact: true })
    .selectOption(malls[0].destinations[0].id);
  const before = calls();
  await trigger(page).click();
  const search = page.getByRole("searchbox", { name: "Search malls by name" });
  await expect(search).toBeFocused();
  await expect(
    page.getByRole("listbox", { name: "Matching malls" }).getByRole("option"),
  ).toHaveCount(3);
  await expect(
    page
      .getByRole("listbox", { name: "Matching malls" })
      .getByRole("option", { selected: true }),
  ).toContainText("Demo Central Mall");
  await expect(page.getByLabel("Selected", { exact: true })).toBeVisible();
  await search.fill("  gArDeN  ");
  await expect(
    page.getByRole("listbox", { name: "Matching malls" }).getByRole("option"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("listbox", { name: "Matching malls" }).getByRole("option"),
  ).toContainText("Garden Square Mall");
  await expect(trigger(page)).toContainText("Demo Central Mall");
  await search.fill("Cinema");
  await expect(page.getByText("No malls found for ‘Cinema’.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toBeFocused();
  await expect(
    page.getByRole("listbox", { name: "Matching malls" }).getByRole("option"),
  ).toHaveCount(3);
  expect(calls()).toBe(before);
  await search.press("Escape");
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByLabel("Destination", { exact: true })).toHaveValue(
    malls[0].destinations[0].id,
  );
  await trigger(page).click();
  await page
    .getByRole("listbox", { name: "Matching malls" })
    .getByRole("option", { name: /Demo Central Mall/ })
    .click();
  await expect(page.getByLabel("Arrival · mall time")).toHaveValue(
    "2030-01-15T11:00",
  );
  await expect(page.getByLabel("Destination", { exact: true })).toHaveValue(
    malls[0].destinations[0].id,
  );
  await trigger(page).click();
  await page
    .getByRole("listbox", { name: "Matching malls" })
    .getByRole("option", { name: /Garden Square Mall/ })
    .click();
  await expect(trigger(page)).toContainText("Garden Square Mall");
  await expect(
    page.getByRole("combobox", { name: "Destination", exact: true }),
  ).toHaveValue("");
  await expect(page.getByLabel("Selected mall summary")).toContainText(
    "Garden Square Mall",
  );
  await expect(page.getByLabel("Selected mall summary")).toContainText(
    "Cinema, Supermarket",
  );
  await expect(page.getByLabel("Arrival · mall time")).toHaveValue(
    "2030-01-15T11:00",
  );
  await trigger(page).click();
  await expect(search).toHaveValue("");
  await page.getByRole("heading", { name: "01 · Choose your mall" }).click();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toContainText("Garden Square Mall");
  await expect(
    page.getByRole("button", { name: /Choose this mall/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText(malls[0].description, { exact: true }),
  ).toHaveCount(0);
});
test("keyboard opens, navigates and selects; popup fits the viewport with long names", async ({
  page,
}) => {
  const rows = structuredClone(malls);
  rows[2].name = "Riverside " + "Long Mall Name ".repeat(12);
  await catalog(page, { rows });
  await page.goto("/parking");
  await expect(trigger(page)).toBeEnabled();
  await trigger(page).focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("searchbox", { name: "Search malls by name" });
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(trigger(page)).toContainText("Garden Square Mall");
  await expect(trigger(page)).toBeFocused();
  await trigger(page).click();
  await search.fill("riverside");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(trigger(page)).toContainText(rows[2].name);
  await expect(page.getByLabel("Selected mall summary")).toContainText(
    rows[2].name,
  );
  await trigger(page).click();
  const box = await page
      .getByRole("dialog", { name: "Select a mall" })
      .boundingBox(),
    viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.env.CAPTURE_JOURNEY_VISUALS === "1")
    await page.screenshot({
      path: `artifacts/mall-selector-${test.info().project.name}.png`,
      fullPage: true,
    });
  await search.press("Escape");
  // Reposition above the trigger when the lower viewport has insufficient space.
  await page.setViewportSize({ width: viewport.width, height: 600 });
  await trigger(page).evaluate((el) =>
    window.scrollBy(0, el.getBoundingClientRect().top - 500),
  );
  await trigger(page).click();
  const popup = await page
    .getByRole("dialog", { name: "Select a mall" })
    .boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(0);
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(600);
});
test("loading, failure with retry, and an empty catalog stay compact and distinct", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  await catalog(page, { wait, failFirst: true });
  await page.goto("/parking");
  await expect(trigger(page)).toBeDisabled();
  await expect(page.getByText("Loading mall catalog…")).toBeVisible();
  release();
  await expect(
    page.getByText("Unable to load malls.", { exact: true }),
  ).toBeVisible();
  await expect(trigger(page)).toBeDisabled();
  await page.getByRole("button", { name: "Retry loading malls" }).click();
  await expect(trigger(page)).toContainText("Demo Central Mall");
  await expect(trigger(page)).toBeEnabled();
  await page.unroute("**/api/**");
  await catalog(page, { rows: [] });
  await page.reload();
  await expect(
    page.getByText("No malls are currently available."),
  ).toBeVisible();
  await expect(trigger(page)).toBeDisabled();
  await expect(page.getByLabel("Selected mall summary")).toHaveCount(0);
});
test("valid restored mall and form values survive mount; inactive restored mall requires selection", async ({
  page,
}) => {
  await catalog(page);
  const params = new URLSearchParams({
    mallId: malls[1].id,
    destinationId: malls[1].destinations[0].id,
    startAt: "2030-01-15T03:00:00Z",
    endAt: "2030-01-15T05:00:00Z",
  });
  await page.goto("/parking?" + params);
  await expect(trigger(page)).toContainText("Garden Square Mall");
  await expect(page.getByLabel("Arrival · mall time")).toHaveValue(
    "2030-01-15T11:00",
  );
  await expect(page.getByLabel("Destination", { exact: true })).toHaveValue(
    malls[1].destinations[0].id,
  );
  await page.goto("/parking?mallId=" + malls[3].id);
  await expect(trigger(page)).toContainText("Search or select a mall…");
  await expect(
    page.getByText(
      "Your saved mall is no longer available. Choose a mall to plan your visit.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Selected mall summary")).toHaveCount(0);
  await expect(page.getByLabel("Arrival · mall time")).toHaveCount(0);
  await trigger(page).click();
  await page
    .getByRole("listbox", { name: "Matching malls" })
    .getByRole("option", { name: /Demo Central Mall/ })
    .click();
  await expect(page.getByLabel("Arrival · mall time")).toBeVisible();
});

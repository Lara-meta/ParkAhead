import { describe, it, expect } from "vitest";
import {
  intervalError,
  overlaps,
  recommend,
  canCancel,
  canTransition,
  mallInstant,
  searchSchema,
  type Zone,
} from "../../lib/rules";
const now = Date.parse("2026-10-15T00:00:00Z");
const stamp = (minutes: number) =>
  new Date(now + minutes * 60000).toISOString();
describe("booking time rules", () => {
  it.each([
    [60, 90, null],
    [60, 89, "Minimum"],
    [60, 540, null],
    [60, 541, "Maximum"],
    [0, 60, "future"],
    [43201, 43261, "30 days"],
    [60, 30, "Minimum"],
  ])("validates interval %s–%s", (s, e, error) => {
    const v = intervalError(stamp(s as number), stamp(e as number), now);
    if (error) expect(v).toContain(error);
    else expect(v).toBeNull();
  });
  it("rejects invalid instants", () =>
    expect(intervalError("bad", "bad", now)).toBeTruthy());
  it("uses Kuala Lumpur regardless of browser timezone", () =>
    expect(mallInstant("2026-10-16T10:00")).toBe("2026-10-16T02:00:00.000Z"));
  it("requires destination for step-free", () =>
    expect(
      searchSchema.safeParse({
        mallId: "10000000-0000-4000-8000-000000000001",
        startAt: new Date(Date.now() + 3600000).toISOString(),
        endAt: new Date(Date.now() + 7200000).toISOString(),
        preference: "step_free",
      }).success,
    ).toBe(false));
  it("handles overlap, containment, adjacency", () => {
    expect(overlaps(1, 5, 2, 3)).toBe(true);
    expect(overlaps(2, 3, 1, 5)).toBe(true);
    expect(overlaps(1, 2, 2, 3)).toBe(false);
  });
});
const zone = (
  name: string,
  d: number | null,
  verified = true,
  stepFree: boolean | null = true,
  count = 2,
): Zone => ({
  zoneId: name,
  zoneName: name,
  floor: "B1",
  walkingDistanceM: d,
  verified,
  stepFree,
  availableBayCount: count,
});
describe("recommendations", () => {
  const zones = [
    zone("C", 0, false, null),
    zone("B", 80),
    zone("A", 200),
    zone("D", 10, true, true, 0),
  ];
  it("ranks verified known distances before unknown", () =>
    expect(recommend(zones, "shorter_walk").map((z) => z.zoneName)).toEqual([
      "B",
      "A",
      "C",
    ]));
  it("does not expose unknown distance as zero", () =>
    expect(
      recommend(zones, "none").find((z) => z.zoneName === "C")
        ?.walkingDistanceM,
    ).toBeNull());
  it("filters step-free and full zones", () =>
    expect(
      recommend([...zones, zone("E", 10, true, false)], "step_free").map(
        (z) => z.zoneName,
      ),
    ).toEqual(["B", "A"]));
  it("returns empty when nothing qualifies", () =>
    expect(recommend([zone("C", 0, false, true)], "step_free")).toEqual([]));
  it("orders no preference alphabetically", () =>
    expect(recommend(zones, "none").map((z) => z.zoneName)).toEqual([
      "A",
      "B",
      "C",
    ]));
});
it("only allows early confirmed cancellation", () => {
  expect(canCancel("confirmed", stamp(1), now)).toBe(true);
  expect(canCancel("confirmed", stamp(0), now)).toBe(false);
  expect(canCancel("checked_in", stamp(1), now)).toBe(false);
});
it("enforces transition graph and no-show timing", () => {
  expect(
    canTransition("confirmed", "checked_in", stamp(20), now, stamp(-1)),
  ).toBe(true);
  expect(canTransition("checked_in", "completed", stamp(20), now)).toBe(true);
  expect(canTransition("confirmed", "completed", stamp(20), now)).toBe(false);
  expect(canTransition("confirmed", "no_show", stamp(20), now)).toBe(false);
  expect(canTransition("confirmed", "no_show", stamp(-1), now)).toBe(true);
});

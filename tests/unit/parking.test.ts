import { describe, it, expect } from "vitest";
import {
  parkingRequestSchema,
  exactBookingSchema,
  preferenceKeys,
  geometrySchema,
  instantInMall,
  localInMall,
  sortRecommendations,
  statusDescription,
  matchSummary,
  type BayAvailability,
} from "../../lib/parking";
const base = {
  mallId: "10000000-0000-4000-8000-000000000001",
  destinationId: "30000000-0000-4000-8000-000000000001",
  startAt: "2030-01-15T02:00:00Z",
  endAt: "2030-01-15T03:00:00Z",
};
it.each([
  { keys: [] },
  { keys: ["near_lift"] },
  { keys: ["near_lift", "near_exit", "wider_bay"] },
  { keys: [...preferenceKeys] },
])("accepts any supported preference set: $keys", ({ keys }) => {
  expect(
    parkingRequestSchema.safeParse({ ...base, selectedPreferences: keys })
      .success,
  ).toBe(true);
});
it("rejects unknown, duplicate, unsupported hard constraints and missing destination", () => {
  for (const selectedPreferences of [
    ["safest_bay"],
    ["near_lift", "near_lift"],
  ])
    expect(
      parkingRequestSchema.safeParse({ ...base, selectedPreferences }).success,
    ).toBe(false);
  expect(
    parkingRequestSchema.safeParse({
      ...base,
      selectedPreferences: ["shorter_walk"],
      requiredPreferences: ["shorter_walk"],
    }).success,
  ).toBe(false);
  expect(
    parkingRequestSchema.safeParse({
      ...base,
      selectedPreferences: [],
      requiredPreferences: ["near_exit"],
    }).success,
  ).toBe(false);
  expect(
    parkingRequestSchema.safeParse({
      ...base,
      destinationId: null,
      selectedPreferences: ["step_free"],
    }).success,
  ).toBe(false);
});
it("does not accept a client score or availability assertion on booking", () => {
  const body = {
    ...base,
    plate: "ABC0123",
    bayId: "40000000-0000-4000-8000-000000000001",
    idempotencyKey: "50000000-0000-4000-8000-000000000001",
  };
  expect(exactBookingSchema.safeParse(body).success).toBe(true);
  expect(
    exactBookingSchema.safeParse({ ...body, score: 1, status: "available" })
      .success,
  ).toBe(false);
});
it("does not use a preference explanation to claim availability", () => {
  expect(
    matchSummary({ totalCount: 0 } as BayAvailability["evaluation"]),
  ).not.toMatch(/available/i);
});
it("uses explicit mall timezone conversions independently of browser timezone", () => {
  expect(instantInMall("2030-01-15T10:00", "Asia/Kuala_Lumpur")).toBe(
    "2030-01-15T02:00:00.000Z",
  );
  expect(localInMall("2030-01-15T02:00:00Z", "Asia/Bangkok")).toBe(
    "2030-01-15T09:00",
  );
  expect(() => instantInMall("2030-03-10T02:30", "America/New_York")).toThrow();
});
it("accepts only known numeric geometry, never stored HTML/SVG", () => {
  expect(
    geometrySchema.safeParse({
      kind: "rect",
      x: 10,
      y: 20,
      width: 50,
      height: 80,
    }).success,
  ).toBe(true);
  expect(
    geometrySchema.safeParse({
      kind: "polyline",
      points: [
        [1, 2],
        [3, 4],
      ],
    }).success,
  ).toBe(true);
  for (const g of [
    { kind: "svg", html: "<script/>" },
    { kind: "rect", x: 0, y: 0, width: -1, height: 10 },
    { kind: "point", x: "0", y: 0 },
  ])
    expect(geometrySchema.safeParse(g).success).toBe(false);
});
describe("separate availability and recommendations", () => {
  const bay = (
    label: string,
    score: number,
    status = "available",
    eligible = true,
  ) =>
    ({
      label,
      id: label,
      status,
      eligible,
      evaluation: { score },
    }) as BayAvailability;
  it("never ranks reserved or ineligible bays above bookable bays", () => {
    expect(
      sortRecommendations([
        bay("B", 0.5),
        bay("A", 0.5),
        bay("C", 1, "reserved"),
        bay("D", 1, "available", false),
      ]).map((b) => b.label),
    ).toEqual(["A", "B"]);
  });
  it("unknown and reserved descriptions never claim physical occupancy", () => {
    expect(statusDescription("unknown")).toContain("Unknown");
    expect(statusDescription("reserved")).toContain("selected time");
    expect(statusDescription("reserved")).not.toContain("occupied");
  });
});

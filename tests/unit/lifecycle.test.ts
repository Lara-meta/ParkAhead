import { describe, it, expect } from "vitest";
import {
  arrivalEligible,
  releaseEligible,
  reminder,
  releasedMinutes,
  isFinal,
  navigationInstructions,
  type JourneyBooking,
} from "../../lib/lifecycle";
const start = "2030-01-15T02:00:00Z",
  deadline = "2030-01-15T02:15:00Z";
const booking = {
  status: "confirmed",
  start_at: start,
  arrival_deadline: deadline,
};
describe("arrival window boundaries", () => {
  it.each([
    [-1, false],
    [0, true],
    [899999, true],
    [900000, false],
    [900001, false],
  ])("check-in at start + %s ms", (offset, expected) => {
    expect(arrivalEligible(booking, Date.parse(start) + offset)).toBe(expected);
  });
  it("release starts exactly at deadline", () => {
    expect(releaseEligible(booking, Date.parse(deadline) - 1)).toBe(false);
    expect(releaseEligible(booking, Date.parse(deadline))).toBe(true);
  });
  it.each(["checked_in", "completed", "cancelled", "no_show"])(
    "%s cannot be checked in or released",
    (status) => {
      const b = { ...booking, status };
      expect(arrivalEligible(b, Date.parse(start))).toBe(false);
      expect(releaseEligible(b, Date.parse(deadline) + 1)).toBe(false);
    },
  );
});
it("keeps expired countdown honest", () => {
  expect(reminder(booking, Date.parse(deadline))).toContain("deadline passed");
  expect(
    reminder({ ...booking, status: "no_show" }, Date.parse(deadline)),
  ).toContain("released");
  expect(reminder(booking, Date.parse(start) - 60000)).toContain(
    "starts in 1 minute",
  );
  expect(reminder(booking, Date.parse(start))).toContain("within 15 minutes");
});
it("recognizes final states", () => {
  expect(isFinal("no_show")).toBe(true);
  expect(isFinal("completed")).toBe(true);
  expect(isFinal("cancelled")).toBe(true);
  expect(isFinal("checked_in")).toBe(false);
});
it("released scheduled minutes cannot be negative", () => {
  expect(releasedMinutes("2030-01-15T03:00:00Z", deadline)).toBe(45);
  expect(releasedMinutes(start, deadline)).toBe(0);
});
const location = {
  bays: {
    label: "B-07",
    zones: { id: "b", name: "Zone B", floor: "B1", malls: { name: "Demo" } },
  },
  destinations: { name: "Cinema" },
  guidance: {
    vehicle_entrance: "East Entrance",
    lift_lobby: "Lift Lobby 2",
    driving_instructions: [
      "Enter using the East Entrance.",
      "Follow vehicle signs to B1.",
    ],
  },
  route: {
    is_verified: true,
    is_step_free: true,
    walking_distance_m: 80,
    route_description: "Fictional pedestrian corridor.",
  },
} satisfies Pick<
  JourneyBooking,
  "bays" | "destinations" | "guidance" | "route"
>;
it("keeps driving and walking directions distinct and the bay correct", () => {
  const nav = navigationInstructions(location);
  expect(nav.driving.join(" ")).toContain("B-07");
  expect(nav.driving.join(" ")).not.toContain("pedestrian");
  expect(nav.walking.join(" ")).toContain("Lift Lobby 2");
  expect(nav.walking.join(" ")).toContain("Cinema");
});
it("does not invent missing or unverified route instructions", () => {
  expect(
    navigationInstructions({ ...location, guidance: null }).driving,
  ).toEqual([]);
  expect(
    navigationInstructions({
      ...location,
      route: { ...location.route, is_verified: false },
    }).walking,
  ).toEqual([]);
  expect(navigationInstructions({ ...location, route: null }).walking).toEqual(
    [],
  );
});

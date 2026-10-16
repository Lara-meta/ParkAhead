import { z } from "zod";
export const lifecycleSearchSchema = z
  .object({
    mallId: z.uuid(),
    zoneId: z.uuid().optional(),
    destinationId: z.uuid().nullable().optional(),
    preference: z.enum(["none", "shorter_walk", "step_free"]).default("none"),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((v, c) => {
    if (v.preference !== "none" && !v.destinationId)
      c.addIssue({
        code: "custom",
        message: "Choose a destination for this preference.",
        path: ["destinationId"],
      });
  });
export type ClockContext = {
  demoMode: boolean;
  mallDemo: boolean;
  now: string;
  realNow: string;
  graceMinutes: number;
};
export type JourneyBooking = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  arrival_deadline: string;
  check_in_token: string;
  released_at: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  is_demo: boolean;
  demo_scenario: "A" | "B" | null;
  demo_rebooking_of: string | null;
  server_now: string;
  preference: string;
  bay_id: string;
  bays: {
    label: string;
    zones: { id: string; name: string; floor: string; malls: { name: string } };
  };
  destinations: { name: string } | null;
  guidance: {
    vehicle_entrance: string;
    lift_lobby: string;
    driving_instructions: string[];
  } | null;
  route: {
    is_verified: boolean;
    is_step_free: boolean | null;
    walking_distance_m: number;
    route_description: string | null;
  } | null;
};
export type DemoMetrics = {
  reservationsCreated: number;
  checkIns: number;
  completed: number;
  noShows: number;
  scheduledMinutesReleased: number;
};
export type DemoDashboard = {
  clock: ClockContext;
  metrics: DemoMetrics;
  lastCleanup: { executed_at: string; released_count: number } | null;
  bookings: JourneyBooking[];
};
export const isFinal = (status: string) =>
  ["completed", "cancelled", "no_show"].includes(status);
export function arrivalEligible(
  b: Pick<JourneyBooking, "status" | "start_at" | "arrival_deadline">,
  now: number,
) {
  return (
    b.status === "confirmed" &&
    Date.parse(b.start_at) <= now &&
    now < Date.parse(b.arrival_deadline)
  );
}
export function releaseEligible(
  b: Pick<JourneyBooking, "status" | "arrival_deadline">,
  now: number,
) {
  return b.status === "confirmed" && now >= Date.parse(b.arrival_deadline);
}
export function releasedMinutes(end: string, released: string) {
  return Math.max(0, (Date.parse(end) - Date.parse(released)) / 60000);
}
export function reminder(
  b: Pick<JourneyBooking, "status" | "start_at" | "arrival_deadline">,
  now: number,
) {
  if (b.status === "no_show")
    return "This booking was released after the arrival deadline. Create a new booking if you still want to park.";
  if (b.status === "cancelled") return "This booking was cancelled.";
  if (b.status === "completed") return "Simulated parking completed.";
  if (b.status === "checked_in") return "Parking in progress";
  const start = Date.parse(b.start_at),
    deadline = Date.parse(b.arrival_deadline);
  if (now >= deadline)
    return "Arrival deadline passed. Refreshing release status…";
  const mins = Math.max(
    1,
    Math.ceil(((now < start ? start : deadline) - now) / 60000),
  );
  return now < start
    ? `Your booking starts in ${mins} minute${mins === 1 ? "" : "s"}.`
    : `Check in within ${mins} minute${mins === 1 ? "" : "s"}.`;
}
export function navigationInstructions(
  b: Pick<JourneyBooking, "bays" | "guidance" | "destinations" | "route">,
) {
  return {
    driving: b.guidance
      ? [
          ...b.guidance.driving_instructions,
          `Your assigned bay is ${b.bays.label}.`,
        ]
      : [],
    walking:
      b.guidance &&
      b.destinations &&
      b.route?.is_verified &&
      b.route.route_description
        ? [
            `Use ${b.guidance.lift_lobby} for ${b.destinations.name}.`,
            b.route.route_description,
          ]
        : [],
  };
}

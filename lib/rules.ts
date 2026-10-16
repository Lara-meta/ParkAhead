import { z } from "zod";
export const preference = z.enum(["none", "shorter_walk", "step_free"]);
export { lifecycleSearchSchema as searchSchema } from "./lifecycle";
export function intervalError(start: string, end: string, now = Date.now()) {
  const s = Date.parse(start),
    e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "Enter valid times.";
  if (s <= now) return "Start must be in the future.";
  if (s > now + 30 * 86400000) return "Book up to 30 days ahead.";
  if (e - s < 1800000) return "Minimum duration is 30 minutes.";
  if (e - s > 8 * 3600000) return "Maximum duration is 8 hours.";
  return null;
}
export const overlaps = (a: number, b: number, c: number, d: number) =>
  a < d && b > c;
export const canCancel = (status: string, start: string, now = Date.now()) =>
  status === "confirmed" && Date.parse(start) > now;
export function canTransition(
  status: string,
  next: string,
  arrivalDeadline: string,
  now = Date.now(),
  startAt?: string,
) {
  return (
    (status === "confirmed" &&
      next === "checked_in" &&
      !!startAt &&
      Date.parse(startAt) <= now &&
      now < Date.parse(arrivalDeadline)) ||
    (status === "checked_in" && next === "completed") ||
    (status === "confirmed" &&
      next === "no_show" &&
      Date.parse(arrivalDeadline) <= now)
  );
}
export type Zone = {
  zoneId: string;
  zoneName: string;
  floor: string;
  availableBayCount: number;
  walkingDistanceM: number | null;
  stepFree: boolean | null;
  verified: boolean;
};
export function recommend(zones: Zone[], pref: string) {
  return zones
    .filter(
      (z) =>
        z.availableBayCount > 0 &&
        (pref !== "step_free" || (z.verified && z.stepFree === true)),
    )
    .sort((a, b) => {
      if (pref !== "none") {
        const d =
          (a.verified && a.walkingDistanceM !== null
            ? a.walkingDistanceM
            : Infinity) -
          (b.verified && b.walkingDistanceM !== null
            ? b.walkingDistanceM
            : Infinity);
        if (!Number.isNaN(d) && d !== 0) return d;
      }
      return a.zoneName.localeCompare(b.zoneName);
    })
    .map((z) => ({
      ...z,
      walkingDistanceM: z.verified ? z.walkingDistanceM : null,
      stepFree: z.verified ? z.stepFree : null,
      reason:
        pref === "step_free"
          ? "Verified step-free demo route."
          : pref === "shorter_walk" && z.verified
            ? "Ranked by verified demo walking distance."
            : z.verified
              ? "Available for your selected time."
              : "Available for your selected time. Route details are unavailable.",
      dataMode: "simulated" as const,
    }));
}
export function mallInstant(local: string) {
  return new Date(`${local}:00+08:00`).toISOString();
}
export function displayTime(instant: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

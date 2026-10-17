import { plateInputSchema } from "./plates";
import { z } from "zod";
export const preferenceKeys = [
  "shorter_walk",
  "step_free",
  "near_lift",
  "near_exit",
  "wider_bay",
  "near_walkway",
] as const;
export type PreferenceKey = (typeof preferenceKeys)[number];
const keys = z
  .array(z.enum(preferenceKeys))
  .refine(
    (v) => new Set(v).size === v.length,
    "Each preference may be selected once.",
  );
export const parkingRequestSchema = z
  .object({
    mallId: z.guid(),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    destinationId: z.guid().nullable().optional(),
    selectedPreferences: keys.default([]),
    requiredPreferences: keys.default([]),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.requiredPreferences.some((k) => !v.selectedPreferences.includes(k)))
      c.addIssue({
        code: "custom",
        message: "Required preferences must also be selected.",
        path: ["requiredPreferences"],
      });
    if (v.requiredPreferences.includes("shorter_walk"))
      c.addIssue({
        code: "custom",
        message: "Shorter walk is a ranking objective, not a must-have.",
        path: ["requiredPreferences"],
      });
    if (
      !v.destinationId &&
      v.selectedPreferences.some((k) =>
        ["shorter_walk", "step_free"].includes(k),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Choose a destination for walking-route preferences.",
        path: ["destinationId"],
      });
  });
export const exactBookingSchema = z
  .object({
    ...parkingRequestSchema.shape,
    plate: plateInputSchema,
    bayId: z.guid(),
    idempotencyKey: z.guid(),
  })
  .strict()
  .superRefine((v, c) => {
    const r = parkingRequestSchema.safeParse(
      Object.fromEntries(
        Object.entries(v).filter(
          ([k]) => !["bayId", "idempotencyKey", "plate"].includes(k),
        ),
      ),
    );
    if (!r.success)
      for (const issue of r.error.issues)
        c.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export const geometrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
  }),
  z.object({
    kind: z.literal("rect"),
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
    width: z.number().positive().max(4000),
    height: z.number().positive().max(4000),
  }),
  z.object({
    kind: z.literal("polyline"),
    points: z
      .array(
        z.tuple([z.number().min(0).max(4000), z.number().min(0).max(4000)]),
      )
      .min(2)
      .max(60),
  }),
]);
export type Geometry = z.infer<typeof geometrySchema>;
export const mapBaySchema = z.object({
  id: z.guid(),
  label: z.string(),
  zoneId: z.guid(),
  zoneName: z.string(),
  floorId: z.guid(),
  floorName: z.string(),
  isActive: z.boolean(),
  bayType: z.string(),
  inventoryClass: z.enum(["bookable", "walk_in_only"]).default("bookable"),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
  widthMm: z.number().nullable(),
  liftDistanceM: z.number().nullable(),
  walkwayDistanceM: z.number().nullable(),
  exitDrivingDistanceM: z.number().nullable(),
});
export type MapBay = z.infer<typeof mapBaySchema>;
export type Floor = {
  id: string;
  mall_id: string;
  name: string;
  sort_order: number;
  map_width: number;
  map_height: number;
  is_active: boolean;
};
export const floorMapSchema = z.object({
  floor: z.object({
    id: z.guid(),
    mall_id: z.guid(),
    name: z.string(),
    sort_order: z.number(),
    map_width: z.number().positive(),
    map_height: z.number().positive(),
    is_active: z.boolean(),
  }),
  mall: z.object({
    id: z.guid(),
    name: z.string(),
    timezone: z.string(),
    description: z.string(),
  }),
  zones: z.array(
    z.object({ id: z.guid(), name: z.string(), is_active: z.boolean() }),
  ),
  bays: z.array(mapBaySchema),
  features: z.array(
    z.object({
      id: z.guid(),
      type: z.enum([
        "entrance",
        "exit",
        "lift",
        "stairs",
        "pedestrian_path",
        "driving_lane",
        "landmark",
        "zone_label",
      ]),
      label: z.string(),
      geometry: geometrySchema,
    }),
  ),
});
export type FloorMap = z.infer<typeof floorMapSchema>;
export type PreferenceDefinition = {
  id: PreferenceKey;
  label: string;
  description: string;
  category: string;
  requires_destination: boolean;
  supports_required: boolean;
  threshold: number | null;
  normalization_max: number | null;
  evaluation_type: string;
  config_version: string;
};
export type Evaluation = {
  algorithmVersion: string;
  historical?: boolean;
  note?: string;
  score: number;
  requirementsMet: boolean;
  selected: PreferenceKey[];
  required: PreferenceKey[];
  matched: PreferenceKey[];
  unmet: PreferenceKey[];
  unknown: PreferenceKey[];
  knownCount: number;
  totalCount: number;
  values: {
    widthMm: number | null;
    liftDistanceM: number | null;
    walkwayDistanceM: number | null;
    exitDrivingDistanceM: number | null;
    walkingDistanceM: number | null;
    stepFree: boolean | null;
    routeVerified: boolean;
  };
  configuration: Record<string, unknown>;
  location?: {
    mallId: string;
    mallName: string;
    timezone: string;
    floorId: string;
    floor: string;
    zoneName: string;
    bayLabel: string;
  };
};
export type BayAvailability = {
  bayType?: string;
  eligibilityOutcome?: "not_required" | "approved" | "approval_required";
  id: string;
  label: string;
  zoneId: string;
  zoneName: string;
  floorId: string;
  floorName: string;
  status: "available" | "reserved" | "unavailable" | "unknown";
  reason: string;
  eligible: boolean;
  evaluation: Evaluation;
};
export type Recommendations = {
  serverNow: string;
  mallId: string;
  startAt: string;
  endAt: string;
  bays: BayAvailability[];
  algorithmVersion: string;
};
export type Mall = {
  is_active?: boolean;
  id: string;
  name: string;
  timezone: string;
  description: string;
  layout_key: string | null;
  is_demo: boolean;
  parking_floors: Floor[];
  destinations: { id: string; name: string }[];
};
export const mapLimitation =
  "Demo parking layouts and route information are fictional. Availability is based on system reservations, not verified physical occupancy.";
export function preferenceLabel(
  key: string,
  definitions: PreferenceDefinition[] = [],
) {
  return (
    definitions.find((d) => d.id === key)?.label ??
    (
      {
        shorter_walk: "Shorter walk",
        step_free: "Verified step-free route",
        near_lift: "Near a lift lobby",
        near_exit: "Near a vehicle exit",
        wider_bay: "Wider standard bay",
        near_walkway: "Near a pedestrian walkway",
      } as Record<string, string>
    )[key] ??
    key
  );
}
export function matchSummary(e: Evaluation) {
  return e.totalCount
    ? `Matches ${e.matched.length} of your ${e.totalCount} preferences`
    : "No preferences selected; bays are ordered by label.";
}
export function statusDescription(status: string) {
  return status === "available"
    ? "Available for selected time"
    : status === "reserved"
      ? "Reserved during some or all of your selected time"
      : status === "unavailable"
        ? "Unavailable for booking"
        : "Unknown — choose times or refresh availability";
}
export function sortRecommendations(bays: BayAvailability[]) {
  return [...bays]
    .filter((b) => b.status === "available" && b.eligible)
    .sort(
      (a, b) =>
        b.evaluation.score - a.evaluation.score ||
        a.label.localeCompare(b.label),
    );
}
export function localInMall(instant: string, timezone: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (key: string) => p.find((v) => v.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function instantInMall(local: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Choose complete arrival and departure times.");
  const desired = Date.parse(local + ":00Z");
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const formatted = localInMall(new Date(guess).toISOString(), timezone);
    const offset = Date.parse(formatted + ":00Z") - guess;
    guess = desired - offset;
  }
  const result = new Date(guess).toISOString();
  if (localInMall(result, timezone) !== local)
    throw new Error("This local time does not exist in the mall timezone.");
  return result;
}

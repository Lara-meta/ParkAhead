import { plateInputSchema } from "@/lib/plates";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { database } from "@/lib/supabase/server";
import { recommend, type Zone } from "@/lib/rules";
import { lifecycleSearchSchema as searchSchema } from "@/lib/lifecycle";
import {
  exactBookingSchema,
  parkingRequestSchema,
  floorMapSchema,
} from "@/lib/parking";
const uuid = z.guid();
class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function GET(req: NextRequest) {
  const response = await handle(req);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function POST(req: NextRequest) {
  const response = await handle(req);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export async function PATCH(req: NextRequest) {
  const response = await handle(req);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
async function handle(req: NextRequest) {
  try {
    const mutation = req.method !== "GET";
    if (mutation && req.headers.get("origin") !== req.nextUrl.origin)
      throw new Failure(
        403,
        "ORIGIN_REJECTED",
        "Refresh the page and try again.",
      );
    const db = await database();
    const p = req.nextUrl.pathname.replace("/api/", "").split("/");
    const fail = (error: { code?: string; message?: string } | null) => {
      if (!error) return;
      const code = error.code ?? "";
      if (code === "P0004")
        throw new Failure(
          403,
          "OKU_ELIGIBILITY_REQUIRED",
          "Approved, unexpired OKU eligibility for this mall is required. Request a simulated review or choose a standard bay.",
        );
      if (code === "P0003")
        throw new Failure(
          409,
          "REQUIREMENTS_CHANGED",
          "Your required preferences are no longer met by this bay. Review the updated map or change your requirements.",
        );
      if (code === "P0001")
        throw new Failure(
          409,
          "ARRIVAL_WINDOW",
          error.message === "ARRIVAL_TOO_EARLY"
            ? "Check-in opens at the reservation start time."
            : "The arrival deadline has not passed.",
        );
      if (code === "22023")
        throw new Failure(
          400,
          "INVALID_INPUT",
          "Check your dates, plate, destination and preferences. Bookings require at least one hour.",
        );
      if (["23P01", "23505"].includes(code))
        throw new Failure(
          409,
          "CONFLICT",
          "The bay or plate has a conflicting booking/session, the request key was reused, or this action is no longer eligible. Review the plate and times; no other customer details are disclosed.",
        );
      if (code === "42501")
        throw new Failure(
          403,
          "FORBIDDEN",
          "This action requires administrator access.",
        );
      if (code === "P0002")
        throw new Failure(404, "NOT_FOUND", "This resource is unavailable.");
      if (code === "28000")
        throw new Failure(401, "UNAUTHENTICATED", "Please sign in.");
      throw new Failure(
        500,
        "DATABASE_ERROR",
        "Unable to complete this request. Please try again.",
      );
    };
    if (p[0] === "plate-configuration" && req.method === "GET") {
      const r = await db.rpc("plate_configuration");
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (p[0] === "floors" && p[2] === "map" && req.method === "GET") {
      const mallId = uuid.parse(req.nextUrl.searchParams.get("mallId"));
      const floorId = uuid.parse(p[1]);
      const r = await db.rpc("floor_map", { p_mall: mallId, p_floor: floorId });
      fail(r.error);
      return NextResponse.json({ data: floorMapSchema.parse(r.data) });
    }
    if (p[0] === "recommendations" && req.method === "POST") {
      const v = parkingRequestSchema.parse(await req.json());
      const r = await db.rpc("recommend_bays", {
        p_mall: v.mallId,
        p_start: v.startAt,
        p_end: v.endAt,
        p_destination: v.destinationId ?? null,
        p_selected: v.selectedPreferences,
        p_required: v.requiredPreferences,
      });
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (
      p[0] === "availability" &&
      req.method === "GET" &&
      req.nextUrl.searchParams.get("granularity") === "bay"
    ) {
      const q = Object.fromEntries(req.nextUrl.searchParams);
      const v = z
        .object({
          mallId: uuid,
          startAt: z.iso.datetime({ offset: true }),
          endAt: z.iso.datetime({ offset: true }),
          floorId: uuid.optional(),
          destinationId: uuid.optional(),
        })
        .parse(q);
      const r = await db.rpc("bay_availability", {
        p_mall: v.mallId,
        p_start: v.startAt,
        p_end: v.endAt,
        p_floor: v.floorId ?? null,
        p_destination: v.destinationId ?? null,
      });
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (p[0] === "clock" && req.method === "GET") {
      const mall = req.nextUrl.searchParams.get("mallId");
      const r = await db.rpc("clock_context", {
        p_mall: mall ? uuid.parse(mall) : null,
      });
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (p[0] === "demo" && p[1] === "metrics" && req.method === "GET") {
      const r = await db.rpc("demo_metrics");
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (p[0] === "demo" && p[1] === "story" && req.method === "GET") {
      const r = await db.from("demo_story").select("quote").single();
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (p[0] === "malls") {
      if (p.length === 1) {
        const r = await db
          .from("malls")
          .select("*,parking_floors(*),destinations(id,name)")
          .eq("is_active", true)
          .order("sort_order", { referencedTable: "parking_floors" })
          .order("name");
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
      uuid.parse(p[1]);
      const mallResource = await db
        .from("malls")
        .select("id")
        .eq("id", p[1])
        .maybeSingle();
      fail(mallResource.error);
      if (!mallResource.data)
        throw new Failure(404, "NOT_FOUND", "Mall not found.");
      if (p[2] === "floors" && req.method === "GET") {
        const r = await db
          .from("parking_floors")
          .select("*")
          .eq("mall_id", p[1])
          .order("sort_order");
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
      if (p[2] === "preferences" && req.method === "GET") {
        const r = await db
          .from("preference_definitions")
          .select("*")
          .order("id");
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
      if (p[2] === "destinations") {
        const r = await db
          .from("destinations")
          .select("*")
          .eq("mall_id", p[1])
          .order("name");
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
    }
    if (["availability", "recommendations"].includes(p[0])) {
      const v = searchSchema.parse(
        Object.fromEntries(req.nextUrl.searchParams),
      );
      const r = await db.rpc("availability", {
        p_mall: v.mallId,
        p_start: v.startAt,
        p_end: v.endAt,
        p_destination: v.destinationId ?? null,
      });
      fail(r.error);
      return NextResponse.json({
        data:
          p[0] === "recommendations"
            ? recommend(r.data as Zone[], v.preference)
            : r.data,
      });
    }
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      throw new Failure(401, "UNAUTHENTICATED", "Please sign in to continue.");
    const admin = p[0] === "admin";
    if (admin) {
      const r = await db.rpc("is_admin");
      fail(r.error);
      if (!r.data)
        throw new Failure(403, "FORBIDDEN", "Administrator access required.");
      p.shift();
    }
    if (p[0] === "me" && p[1] === "eligibility") {
      const r =
        req.method === "GET"
          ? await db.rpc("my_eligibility", {
              p_mall: uuid.parse(req.nextUrl.searchParams.get("mallId")),
            })
          : await db.rpc("request_eligibility", {
              p_mall: z
                .object({ mallId: uuid })
                .strict()
                .parse(await req.json()).mallId,
            });
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (admin && p[0] === "eligibility") {
      if (req.method === "GET") {
        const r = await db.rpc("eligibility_dashboard");
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
      if (req.method === "POST" && p[2] === "review") {
        const v = z
          .object({
            status: z.enum(["approved", "rejected"]),
            expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
          })
          .strict()
          .parse(await req.json());
        const r = await db.rpc("review_eligibility", {
          p_id: uuid.parse(p[1]),
          p_status: v.status,
          p_expires: v.expiresAt ?? null,
        });
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
    }
    if (
      ["bookings", "reservations"].includes(p[0]) &&
      p[2] === "plate" &&
      req.method === "PATCH"
    ) {
      const v = z
        .object({ plate: plateInputSchema })
        .strict()
        .parse(await req.json());
      const r = await db.rpc("update_booking_plate", {
        p_id: uuid.parse(p[1]),
        p_plate: v.plate,
      });
      fail(r.error);
      return NextResponse.json({ data: r.data });
    }
    if (admin && p[0] === "demo") {
      let result;
      if (req.method === "GET" && p.length === 1)
        result = await db.rpc("demo_dashboard");
      else if (req.method === "POST" && p[1] === "advance") {
        const v = z
          .object({ minutes: z.number().int().min(1).max(10080) })
          .strict()
          .parse(await req.json());
        result = await db.rpc("advance_demo_clock", { p_minutes: v.minutes });
      } else if (req.method === "POST" && p[1] === "cleanup") {
        z.object({})
          .strict()
          .parse(await req.json());
        result = await db.rpc("admin_cleanup");
      } else if (req.method === "POST" && p[1] === "reset") {
        const v = z
          .object({ confirmation: z.literal("RESET") })
          .strict()
          .parse(await req.json());
        result = await db.rpc("reset_demo", { p_confirmation: v.confirmation });
      } else if (req.method === "POST" && p[1] === "rebook") {
        const v = z
          .object({ reservationId: uuid })
          .strict()
          .parse(await req.json());
        result = await db.rpc("rebook_demo", { p_id: v.reservationId });
      } else if (req.method === "POST" && p[1] === "story") {
        const v = z
          .object({ quote: z.string().trim().min(20).max(600) })
          .strict()
          .parse(await req.json());
        result = await db.rpc("update_demo_quote", { p_quote: v.quote });
      } else throw new Failure(404, "NOT_FOUND", "Unknown demo action.");
      fail(result.error);
      return NextResponse.json({ data: result.data });
    }
    if (p[0] === "arrival")
      throw new Failure(
        410,
        "REMOVED",
        "Use the authenticated booking arrival screen.",
      );
    let data: unknown;
    if (admin && p[0] === "bays") {
      if (req.method === "PATCH") {
        const id = uuid.parse(p[1]);
        const v = z.object({ isActive: z.boolean() }).parse(await req.json());
        const r = await db.rpc("set_bay", { p_id: id, p_active: v.isActive });
        fail(r.error);
        data = r.data;
      } else {
        const r = await db
          .from("bays")
          .select("*,zones:zones!bays_zone_id_fkey(name,floor)")
          .order("label");
        fail(r.error);
        data = r.data;
      }
    } else if (admin && p[0] === "routes") {
      const r = await db
        .from("zone_destination_routes")
        .select("*,zones(name,floor),destinations(name)");
      fail(r.error);
      data = r.data;
    } else if (
      (p[0] === "me" && p[1] === "reservations") ||
      p[0] === "reservations"
    ) {
      if (req.method === "POST" && p.length === 1 && !admin) {
        const body = await req.json();
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Failure(
            400,
            "INVALID_INPUT",
            "Expected a booking request object.",
          );
        if ("bayId" in body) {
          const v = exactBookingSchema.parse(body);
          const r = await db.rpc("reserve_bay", {
            p_mall: v.mallId,
            p_bay: v.bayId,
            p_start: v.startAt,
            p_end: v.endAt,
            p_destination: v.destinationId ?? null,
            p_selected: v.selectedPreferences,
            p_required: v.requiredPreferences,
            p_key: v.idempotencyKey,
            p_plate: v.plate,
          });
          fail(r.error);
          return NextResponse.json({ data: r.data });
        }
        const v = z
          .object({
            ...searchSchema.shape,
            idempotencyKey: uuid,
            plate: plateInputSchema,
          })
          .strict()
          .parse(body);
        const zoneId = uuid.parse(v.zoneId);
        const key = uuid.parse(body.idempotencyKey);
        const r = await db.rpc("reserve", {
          p_mall: v.mallId,
          p_zone: zoneId,
          p_start: v.startAt,
          p_end: v.endAt,
          p_destination: v.destinationId ?? null,
          p_preference: v.preference,
          p_key: key,
          p_plate: v.plate,
        });
        fail(r.error);
        data = r.data;
      } else if (req.method === "POST" && p[2]) {
        const next =
          p[2] === "cancel"
            ? "cancelled"
            : admin || ["check-in", "complete"].includes(p[2])
              ? (
                  {
                    "check-in": "checked_in",
                    complete: "completed",
                    "no-show": "no_show",
                  } as Record<string, string>
                )[p[2]]
              : undefined;
        if (!next) throw new Failure(404, "NOT_FOUND", "Unknown action.");
        const r = await db.rpc("transition", {
          p_id: uuid.parse(p[1]),
          p_next: next,
        });
        fail(r.error);
        if (r.data.status !== next)
          throw new Failure(
            409,
            "INVALID_TRANSITION",
            r.data.status === "no_show"
              ? "This booking was released after the arrival deadline. Create a new booking."
              : "This booking is no longer eligible for this action.",
          );
        data = r.data;
      } else if (req.method === "GET") {
        if (p[0] === "reservations" && p[1]) {
          const r = await db.rpc("booking_details", { p_id: uuid.parse(p[1]) });
          fail(r.error);
          return NextResponse.json({ data: r.data });
        }
        const refreshed = await db.rpc("refresh_booking_states");
        fail(refreshed.error);
        let q = db
          .from("reservations")
          .select(
            "*,bays(label,zones:zones!bays_zone_id_fkey(name,floor,malls(name)))",
          )
          .order("start_at", { ascending: false });
        if (!admin) q = q.eq("user_id", user.id);
        if (p[0] === "reservations" && p[1]) q = q.eq("id", uuid.parse(p[1]));
        if (admin && req.nextUrl.searchParams.get("status"))
          q = q.eq(
            "status",
            z
              .enum([
                "confirmed",
                "checked_in",
                "completed",
                "cancelled",
                "no_show",
              ])
              .parse(req.nextUrl.searchParams.get("status")),
          );
        const r = await q;
        fail(r.error);
        data = r.data;
        if (p[0] === "reservations" && p[1]) {
          if (!r.data?.length)
            throw new Failure(404, "NOT_FOUND", "Booking not found.");
          data = r.data[0];
        }
      } else throw new Failure(404, "NOT_FOUND", "Unknown endpoint.");
    } else throw new Failure(404, "NOT_FOUND", "Unknown endpoint.");
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof SyntaxError)
      return NextResponse.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        { status: 400 },
      );
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Check the highlighted input.",
            fieldErrors: z.flattenError(e).fieldErrors,
          },
        },
        { status: 400 },
      );
    if (e instanceof Failure)
      return NextResponse.json(
        { error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    if (e instanceof Error && e.message === "NOT_CONFIGURED")
      return NextResponse.json(
        {
          error: {
            code: "NOT_CONFIGURED",
            message:
              "Supabase is not configured. Follow README setup and add .env.local.",
          },
        },
        { status: 503 },
      );
    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "Unable to complete the request.",
        },
      },
      { status: 500 },
    );
  }
}

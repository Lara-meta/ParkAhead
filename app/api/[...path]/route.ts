import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { database } from "@/lib/supabase/server";
import { recommend, type Zone } from "@/lib/rules";
import { lifecycleSearchSchema as searchSchema } from "@/lib/lifecycle";
const uuid = z.uuid();
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
  return handle(req);
}
export async function PATCH(req: NextRequest) {
  return handle(req);
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
          "Check your dates, destination and preferences.",
        );
      if (["23P01", "23505"].includes(code))
        throw new Failure(
          409,
          "CONFLICT",
          "Availability changed, the request key was reused, or this action is no longer eligible. Search again.",
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
        const r = await db.from("malls").select("*").eq("is_active", true);
        fail(r.error);
        return NextResponse.json({ data: r.data });
      }
      uuid.parse(p[1]);
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
    if (p[0] === "arrival") {
      const token = uuid.parse(p[1]);
      const details = await db.rpc("booking_details", { p_token: token });
      fail(details.error);
      if (req.method === "GET")
        return NextResponse.json({ data: details.data });
      const next =
        p[2] === "check-in"
          ? "checked_in"
          : p[2] === "complete"
            ? "completed"
            : null;
      if (req.method !== "POST" || !next)
        throw new Failure(404, "NOT_FOUND", "Unknown arrival action.");
      const r = await db.rpc("transition", {
        p_id: details.data.id,
        p_next: next,
      });
      fail(r.error);
      if (r.data.status !== next)
        throw new Failure(
          409,
          "BOOKING_RELEASED",
          r.data.status === "no_show"
            ? "This booking was released after the arrival deadline. Create a new booking."
            : "This booking is no longer eligible for this action.",
        );
      const fresh = await db.rpc("booking_details", { p_id: r.data.id });
      fail(fresh.error);
      return NextResponse.json({ data: fresh.data });
    }
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
          .select("*,zones(name,floor)")
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
        const v = z.object(searchSchema.shape).parse(body);
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
          .select("*,bays(label,zones(name,floor,malls(name)))")
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

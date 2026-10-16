import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const enabled =
  process.env.RUN_LOCAL_DB_TESTS === "1" &&
  process.env.RUN_DEMO_DB_TESTS === "1";
const base = Date.parse("2030-01-15T02:00:00Z");
const at = (minutes: number) => new Date(base + minutes * 60000).toISOString();
describe.skipIf(!enabled)(
  "LOCAL arrival lifecycle with isolated users and demo fixtures",
  () => {
    let root: SupabaseClient,
      admin: SupabaseClient,
      customer: SupabaseClient,
      other: SupabaseClient,
      anonymous: SupabaseClient;
    const users: string[] = [],
      malls: string[] = [],
      zones: string[] = [];
    let saved: Record<string, unknown> | null = null;
    async function query<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
      const r = await promise;
      if (r.error) throw r.error;
      return r.data as NonNullable<T>;
    }
    async function clear() {
      if (!root || !users.length) return;
      const rows = await query(
        root.from("reservations").select("id").in("user_id", users),
      );
      if (rows?.length) {
        await query(
          root
            .from("booking_events")
            .delete()
            .in(
              "reservation_id",
              rows.map((r) => r.id),
            ),
        );
        await query(
          root
            .from("reservations")
            .delete()
            .in(
              "id",
              rows.map((r) => r.id),
            ),
        );
      }
    }
    async function clock(minutes: number) {
      await query(
        root
          .from("runtime_settings")
          .update({ demo_now: at(minutes) })
          .eq("singleton", true),
      );
    }
    async function make(demo = true, client = customer) {
      const zone = zones[demo ? 0 : 1];
      const bay = crypto.randomUUID();
      await query(
        root
          .from("bays")
          .insert({ id: bay, zone_id: zone, label: "T-" + bay.slice(0, 8) }),
      );
      const s = demo ? at(10) : new Date(Date.now() + 86400000).toISOString();
      const e = new Date(Date.parse(s) + 3600000).toISOString();
      return await query(
        client.rpc("reserve", {
          p_mall: malls[demo ? 0 : 1],
          p_zone: zone,
          p_start: s,
          p_end: e,
          p_destination: null,
          p_preference: "none",
          p_key: crypto.randomUUID(),
        }),
      );
    }
    beforeAll(async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url))
        throw new Error("Refusing non-local lifecycle database tests.");
      root = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const existing = await query(
        root
          .from("reservations")
          .select("id")
          .eq("is_demo", true)
          .in("status", ["confirmed", "checked_in"]),
      );
      if (existing?.length)
        throw new Error(
          "Active unrelated demo bookings exist. Use a disposable local project.",
        );
      saved = await query(root.from("runtime_settings").select("*").single());
      async function user(role: string) {
        const email = "journey-" + crypto.randomUUID() + "@example.test",
          password = crypto.randomUUID() + "Aa1!";
        const r = await root.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (r.error) throw r.error;
        users.push(r.data.user.id);
        if (role === "admin")
          await query(
            root
              .from("user_roles")
              .update({ role })
              .eq("user_id", r.data.user.id),
          );
        const c = createClient(
          url,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false } },
        );
        const login = await c.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        return c;
      }
      admin = await user("admin");
      customer = await user("customer");
      other = await user("customer");
      anonymous = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      for (const demo of [true, false]) {
        const mall = crypto.randomUUID(),
          zone = crypto.randomUUID();
        malls.push(mall);
        zones.push(zone);
        await query(
          root.from("malls").insert({
            id: mall,
            name: "Isolated lifecycle test",
            is_demo: demo,
          }),
        );
        await query(
          root.from("zones").insert({
            id: zone,
            mall_id: mall,
            name: "Test zone",
            floor: "B1",
            map_region_key: "T",
          }),
        );
      }
      await query(
        root
          .from("runtime_settings")
          .update({ demo_mode: true, demo_now: at(0), grace_minutes: 15 })
          .eq("singleton", true),
      );
    });
    beforeEach(async () => {
      if (saved) {
        await clock(0);
        await query(
          root
            .from("runtime_settings")
            .update({ grace_minutes: 15 })
            .eq("singleton", true),
        );
      }
    });
    afterEach(clear);
    afterAll(async () => {
      if (!root) return;
      await clear();
      if (saved)
        await query(
          root.from("runtime_settings").update(saved).eq("singleton", true),
        );
      if (zones.length) {
        await query(root.from("bays").delete().in("zone_id", zones));
        await query(root.from("zones").delete().in("id", zones));
      }
      if (malls.length)
        await query(root.from("malls").delete().in("id", malls));
      for (const id of users) await root.auth.admin.deleteUser(id);
    });
    it.each([
      [9.999, false],
      [10, true],
      [24.999, true],
      [25, false],
      [26, false],
    ])("enforces check-in at demo minute %s", async (minute, allowed) => {
      const b = await make();
      expect(b.arrival_deadline).toBe(
        at(25).replace("Z", "+00:00").replace(".000", ""),
      );
      await clock(minute);
      const r = await customer.rpc("transition", {
        p_id: b.id,
        p_next: "checked_in",
      });
      if (allowed) {
        expect(r.error).toBeNull();
        expect(r.data.status).toBe("checked_in");
      } else if (minute < 10) {
        expect(r.error?.message).toBe("ARRIVAL_TOO_EARLY");
      } else {
        expect(r.error).toBeNull();
        expect(r.data.status).toBe("no_show");
      }
    });
    it("makes check-in and completion retries idempotent and never releases checked-in bookings", async () => {
      const b = await make();
      await clock(10);
      const results = await Promise.all([
        customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }),
        customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }),
      ]);
      expect(results.every((r) => r.data?.status === "checked_in")).toBe(true);
      await clock(80);
      await query(admin.rpc("admin_cleanup"));
      expect(
        (
          await query(
            root.from("reservations").select("status").eq("id", b.id).single(),
          )
        ).status,
      ).toBe("checked_in");
      await query(
        customer.rpc("transition", { p_id: b.id, p_next: "completed" }),
      );
      await query(
        customer.rpc("transition", { p_id: b.id, p_next: "completed" }),
      );
      const events = await query(
        root
          .from("booking_events")
          .select("event_type")
          .eq("reservation_id", b.id),
      );
      expect(events?.filter((e) => e.event_type === "checked_in")).toHaveLength(
        1,
      );
      expect(events?.filter((e) => e.event_type === "completed")).toHaveLength(
        1,
      );
      expect(
        events?.filter((e) => e.event_type === "no_show_released"),
      ).toHaveLength(0);
      expect(
        (await customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }))
          .data.status,
      ).toBe("completed");
    });
    it("never releases cancelled bookings and rejects completion before arrival", async () => {
      const b = await make();
      expect(
        (await customer.rpc("transition", { p_id: b.id, p_next: "completed" }))
          .error?.code,
      ).toBe("23P01");
      await query(
        customer.rpc("transition", { p_id: b.id, p_next: "cancelled" }),
      );
      await clock(26);
      await query(admin.rpc("admin_cleanup"));
      expect(
        (await customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }))
          .data.status,
      ).toBe("cancelled");
      expect(
        (
          await query(
            root
              .from("booking_events")
              .select("*")
              .eq("reservation_id", b.id)
              .eq("event_type", "no_show_released"),
          )
        )?.length,
      ).toBe(0);
    });
    it("snapshots grace and rejects duration that does not exceed the new grace", async () => {
      const first = await make();
      await query(
        root
          .from("runtime_settings")
          .update({ grace_minutes: 20 })
          .eq("singleton", true),
      );
      const next = await make();
      expect(Date.parse(first.arrival_deadline)).toBe(base + 25 * 60000);
      expect(Date.parse(next.arrival_deadline)).toBe(base + 30 * 60000);
      expect(
        Date.parse(
          (
            await query(
              root
                .from("reservations")
                .select("arrival_deadline")
                .eq("id", first.id)
                .single(),
            )
          ).arrival_deadline,
        ),
      ).toBe(base + 25 * 60000);
      await query(
        root
          .from("runtime_settings")
          .update({ grace_minutes: 60 })
          .eq("singleton", true),
      );
      expect(
        (
          await customer.rpc("reserve", {
            p_mall: malls[0],
            p_zone: zones[0],
            p_start: at(10),
            p_end: at(70),
            p_destination: null,
            p_preference: "none",
            p_key: crypto.randomUUID(),
          })
        ).error?.code,
      ).toBe("22023");
    });
    it("completion releases the remaining interval while preserving requested audit times", async () => {
      const original = await make();
      await clock(10);
      await query(
        customer.rpc("transition", { p_id: original.id, p_next: "checked_in" }),
      );
      await clock(11);
      const completed = await query(
        customer.rpc("transition", { p_id: original.id, p_next: "completed" }),
      );
      expect(completed.start_at).toBe(original.start_at);
      expect(completed.end_at).toBe(original.end_at);
      const next = await query(
        other.rpc("reserve", {
          p_mall: malls[0],
          p_zone: zones[0],
          p_start: at(12),
          p_end: at(70),
          p_destination: null,
          p_preference: "none",
          p_key: crypto.randomUUID(),
        }),
      );
      expect(next.bay_id).toBe(original.bay_id);
      expect(next.id).not.toBe(original.id);
    });
    it("serializes check-in versus clock advance and concurrent cleanup into one valid result", async () => {
      const b = await make();
      await clock(24.999);
      await Promise.all([
        customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }),
        admin.rpc("advance_demo_clock", { p_minutes: 1 }),
        admin.rpc("admin_cleanup"),
      ]);
      await query(admin.rpc("admin_cleanup"));
      const current = await query(
        root.from("reservations").select("*").eq("id", b.id).single(),
      );
      expect(["checked_in", "no_show"]).toContain(current.status);
      const events = await query(
        root
          .from("booking_events")
          .select("event_type")
          .eq("reservation_id", b.id),
      );
      expect(
        events?.filter((e) =>
          ["checked_in", "no_show_released"].includes(e.event_type),
        ),
      ).toHaveLength(1);
    });
    it("releases once at the deadline, records metrics once, and allows a new remaining-interval booking", async () => {
      const b = await make();
      await clock(25);
      await Promise.all([
        admin.rpc("admin_cleanup"),
        admin.rpc("admin_cleanup"),
      ]);
      await query(admin.rpc("admin_cleanup"));
      const row = await query(
        root.from("reservations").select("*").eq("id", b.id).single(),
      );
      expect(row.status).toBe("no_show");
      expect(Date.parse(row.released_at)).toBe(base + 25 * 60000);
      const events = await query(
        root
          .from("booking_events")
          .select("*")
          .eq("reservation_id", b.id)
          .eq("event_type", "no_show_released"),
      );
      expect(events).toHaveLength(1);
      expect(events![0].details.released_minutes).toBe(45);
      const metrics = await query(anonymous.rpc("demo_metrics"));
      expect(metrics.noShows).toBeGreaterThanOrEqual(1);
      const before = metrics.scheduledMinutesReleased;
      await query(admin.rpc("admin_cleanup"));
      expect(
        (await query(anonymous.rpc("demo_metrics"))).scheduledMinutesReleased,
      ).toBe(before);
      const rebook = await query(
        other.rpc("reserve", {
          p_mall: malls[0],
          p_zone: zones[0],
          p_start: at(26),
          p_end: at(70),
          p_destination: null,
          p_preference: "none",
          p_key: crypto.randomUUID(),
        }),
      );
      expect(rebook.bay_id).toBe(b.bay_id);
      expect(
        (await customer.rpc("transition", { p_id: b.id, p_next: "checked_in" }))
          .data.status,
      ).toBe("no_show");
    });
    it("isolates demo and normal clocks and ignores customer-provided time", async () => {
      const normal = await make(false);
      await clock(400000);
      await query(admin.rpc("admin_cleanup"));
      expect(
        (
          await query(
            root
              .from("reservations")
              .select("status,is_demo")
              .eq("id", normal.id)
              .single(),
          )
        ).status,
      ).toBe("confirmed");
      const context = await query(
        anonymous.rpc("clock_context", { p_mall: malls[0] }),
      );
      expect(Date.parse(context.now)).toBe(base + 400000 * 60000);
      const real = await query(
        anonymous.rpc("clock_context", { p_mall: malls[1] }),
      );
      expect(Math.abs(Date.parse(real.now) - Date.now())).toBeLessThan(5000);
      expect(
        (
          await customer.rpc("transition", {
            p_id: normal.id,
            p_next: "checked_in",
            now: normal.start_at,
          })
        ).error,
      ).toBeTruthy();
    });
    it("keeps tokens private and blocks anonymous/foreign mutations and non-admin demo writes", async () => {
      const b = await make();
      expect(
        (await anonymous.rpc("booking_details", { p_token: b.check_in_token }))
          .error,
      ).toBeTruthy();
      expect(
        (await other.rpc("booking_details", { p_token: b.check_in_token }))
          .error?.code,
      ).toBe("P0002");
      expect(
        (await other.rpc("transition", { p_id: b.id, p_next: "checked_in" }))
          .error?.code,
      ).toBe("P0002");
      expect(
        (await customer.rpc("advance_demo_clock", { p_minutes: 5 })).error
          ?.code,
      ).toBe("42501");
      expect(
        (await customer.rpc("reset_demo", { p_confirmation: "RESET" })).error
          ?.code,
      ).toBe("42501");
      expect(
        (
          await customer
            .from("runtime_settings")
            .update({ demo_now: at(100) })
            .eq("singleton", true)
        ).error,
      ).toBeTruthy();
    });
    it("resets only own fictional fixtures and stores explicit subsequent bookings", async () => {
      const unrelated = await make();
      expect(
        (await admin.rpc("reset_demo", { p_confirmation: "NO" })).error?.code,
      ).toBe("22023");
      const d = await query(
        admin.rpc("reset_demo", { p_confirmation: "RESET" }),
      );
      expect(d.bookings).toHaveLength(2);
      expect(
        (
          await query(
            root.from("reservations").select("id").eq("id", unrelated.id),
          )
        ).length,
      ).toBe(1);
      await query(admin.rpc("advance_demo_clock", { p_minutes: 11 }));
      await query(admin.rpc("admin_cleanup"));
      const original = d.bookings.find(
        (r: { demo_scenario: string }) => r.demo_scenario === "B",
      );
      const next = await query(admin.rpc("rebook_demo", { p_id: original.id }));
      const retry = await query(
        admin.rpc("rebook_demo", { p_id: original.id }),
      );
      expect(next.id).toBe(retry.id);
      expect(next.demo_rebooking_of).toBe(original.id);
      expect(next.status).toBe("confirmed");
      const reset = await query(
        admin.rpc("reset_demo", { p_confirmation: "RESET" }),
      );
      expect(reset.bookings).toHaveLength(2);
      expect(
        (
          await query(
            root.from("reservations").select("id").eq("id", unrelated.id),
          )
        ).length,
      ).toBe(1);
    });
    it("releases a real-clock due fixture via pg_cron with no browser or cleanup invocation", async () => {
      const b = await make(false);
      const start = new Date(Date.now() - 15 * 60000 + 2000).toISOString();
      await query(
        root
          .from("reservations")
          .update({
            start_at: start,
            end_at: new Date(Date.now() + 3600000).toISOString(),
            arrival_deadline: new Date(
              Date.parse(start) + 15 * 60000,
            ).toISOString(),
          })
          .eq("id", b.id),
      );
      const until = Date.now() + 75000;
      let current;
      do {
        await new Promise((r) => setTimeout(r, 1000));
        current = await query(
          root.from("reservations").select("status").eq("id", b.id).single(),
        );
        if (current.status === "no_show") break;
      } while (Date.now() < until);
      expect(current.status).toBe("no_show");
      const events = await query(
        root
          .from("booking_events")
          .select("id")
          .eq("reservation_id", b.id)
          .eq("event_type", "no_show_released"),
      );
      expect(events).toHaveLength(1);
    }, 80000);
  },
);

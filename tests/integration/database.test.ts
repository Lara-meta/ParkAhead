import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const enabled =
  process.env.RUN_LOCAL_DB_TESTS === "1" &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;
describe.skipIf(!enabled)("isolated LOCAL database integration", () => {
  let root: SupabaseClient,
    a: SupabaseClient,
    b: SupabaseClient,
    uidA: string,
    uidB: string,
    mall: string,
    zone: string,
    bay: string;
  const s = new Date(Date.now() + 3 * 86400000).toISOString(),
    e = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString();
  beforeAll(async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url))
      throw new Error("Integration tests refuse non-local Supabase.");
    root = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const suffix = crypto.randomUUID();
    async function user() {
      const email = `test-${crypto.randomUUID()}@example.test`,
        password = crypto.randomUUID() + "Aa1!";
      const r = await root.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (r.error) throw r.error;
      const client = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const login = await client.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      return { client, id: r.data.user.id };
    }
    const x = await user(),
      y = await user();
    a = x.client;
    b = y.client;
    uidA = x.id;
    uidB = y.id;
    mall = crypto.randomUUID();
    zone = crypto.randomUUID();
    bay = crypto.randomUUID();
    for (const [table, value] of [
      ["malls", { id: mall, name: "Integration " + suffix }],
      [
        "zones",
        {
          id: zone,
          mall_id: mall,
          name: "Isolated",
          floor: "B1",
          map_region_key: "A",
        },
      ],
      ["bays", { id: bay, zone_id: zone, label: "TEST-01" }],
    ] as const) {
      const r = await root.from(table).insert(value);
      if (r.error) throw r.error;
    }
  });
  afterAll(async () => {
    if (!root) return;
    const { data } = await root
      .from("reservations")
      .select("id")
      .eq("bay_id", bay);
    if (data?.length)
      await root
        .from("booking_events")
        .delete()
        .in(
          "reservation_id",
          data.map((x) => x.id),
        );
    await root.from("reservations").delete().eq("bay_id", bay);
    await root.from("bays").delete().eq("id", bay);
    await root.from("zones").delete().eq("id", zone);
    await root.from("parking_floors").delete().eq("mall_id", mall);
    await root.from("malls").delete().eq("id", mall);
    if (uidA) await root.auth.admin.deleteUser(uidA);
    if (uidB) await root.auth.admin.deleteUser(uidB);
  });
  const reserve = (
    client: SupabaseClient,
    key = crypto.randomUUID(),
    start = s,
    end = e,
  ) =>
    client.rpc("reserve", {
      p_mall: mall,
      p_zone: zone,
      p_start: start,
      p_end: end,
      p_destination: null,
      p_preference: "none",
      p_key: key,
      p_plate: "TEST" + String(key).replaceAll("-", "").slice(0, 12),
    });
  it("handles races, exclusion ranges, idempotency, RLS and inactive bays", async () => {
    const key = crypto.randomUUID();
    const [one, two] = await Promise.all([reserve(a, key), reserve(a, key)]);
    expect(one.error).toBeNull();
    expect(two.data.id).toBe(one.data.id);
    const events = await root
      .from("booking_events")
      .select("*")
      .eq("reservation_id", one.data.id);
    expect(
      events.data?.filter((e) => e.event_type === "confirmed"),
    ).toHaveLength(1);
    expect(
      (await reserve(a, key, s, new Date(Date.parse(e) + 60000).toISOString()))
        .error,
    ).toBeTruthy();
    const foreign = await b
      .from("reservations")
      .select("*")
      .eq("id", one.data.id);
    expect(foreign.data).toEqual([]);
    const anonymous = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    expect(
      (
        await anonymous.rpc("transition", {
          p_id: one.data.id,
          p_next: "checked_in",
        })
      ).error,
    ).toBeTruthy();
    expect(
      (await b.rpc("transition", { p_id: one.data.id, p_next: "checked_in" }))
        .error?.code,
    ).toBe("P0002");
    expect(
      (await b.rpc("booking_details", { p_token: one.data.check_in_token }))
        .error?.code,
    ).toBe("P0002");
    expect(
      (await b.rpc("advance_demo_clock", { p_minutes: 15 })).error?.code,
    ).toBe("42501");
    expect(
      (await b.rpc("reset_demo", { p_confirmation: "RESET" })).error?.code,
    ).toBe("42501");
    expect(
      (await b.from("user_roles").update({ role: "admin" }).eq("user_id", uidB))
        .error,
    ).toBeTruthy();
    expect(
      (
        await a
          .from("reservations")
          .update({ status: "completed" })
          .eq("id", one.data.id)
      ).error,
    ).toBeTruthy();
    expect((await reserve(b)).error?.code).toBe("23P01");
    expect(
      (
        await reserve(
          b,
          crypto.randomUUID(),
          new Date(Date.parse(s) + 60000).toISOString(),
          new Date(Date.parse(e) + 60000).toISOString(),
        )
      ).error?.code,
    ).toBe("23P01");
    const adjacent = await reserve(
      b,
      crypto.randomUUID(),
      e,
      new Date(Date.parse(e) + 3600000).toISOString(),
    );
    expect(adjacent.error).toBeNull();
    expect(
      (await a.rpc("transition", { p_id: one.data.id, p_next: "cancelled" }))
        .error,
    ).toBeNull();
    const [raceA, raceB] = await Promise.all([reserve(a), reserve(b)]);
    expect([raceA, raceB].filter((x) => !x.error)).toHaveLength(1);
    const winner = !raceA.error
      ? { client: a, id: raceA.data.id }
      : { client: b, id: raceB.data.id };
    expect(
      (
        await winner.client.rpc("transition", {
          p_id: winner.id,
          p_next: "cancelled",
        })
      ).error,
    ).toBeNull();
    await root.from("bays").update({ is_active: false }).eq("id", bay);
    expect((await reserve(a)).error?.code).toBe("23P01");
  });
});

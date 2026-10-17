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
const enabled = process.env.RUN_LOCAL_DB_TESTS === "1",
  url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
describe.skipIf(!enabled)(
  "LOCAL exact-bay, map and multi-preference integration",
  () => {
    let root: SupabaseClient,
      a: SupabaseClient,
      b: SupabaseClient,
      anon: SupabaseClient;
    const users: string[] = [],
      malls = [crypto.randomUUID(), crypto.randomUUID()],
      floors = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
      zones = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
      destinations = [crypto.randomUUID(), crypto.randomUUID()],
      bays = Array.from({ length: 7 }, () => crypto.randomUUID());
    const start = new Date(Date.now() + 86400000).toISOString(),
      end = new Date(Date.now() + 86400000 + 7200000).toISOString();
    async function q<T>(p: PromiseLike<{ data: T; error: unknown }>) {
      const r = await p;
      if (r.error) throw r.error;
      return r.data as NonNullable<T>;
    }
    async function clear() {
      if (!root || !users.length) return;
      const sessions = await root
        .from("parking_sessions")
        .select("id")
        .in("created_by", users);
      if (sessions.data?.length)
        await root
          .from("access_events")
          .delete()
          .in(
            "session_id",
            sessions.data.map((s) => s.id),
          );
      await root.from("access_events").delete().in("actor_user_id", users);
      await root.from("parking_sessions").delete().in("created_by", users);
      const rows = await q(
        root.from("reservations").select("id").in("user_id", users),
      );
      if (rows.length) {
        await q(
          root
            .from("booking_events")
            .delete()
            .in(
              "reservation_id",
              rows.map((r) => r.id),
            ),
        );
        await q(
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
    const reserve = (
      client: SupabaseClient,
      bay = bays[0],
      selected: string[] = [],
      required: string[] = [],
      key = crypto.randomUUID(),
    ) =>
      client.rpc("reserve_bay", {
        p_mall: malls[0],
        p_bay: bay,
        p_start: start,
        p_end: end,
        p_destination: destinations[0],
        p_selected: selected,
        p_required: required,
        p_key: key,
        p_plate: "TEST" + String(key).replaceAll("-", "").slice(0, 12),
      });
    const availability = () =>
      q(
        anon.rpc("bay_availability", {
          p_mall: malls[0],
          p_start: start,
          p_end: end,
        }),
      );
    beforeAll(async () => {
      if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(url))
        throw new Error("Refusing remote map tests.");
      root = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      async function user() {
        const email = `map-${crypto.randomUUID()}@example.test`,
          password = crypto.randomUUID() + "Aa1!";
        const r = await root.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (r.error) throw r.error;
        users.push(r.data.user.id);
        const c = createClient(
          url,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false } },
        );
        const login = await c.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        return c;
      }
      a = await user();
      b = await user();
      await q(
        root
          .from("malls")
          .insert(malls.map((id) => ({ id, name: "Isolated map test" }))),
      );
      await q(
        root.from("parking_floors").insert(
          floors.map((id, i) => ({
            id,
            mall_id: malls[i === 2 ? 1 : 0],
            name: i === 1 ? "B2" : "B1",
            is_active: i !== 1,
          })),
        ),
      );
      await q(
        root.from("zones").insert(
          zones.map((id, i) => ({
            id,
            mall_id: malls[i === 3 ? 1 : 0],
            name: "Test zone " + i,
            floor: "B1",
            floor_id: floors[i === 3 ? 2 : i === 2 ? 1 : 0],
            map_region_key: "T",
          })),
        ),
      );
      await q(
        root.from("destinations").insert(
          destinations.map((id, i) => ({
            id,
            mall_id: malls[i],
            name: "Test Cinema",
            category: "Demo",
          })),
        ),
      );
      await q(
        root.from("zone_destination_routes").insert([
          {
            zone_id: zones[0],
            destination_id: destinations[0],
            walking_distance_m: 120,
            is_verified: true,
            is_step_free: true,
          },
          {
            zone_id: zones[1],
            destination_id: destinations[0],
            walking_distance_m: 0,
            is_verified: false,
            is_step_free: null,
          },
        ]),
      );
      await q(
        root.from("bays").insert(
          bays.map((id, i) => ({
            id,
            zone_id: zones[i === 6 ? 3 : i === 5 ? 2 : i === 1 ? 1 : 0],
            label: "T-" + i,
            is_active: i !== 4,
            bay_type: i === 3 ? "accessible" : "standard",
            map_x: 10 + i * 90,
            map_y: 50,
            width_mm: i === 2 ? null : i === 1 ? 2400 : 2700,
            lift_distance_m: i === 2 ? null : i === 1 ? 90 : 20,
            walkway_distance_m: i === 2 ? null : i === 1 ? 30 : 10,
            exit_driving_distance_m: i === 2 ? null : i === 1 ? 80 : 300,
          })),
        ),
      );
    });
    beforeEach(async () => {
      if (!root) return;
      await q(
        root
          .from("bays")
          .update({ is_active: true, width_mm: 2700, lift_distance_m: 20 })
          .eq("id", bays[0]),
      );
      await q(
        root
          .from("zone_destination_routes")
          .update({
            is_verified: true,
            is_step_free: true,
            walking_distance_m: 120,
          })
          .eq("zone_id", zones[0]),
      );
    });
    afterEach(clear);
    afterAll(async () => {
      if (!root) return;
      await clear();
      await q(root.from("bays").delete().in("id", bays));
      await q(
        root.from("zone_destination_routes").delete().in("zone_id", zones),
      );
      await q(root.from("destinations").delete().in("id", destinations));
      await q(root.from("zones").delete().in("id", zones));
      await q(root.from("parking_floors").delete().in("id", floors));
      await q(root.from("malls").delete().in("id", malls));
      for (const id of users) await root.auth.admin.deleteUser(id);
    });
    it("loads four distinct scoped fictional layouts with correct labels and geometry", async () => {
      const catalog = await q(
        anon
          .from("malls")
          .select("id,layout_key")
          .not("layout_key", "is", null),
      );
      expect(catalog).toHaveLength(4);
      const signatures = new Set();
      for (const mall of catalog) {
        const fs = await q(
          anon.from("parking_floors").select("*").eq("mall_id", mall.id),
        );
        expect(fs).toHaveLength(2);
        const map = await q(
          anon.rpc("floor_map", { p_mall: mall.id, p_floor: fs[0].id }),
        );
        expect(map.bays.length).toBeGreaterThan(10);
        for (const item of map.bays) {
          expect(item.floorId).toBe(map.floor.id);
          expect(item.x + item.width).toBeLessThanOrEqual(map.floor.map_width);
          expect(item.y + item.height).toBeLessThanOrEqual(
            map.floor.map_height,
          );
          expect(item.label).toBeTruthy();
        }
        signatures.add(
          JSON.stringify(
            map.features
              .filter((f: { type: string }) => f.type === "driving_lane")
              .map((f: { geometry: unknown }) => f.geometry),
          ),
        );
      }
      expect(signatures.size).toBe(4);
    });
    it("reserves the exact chosen bay and never substitutes another during a race", async () => {
      const [one, two] = await Promise.all([reserve(a), reserve(b)]);
      expect([one, two].filter((r) => !r.error)).toHaveLength(1);
      const success = !one.error ? one : two,
        failed = one.error ? one : two;
      expect(success.data.bay_id).toBe(bays[0]);
      expect(failed.error?.code).toBe("23P01");
      const available = await availability();
      expect(
        available.bays.find((r: { id: string }) => r.id === bays[1]).status,
      ).toBe("available");
    });
    it("returns one result/event for concurrent idempotent retries and conflicts on another selected bay", async () => {
      const key = crypto.randomUUID();
      const [x, y] = await Promise.all([
        reserve(a, bays[0], ["near_lift", "wider_bay"], ["near_lift"], key),
        reserve(a, bays[0], ["wider_bay", "near_lift"], ["near_lift"], key),
      ]);
      expect(x.error).toBeNull();
      expect(y.data.id).toBe(x.data.id);
      expect(
        (
          await q(
            root
              .from("booking_events")
              .select("*")
              .eq("reservation_id", x.data.id)
              .eq("event_type", "confirmed"),
          )
        ).length,
      ).toBe(1);
      expect(
        (
          await reserve(
            a,
            bays[1],
            ["near_lift", "wider_bay"],
            ["near_lift"],
            key,
          )
        ).error?.code,
      ).toBe("23505");
    });
    it("uses interval conflicts, adjacency and safe reason codes without private booking identifiers", async () => {
      const r = await q(reserve(a));
      const data = await availability();
      expect(
        data.bays.find((r: { id: string }) => r.id === bays[0]),
      ).toMatchObject({ status: "reserved", reason: "reservation_conflict" });
      for (const privateValue of [r.id, r.check_in_token, users[0]])
        expect(JSON.stringify(data)).not.toContain(privateValue);
      const adjacent = await q(
        anon.rpc("bay_availability", {
          p_mall: malls[0],
          p_start: end,
          p_end: new Date(Date.parse(end) + 3600000).toISOString(),
        }),
      );
      expect(
        adjacent.bays.find((r: { id: string }) => r.id === bays[0]).status,
      ).toBe("available");
      await q(a.rpc("transition", { p_id: r.id, p_next: "cancelled" }));
      expect(
        (await availability()).bays.find(
          (r: { id: string }) => r.id === bays[0],
        ).status,
      ).toBe("available");
    });
    it("does not replay an exact request key through automatic assignment", async () => {
      const key = crypto.randomUUID();
      const exact = await q(reserve(a, bays[0], [], [], key));
      const legacy = await a.rpc("reserve", {
        p_mall: malls[0],
        p_zone: zones[0],
        p_start: start,
        p_end: end,
        p_destination: destinations[0],
        p_preference: "none",
        p_key: key,
        p_plate: "TEST" + String(key).replaceAll("-", "").slice(0, 12),
      });
      expect(legacy.error?.code).toBe("23505");
      expect(
        (
          await q(
            root
              .from("booking_events")
              .select("*")
              .eq("reservation_id", exact.id)
              .eq("event_type", "confirmed"),
          )
        ).length,
      ).toBe(1);
    });
    it("rejects geometry outside its floor and duplicate labels in another zone of the same mall", async () => {
      expect(
        (await root.from("bays").update({ map_x: 9999 }).eq("id", bays[0]))
          .error?.code,
      ).toBe("22023");
      expect(
        (
          await root.from("parking_map_features").insert({
            floor_id: floors[0],
            type: "landmark",
            label: "Outside",
            geometry: { kind: "point", x: 2000, y: 10 },
          })
        ).error?.code,
      ).toBe("22023");
      expect(
        (await root.from("bays").insert({ zone_id: zones[1], label: "T-0" }))
          .error?.code,
      ).toBe("23505");
    });
    it("marks inactive floors, bays and restricted bays unavailable and rejects their allocation", async () => {
      const data = await availability();
      for (const index of [3, 4, 5]) {
        expect(
          data.bays.find((r: { id: string }) => r.id === bays[index]).status,
        ).toBe("unavailable");
        expect((await reserve(a, bays[index])).error).toBeTruthy();
      }
      expect(
        (await reserve(a, bays[3], ["step_free"], ["step_free"])).error,
      ).toBeTruthy();
    });
    it("enforces required constraints, permits soft trade-offs and never treats unknown data as zero", async () => {
      expect(
        (await reserve(a, bays[1], ["wider_bay"], ["wider_bay"])).error?.code,
      ).toBe("P0003");
      expect((await reserve(a, bays[1], ["wider_bay"])).error).toBeNull();
      const ranked = await q(
        anon.rpc("recommend_bays", {
          p_mall: malls[0],
          p_start: start,
          p_end: end,
          p_destination: destinations[0],
          p_selected: [
            "shorter_walk",
            "step_free",
            "near_lift",
            "near_exit",
            "wider_bay",
            "near_walkway",
          ],
          p_required: [],
        }),
      );
      const unknown = ranked.bays.find((r: { id: string }) => r.id === bays[2]);
      expect(unknown.evaluation.values.widthMm).toBeNull();
      expect(unknown.evaluation.matched).not.toContain("wider_bay");
      expect(unknown.evaluation.unknown).toContain("near_lift");
      const route = ranked.bays.find((r: { id: string }) => r.id === bays[1]);
      expect(route.evaluation.values.walkingDistanceM).toBeNull();
      expect(route.evaluation.matched).not.toContain("shorter_walk");
    });
    it("returns an honest empty eligibility set for competing hard requirements, with stable soft ranking", async () => {
      const input = {
        p_mall: malls[0],
        p_start: start,
        p_end: end,
        p_destination: destinations[0],
        p_selected: ["near_lift", "near_exit"],
        p_required: ["near_lift", "near_exit"],
      };
      const data = await q(anon.rpc("recommend_bays", input));
      expect(
        data.bays.filter((r: { eligible: boolean }) => r.eligible),
      ).toEqual([]);
      const first = await q(
          anon.rpc("recommend_bays", { ...input, p_required: [] }),
        ),
        again = await q(
          anon.rpc("recommend_bays", { ...input, p_required: [] }),
        );
      expect(first.bays.map((r: { id: string }) => r.id)).toEqual(
        again.bays.map((r: { id: string }) => r.id),
      );
    });
    it("rejects cross-mall IDs, unknown preferences and unauthorized inventory writes", async () => {
      expect(
        (await anon.rpc("floor_map", { p_mall: malls[0], p_floor: floors[2] }))
          .error?.code,
      ).toBe("22023");
      expect((await reserve(a, bays[6])).error).toBeTruthy();
      expect(
        (
          await a.rpc("reserve_bay", {
            p_mall: malls[0],
            p_bay: bays[0],
            p_start: start,
            p_end: end,
            p_destination: destinations[1],
            p_selected: [],
            p_required: [],
            p_key: crypto.randomUUID(),
            p_plate:
              "TEST" +
              String(crypto.randomUUID()).replaceAll("-", "").slice(0, 12),
          })
        ).error?.code,
      ).toBe("22023");
      expect((await reserve(a, bays[0], ["safest_bay"])).error?.code).toBe(
        "22023",
      );
      expect((await reserve(anon)).error).toBeTruthy();
      expect(
        (await a.from("bays").update({ is_active: true }).eq("id", bays[4]))
          .error,
      ).toBeTruthy();
      expect(
        (
          await a.from("parking_map_features").insert({
            floor_id: floors[0],
            type: "landmark",
            label: "Bad",
            geometry: { kind: "point", x: 1, y: 1 },
          })
        ).error,
      ).toBeTruthy();
    });
    it("rechecks a changed required route and saves immutable booking-time explanations", async () => {
      const booked = await q(
        reserve(a, bays[0], ["step_free", "wider_bay"], ["step_free"]),
      );
      const saved = booked.recommendation_snapshot;
      await q(
        root
          .from("zone_destination_routes")
          .update({ is_verified: false, is_step_free: null })
          .eq("zone_id", zones[0]),
      );
      await q(root.from("bays").update({ width_mm: 2300 }).eq("id", bays[0]));
      const details = await q(a.rpc("booking_details", { p_id: booked.id }));
      expect(details.recommendation_snapshot).toEqual(saved);
      expect(
        (await reserve(b, bays[2], ["step_free"], ["step_free"])).error?.code,
      ).toBe("P0003");
      expect(
        (await b.rpc("booking_details", { p_id: booked.id })).error?.code,
      ).toBe("P0002");
    });
    it("releases a due no-show and returns that exact bay to future map availability", async () => {
      const booked = await q(reserve(a));
      await q(
        root
          .from("reservations")
          .update({
            start_at: new Date(Date.now() - 1800000).toISOString(),
            arrival_deadline: new Date(Date.now() - 900000).toISOString(),
            end_at: end,
          })
          .eq("id", booked.id),
      );
      const data = await availability();
      expect(
        data.bays.find((r: { id: string }) => r.id === bays[0]).status,
      ).toBe("available");
      expect(
        (
          await q(
            root
              .from("reservations")
              .select("status")
              .eq("id", booked.id)
              .single(),
          )
        ).status,
      ).toBe("no_show");
    });
  },
);

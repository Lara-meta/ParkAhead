import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const enabled = process.env.RUN_LOCAL_DB_TESTS === "1",
  url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
describe.skipIf(!enabled)("LOCAL OKU policy and inventory isolation", () => {
  let root: SupabaseClient,
    customer: SupabaseClient,
    admin: SupabaseClient,
    other: SupabaseClient;
  const users: string[] = [];
  let mall: string,
    mall2: string,
    bay: string,
    standard: string,
    request: string;
  const start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 93600000).toISOString();
  async function q<T>(p: PromiseLike<{ data: T; error: unknown }>) {
    const r = await p;
    if (r.error) throw r.error;
    return r.data as NonNullable<T>;
  }
  async function user(isAdmin = false) {
    const email = `oku-${crypto.randomUUID()}@example.test`,
      password = crypto.randomUUID() + "Aa1!";
    const created = await root.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const u = created.data;
    users.push(u.user.id);
    if (isAdmin)
      await q(
        root
          .from("user_roles")
          .update({ role: "admin" })
          .eq("user_id", u.user.id),
      );
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const login = await c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    return c;
  }
  const book = (
    id = bay,
    key = crypto.randomUUID(),
    required: string[] = [],
    destination: string | null = null,
  ) =>
    customer.rpc("reserve_bay", {
      p_mall: mall,
      p_bay: id,
      p_start: start,
      p_end: end,
      p_destination: destination,
      p_selected: required,
      p_required: required,
      p_key: key,
      p_plate: "OKU" + key.replaceAll("-", "").slice(0, 12),
    });
  beforeAll(async () => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(url))
      throw Error("Local only");
    root = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    customer = await user();
    admin = await user(true);
    other = await user();
    const ms = await q(
      root
        .from("malls")
        .select("id")
        .like("layout_key", "fictional-layout-%")
        .order("id"),
    );
    mall = ms[0].id;
    mall2 = ms[1].id;
    const bs = await q(
      root
        .from("bays")
        .select("id,bay_type")
        .eq("mall_id", mall)
        .eq("is_active", true)
        .eq("inventory_class", "bookable"),
    );
    bay = bs.find((b) => b.bay_type === "oku")!.id;
    standard = bs.find((b) => b.bay_type === "standard")!.id;
  });
  afterAll(async () => {
    if (!root) return;
    const rs = await q(
      root.from("reservations").select("id").in("user_id", users),
    );
    if (rs.length) {
      await q(
        root
          .from("booking_events")
          .delete()
          .in(
            "reservation_id",
            rs.map((r) => r.id),
          ),
      );
      await q(
        root
          .from("reservations")
          .delete()
          .in(
            "id",
            rs.map((r) => r.id),
          ),
      );
    }
    const es = await q(
      root.from("parking_eligibility").select("id").in("user_id", users),
    );
    if (es.length)
      await q(
        root
          .from("eligibility_events")
          .delete()
          .in(
            "eligibility_id",
            es.map((e) => e.id),
          ),
      );
    await q(root.from("parking_eligibility").delete().in("user_id", users));
    for (const id of users) {
      const removed = await root.auth.admin.deleteUser(id);
      if (removed.error) throw removed.error;
    }
  });
  it("blocks undeclared exact OKU booking", async () => {
    expect((await book()).error?.code).toBe("P0004");
  });
  it("keeps standard parking independent", async () => {
    expect((await book(standard)).error).toBeNull();
  });
  it("creates only own pending request and retries without duplicate events", async () => {
    const r = await q(customer.rpc("request_eligibility", { p_mall: mall }));
    request = r.id;
    const again = await q(
      customer.rpc("request_eligibility", { p_mall: mall }),
    );
    expect(again.id).toBe(request);
    expect(
      (
        await q(
          root
            .from("eligibility_events")
            .select("*")
            .eq("eligibility_id", request),
        )
      ).length,
    ).toBe(1);
  });
  it("denies self review and direct status changes", async () => {
    expect(
      (
        await customer.rpc("review_eligibility", {
          p_id: request,
          p_status: "approved",
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await customer
          .from("parking_eligibility")
          .update({ status: "approved" })
          .eq("id", request)
      ).error,
    ).not.toBeNull();
  });
  it("keeps customer requests private", async () => {
    expect(
      await q(other.from("parking_eligibility").select("*").eq("id", request)),
    ).toHaveLength(0);
    expect(
      await q(
        other
          .from("eligibility_events")
          .select("*")
          .eq("eligibility_id", request),
      ),
    ).toHaveLength(0);
  });
  it("does not treat pending eligibility as bookable", async () => {
    const r = await q(
      customer.rpc("recommend_bays", {
        p_mall: mall,
        p_start: start,
        p_end: end,
      }),
    );
    expect(r.bays.find((b: { id: string }) => b.id === bay).eligible).toBe(
      false,
    );
    expect((await book()).error?.code).toBe("P0004");
  });
  it("approval at another mall does not apply", async () => {
    const e = await q(customer.rpc("request_eligibility", { p_mall: mall2 }));
    await q(
      admin.rpc("review_eligibility", { p_id: e.id, p_status: "approved" }),
    );
    expect((await book()).error?.code).toBe("P0004");
  });
  it("allows rejection and a new review request", async () => {
    await q(
      admin.rpc("review_eligibility", { p_id: request, p_status: "rejected" }),
    );
    expect((await book()).error?.code).toBe("P0004");
    expect(
      (await q(customer.rpc("request_eligibility", { p_mall: mall }))).status,
    ).toBe("pending");
  });
  it("snapshots approval and location with idempotent exact booking", async () => {
    await q(
      admin.rpc("review_eligibility", {
        p_id: request,
        p_status: "approved",
        p_expires: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    const key = crypto.randomUUID(),
      r = await q(book(bay, key)),
      again = await q(book(bay, key));
    expect(again.id).toBe(r.id);
    const row = await q(
      root
        .from("reservations")
        .select("eligibility_snapshot,location_snapshot")
        .eq("id", r.id)
        .single(),
    );
    expect(row.eligibility_snapshot.status).toBe("approved");
    expect(row.location_snapshot.bayId).toBe(bay);
    expect(row.location_snapshot.bayLabel).toMatch(/^B[12]-[A-Z]\d{2}$/);
  });
  it("expired approval blocks new bookings but preserves existing decision", async () => {
    await q(
      root
        .from("parking_eligibility")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", request),
    );
    expect((await book()).error?.code).toBe("P0004");
    const rows = await q(
      root
        .from("reservations")
        .select("status,eligibility_snapshot")
        .eq("user_id", users[0])
        .eq("bay_id", bay),
    );
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].eligibility_snapshot.status).toBe("approved");
  });
  it("approval cannot bypass required unknown routes", async () => {
    await q(
      admin.rpc("review_eligibility", { p_id: request, p_status: "approved" }),
    );
    const destination = crypto.randomUUID();
    await q(
      root.from("destinations").insert({
        id: destination,
        mall_id: mall,
        name: "Isolated unknown OKU route",
        category: "Demo",
      }),
    );
    try {
      expect(
        (await book(bay, crypto.randomUUID(), ["step_free"], destination)).error
          ?.code,
      ).toBe("P0003");
    } finally {
      await q(root.from("destinations").delete().eq("id", destination));
    }
  });
  it("public availability exposes types without private eligibility", async () => {
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      }),
      r = await q(
        anon.rpc("bay_availability", {
          p_mall: mall,
          p_start: start,
          p_end: end,
        }),
      );
    expect(r.bays.some((b: { bayType: string }) => b.bayType === "oku")).toBe(
      true,
    );
    expect(JSON.stringify(r)).not.toContain(users[0]);
    expect(JSON.stringify(r)).not.toContain(request);
  });
  it("booking on one floor leaves matching code on another independent", async () => {
    const row = await q(
        root.from("bays").select("label").eq("id", standard).single(),
      ),
      otherLabel = row.label.replace(
        /^B[12]/,
        row.label.startsWith("B1") ? "B2" : "B1",
      ),
      r = await q(
        customer.rpc("bay_availability", {
          p_mall: mall,
          p_start: start,
          p_end: end,
        }),
      );
    expect(
      r.bays.find((b: { label: string }) => b.label === row.label).status,
    ).toBe("reserved");
    const other = r.bays.find((b: { label: string }) => b.label === otherLabel);
    if (other) expect(other.status).not.toBe("reserved");
  });
  it("floor-scoped zone labels and qualified bay labels stay unambiguous", async () => {
    const zs = await q(
      root
        .from("zones")
        .select("id,name,floor_id")
        .eq("mall_id", mall)
        .eq("name", "Zone A"),
    );
    expect(zs.length).toBe(2);
    expect(new Set(zs.map((z) => z.floor_id)).size).toBe(2);
    const bs = await q(
      root
        .from("bays")
        .select("id,label,zone_id")
        .in(
          "zone_id",
          zs.map((z) => z.id),
        ),
    );
    expect(new Set(bs.map((b) => b.label)).size).toBe(bs.length);
    expect(bs.some((b) => b.label === "B1-A01")).toBe(true);
    expect(bs.some((b) => b.label === "B2-A01")).toBe(true);
  });
  it("materializes distinct per-mall templates with independent floor inventory", async () => {
    const ts = await q(root.from("mall_layout_templates").select("*"));
    expect(ts).toHaveLength(4);
    expect(new Set(ts.map((t) => t.mall_id)).size).toBe(4);
    const fs = await q(
      root
        .from("parking_floors")
        .select("id,layout_template_id")
        .eq("mall_id", mall),
    );
    expect(fs[0].layout_template_id).toBe(fs[1].layout_template_id);
    expect(fs[0].id).not.toBe(fs[1].id);
  });
  it("removes simulator RPCs and configuration access", async () => {
    expect(
      (
        await admin.rpc("simulate_gate", {
          p_gate: crypto.randomUUID(),
          p_plate: "ABC123",
          p_direction: "entry",
        })
      ).error?.code,
    ).toBe("PGRST202");
    expect((await customer.from("gates").select("*")).error).not.toBeNull();
  });
});

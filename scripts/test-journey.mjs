// Creates temporary admin/customer accounts for LOCAL E2E. Credentials stay in child env.
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (
  process.env.RUN_LOCAL_DB_TESTS !== "1" ||
  !/^http:\/\/(localhost|127\.0\.0\.1):/.test(url)
)
  throw new Error(
    "Set RUN_LOCAL_DB_TESTS=1 and use a disposable LOCAL Supabase.",
  );
const root = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const checked = async (p) => {
  const r = await p;
  if (r.error) throw r.error;
  return r.data;
};
const active = await checked(
  root
    .from("reservations")
    .select("id")
    .eq("is_demo", true)
    .in("status", ["confirmed", "checked_in"]),
);
if (active.length)
  throw new Error(
    "Active demo bookings exist. Use a disposable project or finish those bookings before this test run.",
  );
const saved = await checked(root.from("runtime_settings").select("*").single());
let id, customerId;
const customerEmail = `customer-${crypto.randomUUID()}@example.test`,
  customerPassword = crypto.randomUUID() + "Aa1!";
try {
  const email = `e2e-${crypto.randomUUID()}@example.test`,
    password = crypto.randomUUID() + "Aa1!";
  const user = await root.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (user.error) throw user.error;
  id = user.data.user.id;
  const customer = await checked(
    root.auth.admin.createUser({
      email: customerEmail,
      password: customerPassword,
      email_confirm: true,
    }),
  );
  customerId = customer.user.id;
  await checked(
    root.from("user_roles").update({ role: "admin" }).eq("user_id", id),
  );
  await checked(
    root
      .from("runtime_settings")
      .update({
        demo_mode: true,
        demo_now: "2030-01-15T02:00:00Z",
        grace_minutes: 30,
      })
      .eq("singleton", true),
  );
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--workers=1",
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_CUSTOMER_EMAIL: customerEmail,
          E2E_CUSTOMER_PASSWORD: customerPassword,
          E2E_EMAIL: email,
          E2E_PASSWORD: password,
          E2E_DEMO_READY: "1",
        },
      },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  process.exitCode = exit ?? 1;
} finally {
  try {
    for (const cleanupId of [customerId, id].filter(Boolean)) {
      const id = cleanupId;
      const owned = await checked(
        root.from("reservations").select("id").eq("user_id", id),
      );
      const ownedIds = owned.map((r) => r.id);
      if (ownedIds.length) {
        const linked = await checked(
          root
            .from("parking_sessions")
            .select("id")
            .in("reservation_id", ownedIds),
        );
        if (linked.length)
          await checked(
            root
              .from("access_events")
              .delete()
              .in(
                "session_id",
                linked.map((s) => s.id),
              ),
          );
        await checked(
          root.from("access_events").delete().in("reservation_id", ownedIds),
        );
        await checked(
          root.from("parking_sessions").delete().in("reservation_id", ownedIds),
        );
      }
      const sessions = await checked(
        root.from("parking_sessions").select("id").eq("created_by", id),
      );
      if (sessions.length)
        await checked(
          root
            .from("access_events")
            .delete()
            .in(
              "session_id",
              sessions.map((s) => s.id),
            ),
        );
      await checked(
        root.from("access_events").delete().eq("actor_user_id", id),
      );
      await checked(
        root.from("parking_sessions").delete().eq("created_by", id),
      );
      const rows = await checked(
        root.from("reservations").select("id").eq("user_id", id),
      );
      if (rows.length) {
        await checked(
          root
            .from("booking_events")
            .delete()
            .in(
              "reservation_id",
              rows.map((r) => r.id),
            ),
        );
        await checked(
          root
            .from("reservations")
            .delete()
            .in(
              "id",
              rows.map((r) => r.id),
            ),
        );
      }
      const eligibility = await checked(
        root.from("parking_eligibility").select("id").eq("user_id", id),
      );
      if (eligibility.length)
        await checked(
          root
            .from("eligibility_events")
            .delete()
            .in(
              "eligibility_id",
              eligibility.map((e) => e.id),
            ),
        );
      await checked(
        root.from("parking_eligibility").delete().eq("user_id", id),
      );
      await checked(root.auth.admin.deleteUser(id));
    }
  } finally {
    await checked(
      root.from("runtime_settings").update(saved).eq("singleton", true),
    );
  }
}

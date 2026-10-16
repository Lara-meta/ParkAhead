// Creates one temporary admin for LOCAL E2E only. Credentials stay in child env.
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
let id;
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
  await checked(
    root.from("user_roles").update({ role: "admin" }).eq("user_id", id),
  );
  await checked(
    root
      .from("runtime_settings")
      .update({
        demo_mode: true,
        demo_now: "2030-01-15T02:00:00Z",
        grace_minutes: 15,
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
  if (id) {
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
    await root.auth.admin.deleteUser(id);
  }
  await checked(
    root.from("runtime_settings").update(saved).eq("singleton", true),
  );
}

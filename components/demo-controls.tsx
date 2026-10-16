"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client-api";
import type { DemoDashboard } from "@/lib/lifecycle";
import type { Zone as AvailabilityZone } from "@/lib/rules";
import { displayTime } from "@/lib/rules";
import { Button } from "@/components/ui/button";
import { MetricsPanel } from "@/components/demo-metrics";
export function DemoControls() {
  const [data, setData] = useState<DemoDashboard | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [minutes, setMinutes] = useState(5),
    [confirm, setConfirm] = useState(""),
    [quote, setQuote] = useState(""),
    [changed, setChanged] = useState<string[]>([]),
    [availability, setAvailability] = useState<AvailabilityZone[]>([]),
    [previousAvailability, setPreviousAvailability] = useState<
      AvailabilityZone[]
    >([]);
  async function load() {
    const d = await api<DemoDashboard>("admin/demo");
    setData(d);
    if (d.clock.demoMode) {
      const start = new Date(Date.parse(d.clock.now) + 60000).toISOString(),
        end = new Date(Date.parse(d.clock.now) + 3600000).toISOString();
      setAvailability(
        await api<AvailabilityZone[]>(
          "availability?" +
            new URLSearchParams({
              mallId: "10000000-0000-4000-8000-000000000001",
              startAt: start,
              endAt: end,
              preference: "none",
            }),
        ),
      );
    }
    return d;
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api<{ quote: string }>("demo/story")
      .then((r) => setQuote(r.quote))
      .catch(() => {});
  }, []);
  async function act(action: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setPreviousAvailability(availability);
    try {
      const result = await api<unknown>("admin/demo/" + action, body);
      const d = await load();
      setChanged(
        d.bookings
          .filter(
            (b) =>
              data?.bookings.find((old) => old.id === b.id)?.status !==
              b.status,
          )
          .map((b) => b.id),
      );
      setMessage(
        action === "cleanup"
          ? `Cleanup finished: ${result} reservation(s) released by this run. Other server paths or the scheduler may have released due bookings first.`
          : action === "reset"
            ? "Your fictional fixtures were reset. Authentication users and unrelated bookings were preserved."
            : action === "rebook"
              ? "A subsequent booking was stored. Open its details below."
              : action === "story"
                ? "Illustrative statement saved."
                : "Server demo clock advanced.",
      );
      if (action === "reset") setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo action failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="panel">
        <h1 className="mb-5 text-3xl font-semibold">Demo controls</h1>
        {error ? (
          <>
            <p role="alert" className="mb-4 text-red-800">
              {error}
            </p>
            <Button asChild>
              <Link href="/auth?returnTo=/admin/demo">
                Sign in as an authorized demo admin
              </Link>
            </Button>
          </>
        ) : (
          <p role="status">Checking administrator authorization…</p>
        )}
      </section>
    );
  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Admin-only · Fictional scenarios</span>
        <h1 className="my-3 text-4xl font-semibold">
          A whole parking journey, in minutes.
        </h1>
        <p className="muted">
          The database scheduler runs without this page. Manual cleanup is a
          presentation aid.
        </p>
      </div>
      {error && (
        <p role="alert" className="notice bg-red-50 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel">
        <h2 className="text-2xl font-semibold">Demo clock</h2>
        <p className="my-4 text-lg">
          {data.clock.demoMode
            ? "DEMO MODE · " + displayTime(data.clock.now)
            : "Demo mode is disabled. Real database time is active."}
        </p>
        {!data.clock.demoMode && (
          <p className="notice mb-4">
            An operator must enable demo_mode in runtime_settings. See README.
            Controls cannot enable it or change non-demo booking time.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label>
            Advance by minutes
            <input
              type="number"
              min={1}
              max={10080}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <Button
            disabled={
              busy ||
              !data.clock.demoMode ||
              !Number.isInteger(minutes) ||
              minutes < 1 ||
              minutes > 10080
            }
            onClick={() => act("advance", { minutes })}
          >
            Advance demo time
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act("cleanup", {})}
          >
            Run no-show cleanup now
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Refresh dashboard
          </Button>
        </div>
        <p className="mt-4 text-xs muted">
          Last cleanup:{" "}
          {data.lastCleanup
            ? `${displayTime(data.lastCleanup.executed_at)} (real execution time) · ${data.lastCleanup.released_count} released`
            : "No cleanup run recorded."}
        </p>
      </section>
      <MetricsPanel metrics={data.metrics} />
      <section className="panel">
        <h2 className="text-2xl font-semibold">
          Availability for the next hour
        </h2>
        <p className="my-3 text-sm muted">
          Query starts one minute after demo time. Counts describe scheduled
          availability only.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {availability.map((z) => {
            const old = previousAvailability.find((v) => v.zoneId === z.zoneId);
            return (
              <div key={z.zoneId} className="rounded-xl bg-[#f1f5eb] p-4">
                <p className="font-semibold">{z.zoneName}</p>
                <p>{z.availableBayCount} bookable standard bays</p>
                {old && old.availableBayCount !== z.availableBayCount && (
                  <p className="mt-2 text-sm font-bold">
                    Changed: {old.availableBayCount} → {z.availableBayCount}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2 className="text-2xl font-semibold">Scenario bookings</h2>
        <p className="my-4 text-sm muted">
          A: Cinema + step-free, start 10:05 MYT. B: no-show, start 09:55,
          deadline 10:10. Advance five minutes for A; advance past 10:10 for B.
          C uses B’s released arrival link.
        </p>
        <div className="space-y-4">
          {!data.bookings.length && (
            <p>
              No fixtures loaded. Confirm a reset below to load your scenarios.
            </p>
          )}
          {data.bookings.map((b) => (
            <article
              key={b.id}
              className={`rounded-xl border p-4 ${changed.includes(b.id) ? "border-emerald-700 bg-emerald-50" : "border-slate-200"}`}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <h3 className="font-semibold">
                  Scenario {b.demo_scenario}
                  {b.demo_rebooking_of
                    ? " · explicit subsequent booking"
                    : ""}{" "}
                  · {b.bays.zones.name} · {b.bays.label}
                </h3>
                <span className="status">{b.status}</span>
              </div>
              <p className="my-3 text-xs muted">
                {displayTime(b.start_at)} → {displayTime(b.end_at)} · Arrival
                deadline {displayTime(b.arrival_deadline)}
              </p>
              <div className="flex flex-wrap gap-3 text-sm underline">
                <Link href={"/bookings/" + b.id}>Booking details</Link>
                <Link href={"/arrival/" + b.check_in_token}>
                  Open arrival screen
                </Link>
                <Link href={"/bookings/" + b.id + "/zone"}>
                  Find my parking zone
                </Link>
              </div>
              {b.status === "no_show" && !b.demo_rebooking_of && (
                <Button
                  className="mt-4"
                  disabled={
                    busy ||
                    data.bookings.some((x) => x.demo_rebooking_of === b.id)
                  }
                  onClick={() => act("rebook", { reservationId: b.id })}
                >
                  Book the remaining interval
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2 className="text-2xl font-semibold">
          Load / reset your fictional scenarios
        </h2>
        <p className="my-3 text-sm muted">
          Resets the shared demo clock to 15 January 2030, 10:00 MYT. Deletes
          only fixtures and explicit fixture rebookings owned by your admin
          account. Other demo bookings keep their data, but share this clock;
          normal bookings keep real time. Use a dedicated demo environment. A
          conflict aborts the entire reset.
        </p>
        <label>
          Type RESET to confirm
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </label>
        <Button
          className="mt-4"
          disabled={busy || confirm !== "RESET" || !data.clock.demoMode}
          onClick={() => act("reset", { confirmation: confirm })}
        >
          Reset fictional scenarios
        </Button>
      </section>
      <section className="panel">
        <h2 className="text-2xl font-semibold">Illustrative user statement</h2>
        <label className="mt-4 block">
          Editable presentation quote (not an interview)
          <textarea
            className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-3 font-normal"
            minLength={20}
            maxLength={600}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
          />
        </label>
        <Button
          className="mt-4"
          disabled={busy || quote.trim().length < 20}
          onClick={() => act("story", { quote })}
        >
          Save illustrative statement
        </Button>
      </section>
      <p className="notice">
        All check-ins, departures, maps, route verification and availability are
        simulated. A release is not evidence that a physical bay is empty. No
        real-world performance gains are claimed.
      </p>
    </div>
  );
}

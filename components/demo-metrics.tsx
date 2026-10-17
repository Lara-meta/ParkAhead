"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { DemoMetrics } from "@/lib/lifecycle";
export function MetricsPanel({ metrics }: { metrics: DemoMetrics | null }) {
  return (
    <section className="panel">
      <span className="eyebrow">Actual stored demo events</span>
      <h2 className="my-3 text-2xl font-semibold">
        What happened in the simulation
      </h2>
      {metrics ? (
        <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            ["Demo reservations created", metrics.reservationsCreated],
            ["Successful simulated check-ins", metrics.checkIns],
            ["Completed simulated sessions", metrics.completed],
            ["No-show reservations released", metrics.noShows],
            [
              "Scheduled minutes released in simulation",
              Math.round(metrics.scheduledMinutesReleased * 10) / 10,
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-xl bg-[var(--surface-muted)] p-4"
            >
              <dd className="mb-2 text-3xl font-semibold">{value}</dd>
              <dt className="text-xs leading-5 muted">{label}</dt>
            </div>
          ))}
        </dl>
      ) : (
        <p className="my-4 muted">
          Metrics unavailable. No results are invented.
        </p>
      )}
      <p className="mt-5 text-xs leading-5 muted">
        Released minutes = max(0, original end − release time), counted once per
        stored no-show release event. Available capacity is not proof of
        rebooking, time saved, revenue, emissions or reduced congestion.
      </p>
    </section>
  );
}
export function LiveMetrics() {
  const [metrics, setMetrics] = useState<DemoMetrics | null>(null),
    [error, setError] = useState("");
  const load = () =>
    api<DemoMetrics>("demo/metrics")
      .then((m) => {
        setMetrics(m);
        setError("");
      })
      .catch(() => {
        setMetrics(null);
        setError("Could not refresh live metrics.");
      });
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <MetricsPanel metrics={metrics} />
      <button className="my-3 text-sm underline" onClick={load}>
        Refresh stored metrics
      </button>
      {error && (
        <p role="status" className="text-sm muted">
          {error}
        </p>
      )}
    </>
  );
}

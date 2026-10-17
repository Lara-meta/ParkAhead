import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { LiveMetrics } from "@/components/demo-metrics";
import { UserVoice } from "@/components/user-voice";
export default function Page() {
  return (
    <PageShell>
      <div className="space-y-8">
        <section className="py-7">
          <span className="eyebrow">ParkAhead · Hackathon story</span>
          <h1 className="my-5 max-w-3xl text-5xl font-semibold leading-tight">
            A little planning.
            <br />
            <span className="text-[var(--brand-secondary)]">
              A better arrival.
            </span>
          </h1>
          <p className="max-w-2xl text-lg leading-8 muted">
            Book → Find your zone → Arrive → Simulate check-in → Complete
            parking. When someone does not arrive, unused scheduled time can be
            released.
          </p>
          <Button asChild className="mt-6">
            <Link href="/">Try the customer booking flow</Link>
          </Button>
        </section>
        <section className="panel">
          <span className="eyebrow">01 · Problem hypotheses</span>
          <h2 className="my-3 text-2xl font-semibold">
            Confidence before the car park.
          </h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 muted">
            <li>
              Drivers may want more confidence about parking before arriving.
            </li>
            <li>
              An available zone may not suit the destination or walking-route
              needs.
            </li>
            <li>
              Unused reservations can continue blocking scheduled availability.
            </li>
          </ul>
          <p className="mt-5 text-sm">
            These are product hypotheses. No validated user research has been
            provided.
          </p>
        </section>
        <UserVoice />
        <section className="panel">
          <span className="eyebrow">02 · The solution</span>
          <h2 className="my-3 text-2xl font-semibold">
            Make the whole journey visible.
          </h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-5">
            {[
              "Pre-book a standard bay",
              "Choose a suitable zone",
              "View fictional arrival guidance",
              "Simulate check-in and departure",
              "Automatically release no-shows",
            ].map((s, i) => (
              <li key={s} className="rounded-xl bg-[var(--surface-muted)] p-4">
                <span className="eyebrow">0{i + 1}</span>
                <p className="mt-3 text-sm font-semibold">{s}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel">
          <span className="eyebrow">03 · Live demonstration</span>
          <h2 className="my-3 text-2xl font-semibold">
            Three repeatable scenarios.
          </h2>
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <h3 className="font-bold">A · A successful visit</h3>
              <p className="mt-2 text-sm leading-6 muted">
                Cinema + verified step-free route. Reserve, find the zone, use
                simulated plate entry, then exit and complete parking.
              </p>
            </div>
            <div>
              <h3 className="font-bold">B · An unused reservation</h3>
              <p className="mt-2 text-sm leading-6 muted">
                Advance the isolated demo clock past the stored deadline. Run
                the scheduler’s cleanup function, then store a subsequent
                booking.
              </p>
            </div>
            <div>
              <h3 className="font-bold">C · A late arrival</h3>
              <p className="mt-2 text-sm leading-6 muted">
                Enter the released plate at the simulator. It registers a
                walk-in; the old booking remains no-show.
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Customer flow</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/demo">
                Authorized demo dashboard & booking links
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-xs muted">
            Private booking details and arrival links appear only after
            owner/admin authorization. This public page exposes no booking
            tokens or admin mutation controls.
          </p>
        </section>
        <LiveMetrics />
        <section className="panel">
          <span className="eyebrow">04 · What the prototype demonstrates</span>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="text-xl font-semibold">
                Implemented software behaviour
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm muted">
                <li>
                  Transactional reservation allocation and overlap protection.
                </li>
                <li>
                  Availability-aware, deterministic route recommendations.
                </li>
                <li>Authorized booking-state transitions.</li>
                <li>Server-side automated release and event-based metrics.</li>
              </ul>
            </div>
            <div>
              <h2 className="text-xl font-semibold">
                Still to validate in the real world
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm muted">
                <li>Physical bay availability or vehicle presence.</li>
                <li>
                  Search-time reduction, customer demand or commercial
                  viability.
                </li>
                <li>Real entrance and step-free route information.</li>
              </ul>
            </div>
          </div>
        </section>
        <section className="panel">
          <span className="eyebrow">05 · Next steps</span>
          <p className="mt-4 leading-8">
            User testing → pilot with a mall operator → physical access and
            occupancy integration → verification of real route information.
          </p>
        </section>
        <p className="notice">
          Software-only prototype. Check-in and departure are simulated. Maps
          and routes use fictional demo data. Releasing a reservation does not
          prove a physical bay is empty. No real-world time, revenue, emissions
          or congestion improvements are claimed.
        </p>
      </div>
    </PageShell>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlateConfirmation } from "@/components/plate-confirmation";
import { usePathname } from "next/navigation";

import { Check, Clock, MapPin, ParkingCircle } from "lucide-react";
import { StoredFloorMap } from "@/components/parking/stored-floor-map";
import { PreferenceExplanation } from "@/components/parking/preference-explanation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import {
  arrivalEligible,
  isFinal,
  reminder,
  navigationInstructions,
  type JourneyBooking,
} from "@/lib/lifecycle";
import { canCancel, displayTime } from "@/lib/rules";
function ZoneGuidance({ booking: b }: { booking: JourneyBooking }) {
  const instructions = navigationInstructions(b),
    zone = b.bays.zones;
  const walking = !!instructions.walking.length;
  return (
    <section className="panel">
      <span className="eyebrow">Fictional map · orientation only</span>
      <h2 className="mt-3 text-2xl font-semibold">Find my parking zone</h2>
      <p className="my-3">
        {zone.malls.name} · {zone.floor} · {zone.name} · Bay {b.bays.label}
      </p>
      {zone.floor_id && zone.malls.id ? (
        <StoredFloorMap
          mallId={zone.malls.id}
          floorId={zone.floor_id}
          selectedId={b.bay_id}
        />
      ) : (
        <p className="notice">
          Stored floor geometry is unavailable for this historical location.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="font-bold">Driving: entrance → reserved zone</h3>
          {instructions.driving.length ? (
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm muted">
              {instructions.driving.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm muted">
              Driving route data is unavailable. Your booking is in {zone.name},
              floor {zone.floor}, bay {b.bays.label}.
            </p>
          )}
        </div>
        <div>
          <h3 className="font-bold">Walking: lobby → destination</h3>
          {walking ? (
            <>
              <p className="mt-3 text-sm">
                {b.route!.walking_distance_m} m ·{" "}
                {b.route!.is_step_free === true
                  ? "Verified step-free demo route"
                  : "Demo route"}
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm muted">
                {instructions.walking.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm muted">
              {b.destinations
                ? "Verified walking route details are unavailable."
                : "No destination selected."}{" "}
              No walking instructions are inferred.
            </p>
          )}
        </div>
      </div>
      <p className="notice mt-5">
        Fictional demo instructions and approximate bay area. No GPS, live
        position or turn-by-turn navigation. Verify real entrance and route
        information independently.
      </p>
    </section>
  );
}
export function BookingJourney({
  id,
  screen = "details",
}: {
  id?: string;
  screen?: "details" | "arrival" | "zone";
}) {
  const [booking, setBooking] = useState<JourneyBooking | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [fresh, setFresh] = useState(false),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(0),
    [plate, setPlate] = useState("");
  const path = usePathname();
  const endpoint = "reservations/" + id;
  const refresh = useCallback(async () => {
    try {
      const b = await api<JourneyBooking>(endpoint);
      setBooking(b);
      setNow(Date.parse(b.server_now));
      setFresh(true);
      setError("");
    } catch (e) {
      setFresh(false);
      setError(e instanceof Error ? e.message : "Booking refresh failed.");
    }
  }, [endpoint]);
  useEffect(() => {
    refresh();
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!booking || isFinal(booking.status)) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    return () => clearInterval(poll);
  }, [booking?.status, refresh, booking]);
  useEffect(() => {
    if (!booking) return;
    const initial = Date.parse(booking.server_now),
      base = performance.now();
    setNow(initial);
    if (booking.is_demo || isFinal(booking.status)) return;
    const timer = setInterval(
      () => setNow(initial + performance.now() - base),
      1000,
    );
    return () => clearInterval(timer);
  }, [booking]);
  useEffect(() => {
    if (
      booking?.status === "confirmed" &&
      fresh &&
      now >= Date.parse(booking.arrival_deadline)
    )
      refresh();
  }, [booking, now, fresh, refresh]);
  async function act(action: "check-in" | "complete" | "cancel") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`reservations/${id}/${action}`, {});
      await refresh();
      setMessage(
        action === "check-in"
          ? "Simulated check-in confirmed."
          : action === "complete"
            ? "Simulated departure confirmed."
            : "Booking cancelled.",
      );
    } catch (e) {
      const text = e instanceof Error ? e.message : "Action failed.";
      await refresh();
      setError(text);
    } finally {
      setBusy(false);
    }
  }
  if (!booking)
    return (
      <section className="panel">
        <h1 className="text-3xl font-semibold">
          {screen === "arrival" ? "Arrival screen" : "Your booking details"}
        </h1>
        {error ? (
          <>
            <p role="alert" className="my-4 text-red-800">
              {error}
            </p>
            <Button asChild>
              <Link href={"/auth?returnTo=" + encodeURIComponent(path)}>
                Sign in to view your booking
              </Link>
            </Button>
            <p className="mt-4 text-sm muted">
              Only the booking owner or an authorized admin can view this link.
              A token alone grants no access.
            </p>
            <Button variant="outline" className="mt-4" onClick={refresh}>
              Retry
            </Button>
          </>
        ) : (
          <p role="status" className="mt-4">
            Loading authorized booking details…
          </p>
        )}
      </section>
    );
  const overdue =
    booking.status === "checked_in" && now >= Date.parse(booking.end_at);
  const canArrive = fresh && arrivalEligible(booking, now);
  const step =
    booking.status === "completed"
      ? 4
      : booking.status === "checked_in"
        ? 3
        : 1;
  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="notice border-red-200 bg-red-50 text-red-800"
        >
          {error}{" "}
          {!fresh &&
            "Refresh failed; the displayed booking state may be stale. Actions are paused."}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="eyebrow">
            {booking.is_demo
              ? "DEMO MODE · Controlled clock"
              : "Simulated arrival · Database clock"}
          </span>
          <span className="status">{booking.status.replace("_", " ")}</span>
        </div>
        <h1 className="my-4 text-3xl font-semibold">
          {screen === "arrival"
            ? "Your arrival screen"
            : screen === "zone"
              ? "Your parking zone"
              : "Your booking details"}
        </h1>
        <p className="break-all text-xs muted">Reference: {booking.id}</p>
        {booking.location_snapshot &&
          booking.location_snapshot.bayLabel !== booking.bays.label && (
            <p className="notice my-3">
              Original booking location: {booking.location_snapshot.mallName} ·{" "}
              {booking.location_snapshot.floor} ·{" "}
              {booking.location_snapshot.zoneName} ·{" "}
              {booking.location_snapshot.bayLabel}. The current label below
              refers to the same retained bay ID.
            </p>
          )}
        {booking.eligibility_snapshot?.status === "approved" && (
          <p className="notice my-3">
            ♿ OKU booking · Simulated mall approval was recorded when this
            reservation was created.
          </p>
        )}
        <ol
          aria-label="Booking progress"
          className="my-6 grid grid-cols-4 gap-2"
        >
          {["Reserved", "Arrived", "Parking", "Completed"].map((label, i) => (
            <li
              key={label}
              className={`rounded-lg p-3 text-center text-xs ${i < step ? "bg-[var(--surface-accent)]" : "bg-slate-50"}`}
            >
              <span className="mb-2 block">
                {i < step ? <Check className="mx-auto" size={17} /> : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
        {booking.status === "no_show" && (
          <p role="status" className="notice">
            This booking was released after the arrival deadline.{" "}
            <Link className="underline" href="/">
              Search again and create a new booking.
            </Link>
          </p>
        )}
        {booking.status === "cancelled" && (
          <p className="notice">
            Cancelled — this reservation is no longer valid.
          </p>
        )}
        <div className="my-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl bg-[var(--surface-muted)] p-5">
            <ParkingCircle size={24} />
            <span className="eyebrow mt-3 block">Assigned standard bay</span>
            <h2 className="my-2 text-4xl font-semibold">
              {booking.bays.label}
            </h2>
            <p>
              {booking.bays.zones.malls.name} · {booking.bays.zones.name} ·{" "}
              {booking.bays.zones.floor}
            </p>
            {booking.destinations && (
              <p className="mt-2 text-sm muted">
                Destination: {booking.destinations.name}
              </p>
            )}
          </div>
          <div className="leading-7">
            <p>
              Start:{" "}
              {displayTime(booking.start_at, booking.bays.zones.malls.timezone)}
            </p>
            <p>
              End:{" "}
              {displayTime(booking.end_at, booking.bays.zones.malls.timezone)}
            </p>
            <p className="mt-2 font-semibold">
              Arrival deadline:{" "}
              {displayTime(
                booking.arrival_deadline,
                booking.bays.zones.malls.timezone,
              )}
            </p>
            <p className="text-xs muted">
              {booking.bays.zones.malls.timezone ?? "Asia/Kuala_Lumpur"}
            </p>
            <p className="mt-3 font-semibold" aria-live="polite">
              {fresh
                ? reminder(booking, now)
                : "Booking state could not be refreshed."}
            </p>
            {booking.status === "confirmed" && (
              <p className="mt-2 text-sm muted">
                Check in by the deadline. At the deadline your booking is
                eligible for automatic release. Countdown is a display aid; the
                database decides.
              </p>
            )}
            {booking.is_demo && (
              <p className="mt-2 text-xs muted">
                Demo time:{" "}
                {displayTime(
                  booking.server_now,
                  booking.bays.zones.malls.timezone,
                )}
                . The clock moves only when an admin advances it.
              </p>
            )}
          </div>
        </div>
        {overdue && (
          <p role="status" className="notice mb-4">
            Overdue — simulated occupancy not cleared. No fine or physical
            enforcement is implied.
          </p>
        )}
        {booking.recommendation_snapshot && (
          <section className="my-5 rounded-xl border border-slate-200 p-4">
            <h2 className="mb-3 text-lg font-semibold">
              Preferences saved at booking
            </h2>
            <PreferenceExplanation
              evaluation={booking.recommendation_snapshot}
            />
          </section>
        )}
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/bookings/${booking.id}/zone`}>
              <MapPin size={16} className="mr-2" />
              Find my parking zone
            </Link>
          </Button>
          {screen !== "arrival" && (
            <Button asChild>
              <Link href={`/bookings/${booking.id}/arrival`}>
                Manual arrival fallback
              </Link>
            </Button>
          )}
          {screen === "arrival" && booking.status === "confirmed" && (
            <Button
              disabled={!canArrive || busy}
              onClick={() => act("check-in")}
            >
              {busy ? "Confirming…" : "Simulate check-in"}
            </Button>
          )}
          {booking.status === "checked_in" && (
            <Button disabled={!fresh || busy} onClick={() => act("complete")}>
              Simulate departure / complete parking
            </Button>
          )}
          {canCancel(booking.status, booking.start_at, now) && (
            <Button
              variant="outline"
              disabled={!fresh || busy}
              onClick={() => act("cancel")}
            >
              Cancel reservation · no fee
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={refresh}>
            <Clock size={15} className="mr-2" />
            Refresh status
          </Button>
        </div>
        {screen === "arrival" &&
          booking.status === "confirmed" &&
          now < Date.parse(booking.start_at) && (
            <p className="mt-3 text-sm muted">
              Check-in opens at the reservation start time. Opening this page
              does not check you in.
            </p>
          )}
      </section>
      {screen === "zone" ? (
        <ZoneGuidance booking={booking} />
      ) : (
        <section className="panel">
          <h2 className="text-xl font-semibold">Booking reference</h2>
          {booking.parking_session && (
            <p className="my-3 text-sm">
              Entry status: {booking.parking_session.status} · Entered{" "}
              {displayTime(booking.parking_session.entered_at)}
              {booking.parking_session.closure_reason === "timeout" &&
                " · Session auto-closed by timeout; physical departure was not verified."}
            </p>
          )}
          <p className="my-3">
            Your plate:{" "}
            <strong>
              {booking.normalized_plate ??
                "Not assigned — manual admin assistance required"}
            </strong>
          </p>
          <p className="text-sm muted">
            Plate is used only for parking access. Use the authenticated arrival
            page for simulated check-in and completion.
          </p>
          {booking.status === "confirmed" &&
            now < Date.parse(booking.arrival_deadline) && (
              <>
                <PlateConfirmation onConfirmed={setPlate} />
                <Button
                  disabled={!plate || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(
                        "bookings/" + booking.id + "/plate",
                        { plate },
                        "PATCH",
                      );
                      setPlate("");
                      await refresh();
                      setMessage("Plate updated.");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save confirmed plate
                </Button>
              </>
            )}
          {booking.status === "checked_in" &&
            now >= Date.parse(booking.end_at) && (
              <p className="notice mt-3">
                Overdue — parking session remains open until departure or
                administrative timeout.
              </p>
            )}
        </section>
      )}
      <p className="notice">
        Check-in and departure are simulated. Maps and instructions are
        fictional demo data. Physical vehicle presence is not verified.
        Releasing a reservation does not prove a physical bay is empty.
      </p>
    </div>
  );
}

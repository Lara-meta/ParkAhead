"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { Check, Clock, MapPin, ParkingCircle } from "lucide-react";
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
  const known = !!b.guidance;
  const walking = !!instructions.walking.length;
  return (
    <section className="panel">
      <span className="eyebrow">Fictional map · orientation only</span>
      <h2 className="mt-3 text-2xl font-semibold">Find my parking zone</h2>
      <p className="my-3">
        {zone.malls.name} · {zone.floor} · {zone.name} · Bay {b.bays.label}
      </p>
      <svg
        viewBox="0 0 460 330"
        role="img"
        aria-label={`Fictional orientation map: ${zone.name}, assigned bay ${b.bays.label}. Driving and walking routes are labelled separately.`}
        className="my-5 w-full rounded-xl bg-[#f1f4ed]"
      >
        <rect x="28" y="70" width="170" height="120" rx="15" fill="#cddfc1" />
        <text x="45" y="105" fontSize="19">
          Reserved {zone.name}
        </text>
        <rect x="48" y="122" width="125" height="44" rx="8" fill="#185743" />
        <text x="62" y="150" fontSize="16" fill="white">
          Bay {b.bays.label}
        </text>
        {known ? (
          <>
            <text x="22" y="290" fontSize="13">
              {b.guidance!.vehicle_entrance}
            </text>
            <path
              d="M100 265 V215 H110 V180"
              fill="none"
              stroke="#185743"
              strokeWidth="6"
            />
            <text x="135" y="240" fontSize="12">
              DRIVING → zone
            </text>
            <rect
              x="265"
              y="80"
              width="170"
              height="65"
              rx="10"
              fill="#e5dfbf"
            />
            <text x="280" y="118" fontSize="14">
              {b.guidance!.lift_lobby}
            </text>
          </>
        ) : (
          <text x="30" y="230" fontSize="14">
            Entrance/lobby guidance unavailable
          </text>
        )}
        {walking && (
          <>
            <path
              d="M195 115 H260 M350 150 V240"
              fill="none"
              stroke="#a26c30"
              strokeWidth="4"
              strokeDasharray="7 5"
            />
            <text x="255" y="180" fontSize="11">
              WALKING → destination
            </text>
            <text x="265" y="265" fontSize="15">
              {b.destinations?.name}
            </text>
          </>
        )}
      </svg>
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
  token,
  screen = "details",
}: {
  id?: string;
  token?: string;
  screen?: "details" | "arrival" | "zone";
}) {
  const [booking, setBooking] = useState<JourneyBooking | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [fresh, setFresh] = useState(false),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(0),
    [qr, setQr] = useState(""),
    [qrError, setQrError] = useState("");
  const path = usePathname();
  const endpoint = token ? "arrival/" + token : "reservations/" + id;
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
  useEffect(() => {
    if (!booking?.check_in_token) return;
    QRCode.toDataURL(
      new URL("/arrival/" + booking.check_in_token, window.location.origin)
        .href,
      { width: 220, margin: 2, errorCorrectionLevel: "M" },
    )
      .then(setQr)
      .catch(() =>
        setQrError("QR could not be generated. Use Open arrival screen below."),
      );
  }, [booking?.check_in_token]);
  async function act(action: "check-in" | "complete" | "cancel") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(
        token ? `arrival/${token}/${action}` : `reservations/${id}/${action}`,
        {},
      );
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
        <ol
          aria-label="Booking progress"
          className="my-6 grid grid-cols-4 gap-2"
        >
          {["Reserved", "Arrived", "Parking", "Completed"].map((label, i) => (
            <li
              key={label}
              className={`rounded-lg p-3 text-center text-xs ${i < step ? "bg-[#e1edd7]" : "bg-slate-50"}`}
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
          <div className="rounded-xl bg-[#f1f5eb] p-5">
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
            <p>Start: {displayTime(booking.start_at)}</p>
            <p>End: {displayTime(booking.end_at)}</p>
            <p className="mt-2 font-semibold">
              Arrival deadline: {displayTime(booking.arrival_deadline)}
            </p>
            <p className="text-xs muted">Asia/Kuala_Lumpur (MYT)</p>
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
                Demo time: {displayTime(booking.server_now)}. The clock moves
                only when an admin advances it.
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
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/bookings/${booking.id}/zone`}>
              <MapPin size={16} className="mr-2" />
              Find my parking zone
            </Link>
          </Button>
          {screen !== "arrival" && (
            <Button asChild>
              <Link href={"/arrival/" + booking.check_in_token}>
                Open arrival screen
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
        <section className="panel flex flex-wrap items-center gap-6">
          <div>
            {qr ? (
              <Image
                src={qr}
                width={220}
                height={220}
                unoptimized
                alt="QR link to this booking’s authorized arrival screen"
              />
            ) : (
              <p className="text-sm muted">{qrError || "Preparing QR…"}</p>
            )}
          </div>
          <div className="max-w-md">
            <h2 className="text-xl font-semibold">
              A small code. A smoother arrival.
            </h2>
            <p className="my-3 text-sm leading-6 muted">
              Scan with your phone, or use Open arrival screen. The link
              contains only an opaque token. Sign-in as the booking owner or
              authorized demo admin is still required.
            </p>
            <p className="text-xs muted">
              The phone needs network access to this app. Localhost links only
              work on the same device.
            </p>
          </div>
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

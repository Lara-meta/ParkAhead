"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  MapPin,
  ParkingCircle,
  Footprints,
  Clock,
  Leaf,
  LogOut,
} from "lucide-react";
import { BookingJourney } from "@/components/bookings/booking-journey";
import { useParkingClock } from "@/lib/use-parking-clock";
import { arrivalEligible } from "@/lib/lifecycle";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/supabase/browser";
import { mallInstant, displayTime, type Zone } from "@/lib/rules";
type Inventory = { id: string; name: string };
type Booking = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  preference: string;
  arrival_deadline: string;
  is_demo: boolean;
  bay_id: string;
  bays?: {
    label: string;
    zones: { name: string; floor: string; malls: { name: string } };
  };
};
type Bay = {
  id: string;
  label: string;
  is_active: boolean;
  zones: { name: string; floor: string };
};
type Route = {
  id: string;
  walking_distance_m: number;
  is_verified: boolean;
  is_step_free: boolean | null;
  zones: { name: string; floor: string };
  destinations: { name: string };
};
const notice =
  "Demo: availability is based on reservations and simulated parking data. Physical bay availability is not verified.";
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch(
    "/api/" + path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const json = await r.json();
  if (!r.ok)
    throw new Error(
      json.error.message +
        (json.error.fieldErrors
          ? " " + Object.values(json.error.fieldErrors).flat().join(" ")
          : ""),
    );
  return json.data;
}
export default function ParkAhead() {
  const [view, setView] = useState("search"),
    [malls, setMalls] = useState<Inventory[]>([]),
    [mall, setMall] = useState(""),
    [destinations, setDestinations] = useState<Inventory[]>([]),
    [destination, setDestination] = useState(""),
    [pref, setPref] = useState("none"),
    [date, setDate] = useState(""),
    [start, setStart] = useState("10:00"),
    [end, setEnd] = useState("12:00"),
    [zones, setZones] = useState<(Zone & { reason: string })[]>([]),
    [selected, setSelected] = useState<Zone | null>(null),
    [booking, setBooking] = useState<Booking | null>(null),
    [bookings, setBookings] = useState<Booking[]>([]),
    [bays, setBays] = useState<Bay[]>([]),
    [routes, setRoutes] = useState<Route[]>([]),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false),
    [user, setUser] = useState(""),
    [returnTo, setReturnTo] = useState("search"),
    [key, setKey] = useState(""),
    [status, setStatus] = useState(""),
    [timeFilter, setTimeFilter] = useState("all");
  const { context: clock, now, realNow } = useParkingClock(mall);
  const initializedMall = useRef("");
  useEffect(() => {
    if (!clock || !mall || initializedMall.current === mall) return;
    initializedMall.current = mall;
    const next = new Date(
      Date.parse(clock.now) +
        (clock.mallDemo ? 5 * 60000 : 86400000) +
        8 * 3600000,
    ).toISOString();
    setDate(next.slice(0, 10));
    if (clock.mallDemo) {
      setStart(next.slice(11, 16));
      setEnd(
        new Date(Date.parse(clock.now) + 65 * 60000 + 8 * 3600000)
          .toISOString()
          .slice(11, 16),
      );
    }
  }, [clock, mall]);
  useEffect(() => {
    api<Inventory[]>("malls")
      .then((v) => {
        setMalls(v);
        setMall(v[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
    try {
      const auth = authClient();
      auth.auth.getUser().then(({ data }) => setUser(data.user?.email ?? ""));
      const { data } = auth.auth.onAuthStateChange((_event, session) =>
        setUser(session?.user.email ?? ""),
      );
      return () => data.subscription.unsubscribe();
    } catch {}
  }, []);
  useEffect(() => {
    if (mall)
      api<Inventory[]>("malls/" + mall + "/destinations")
        .then(setDestinations)
        .catch((e) => setError(e.message));
  }, [mall]);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function request() {
    return {
      mallId: mall,
      startAt: mallInstant(date + "T" + start),
      endAt: mallInstant(date + "T" + end),
      destinationId: destination || null,
      preference: pref,
    };
  }
  async function search() {
    await run(async () => {
      const v = request();
      const result = await api<(Zone & { reason: string })[]>(
        "recommendations?" +
          new URLSearchParams(
            Object.entries(v).filter(([, v]) => v !== null) as [
              string,
              string,
            ][],
          ),
      );
      setZones(result);
      setView("zones");
      setSelected(null);
    });
  }
  async function loadBookings(admin = false) {
    await run(async () => {
      setBookings(
        await api<Booking[]>(admin ? "admin/reservations" : "me/reservations"),
      );
      if (admin) {
        setBays(await api<Bay[]>("admin/bays"));
        setRoutes(await api<Route[]>("admin/routes"));
      }
      setView(admin ? "admin" : "bookings");
    });
  }
  async function action(id: string, action: string, admin = false) {
    await run(async () => {
      await api(
        ` ${admin ? "admin/" : ""}reservations/${id}/${action}`.trim(),
        {},
      );
      if (view === "detail") {
        setBooking(await api<Booking>("reservations/" + id));
      } else
        setBookings(
          await api<Booking[]>(
            admin ? "admin/reservations" : "me/reservations",
          ),
        );
      setInfo("Booking updated.");
    });
  }
  function choose(z: Zone) {
    setSelected(z);
    setKey(crypto.randomUUID());
    setView("review");
  }
  const visibleBookings = bookings.filter(
    (b) =>
      (!status || b.status === status) &&
      (timeFilter === "all" ||
        (timeFilter === "upcoming"
          ? Date.parse(b.end_at) > (b.is_demo ? now : realNow)
          : Date.parse(b.end_at) <= (b.is_demo ? now : realNow))),
  );
  return (
    <>
      <header className="border-b border-[#e1e6df] bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-5 sm:flex-nowrap">
          <button
            onClick={() => setView("search")}
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <ParkingCircle size={30} fill="#185743" color="white" />
            <span>
              ParkAhead<span className="text-emerald-600">.</span>
            </span>
          </button>
          <nav className="flex w-full items-center justify-between gap-3 sm:w-auto sm:gap-4 md:gap-7">
            <button onClick={() => setView("search")}>Find parking</button>
            <button onClick={() => loadBookings()}>My bookings</button>
            <button onClick={() => loadBookings(true)}>Admin</button>
            {user ? (
              <button
                title="Sign out"
                aria-label="Sign out"
                onClick={() =>
                  run(async () => {
                    const { error } = await authClient().auth.signOut();
                    if (error) throw error;
                    setView("search");
                  })
                }
              >
                <LogOut size={18} />
              </button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setReturnTo(view);
                  setView("auth");
                }}
              >
                Sign in <ArrowUpRight size={14} className="ml-2" />
              </Button>
            )}
          </nav>
        </div>
      </header>
      <main>
        <div className="mb-8 flex items-center justify-between">
          <span className="eyebrow flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> A better
            arrival starts here
          </span>
          <span className="hidden text-xs text-[#718078] sm:block">
            Kuala Lumpur · MYT (UTC+8)
          </span>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {info && (
          <div role="status" className="notice mb-5">
            {info}
          </div>
        )}
        {view === "search" && (
          <>
            <section className="mb-10 grid gap-8 md:grid-cols-[1.1fr_.9fr]">
              <div className="py-5">
                <h1 className="text-[58px] font-semibold leading-[1.06]">
                  Less circling.
                  <br />
                  More <span className="text-[#478464]">getting there.</span>
                </h1>
                <p className="mt-5 max-w-md text-base leading-7 text-[#718078]">
                  A spot for your plans. Reserve parking before you arrive and
                  spend more time doing what you came for.
                </p>
                <div className="mt-7 flex flex-wrap gap-5 text-xs font-medium">
                  <span className="flex items-center gap-2">
                    <Check size={16} /> Reserve ahead
                  </span>
                  <span className="flex items-center gap-2">
                    <Check size={16} /> Choose your zone
                  </span>
                  <span className="flex items-center gap-2">
                    <Check size={16} /> No payment needed
                  </span>
                </div>
              </div>
              <div className="relative overflow-hidden rounded-[28px] bg-[#e4ebd9] p-5">
                <div className="flex justify-between text-xs font-semibold">
                  <span>YOUR ARRIVAL, REIMAGINED</span>
                  <span>DEMO</span>
                </div>
                <svg
                  viewBox="0 0 440 230"
                  role="img"
                  aria-label="Illustration of a reserved parking bay"
                  className="w-full"
                >
                  <defs>
                    <pattern
                      id="lines"
                      width="65"
                      height="100"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M5 0V85H60V0"
                        fill="none"
                        stroke="#aab99a"
                        strokeWidth="2"
                      />
                    </pattern>
                  </defs>
                  <g transform="translate(35 65) skewY(-12)">
                    <rect width="370" height="145" fill="url(#lines)" />
                    <rect
                      x="132"
                      y="0"
                      width="58"
                      height="86"
                      rx="8"
                      fill="#195a46"
                    />
                    <rect
                      x="141"
                      y="17"
                      width="40"
                      height="48"
                      rx="10"
                      fill="#e1e9dd"
                    />
                    <path
                      d="M142 27h38M142 57h38"
                      stroke="#7e9b89"
                      strokeWidth="4"
                    />
                    <path
                      d="M0 125H370"
                      stroke="#fff"
                      strokeWidth="3"
                      strokeDasharray="18 14"
                    />
                  </g>
                  <circle cx="270" cy="55" r="24" fill="#fff" />
                  <path
                    d="m259 55 8 8 14-17"
                    fill="none"
                    stroke="#195a46"
                    strokeWidth="4"
                  />
                </svg>
                <div className="absolute bottom-5 left-5 rounded-xl bg-white/90 px-4 py-3 text-xs shadow-sm">
                  <span className="font-bold">Your plans. Your parking.</span>
                  <br />
                  <span className="muted">One less thing to think about.</span>
                </div>
              </div>
            </section>
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#195a46] text-xs text-white">
                1
              </span>
              <h2 className="text-xl font-semibold">Plan your visit</h2>
              <span className="ml-auto text-xs text-[#718078]">
                Search → Zone → Review → Arrive
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
              className="panel"
            >
              <div className="grid gap-5 md:grid-cols-4">
                <label>
                  Mall
                  <select
                    required
                    value={mall}
                    onChange={(e) => {
                      setMall(e.target.value);
                      setDestination("");
                    }}
                  >
                    <option value="">Select a mall</option>
                    {malls.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Visit date · MYT
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  Arrival time
                  <input
                    required
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  Departure time
                  <input
                    required
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </div>
              <div className="my-6 border-t border-[#edf0e9]" />
              <div className="grid items-end gap-5 md:grid-cols-[1fr_1fr_auto]">
                <label>
                  Where are you headed?{" "}
                  <span className="font-normal muted">Optional</span>
                  <select
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Just exploring</option>
                    {destinations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Route preference
                  <select
                    value={pref}
                    onChange={(e) => setPref(e.target.value)}
                  >
                    <option value="none">No preference</option>
                    <option value="shorter_walk">Shorter walk</option>
                    <option value="step_free">Verified step-free route</option>
                  </select>
                </label>
                <Button disabled={busy || !mall || !clock} type="submit">
                  {busy ? "Finding parking…" : "Find parking"}
                  <ArrowRight size={17} className="ml-6" />
                </Button>
              </div>
              <p className="mt-4 text-xs muted">
                Step-free describes the walking route, not eligibility for a
                restricted accessible bay. Standard bays only. Duration: 30
                minutes–8 hours.
              </p>
            </form>
            <section className="my-8 grid gap-6 md:grid-cols-3">
              {[
                [
                  MapPin,
                  "A place in your plans",
                  "Choose an available zone before heading out.",
                ],
                [
                  Footprints,
                  "A route that suits you",
                  "Compare fictional walking routes to your destination.",
                ],
                [
                  Leaf,
                  "A calmer start",
                  "Skip the guesswork. Make room for your day.",
                ],
              ].map(([Icon, title, text]) => {
                const I = Icon as typeof MapPin;
                return (
                  <div key={String(title)} className="flex gap-4 p-2">
                    <I size={22} className="mt-1 shrink-0 text-[#5d7f52]" />
                    <div>
                      <h3 className="text-sm font-bold">{String(title)}</h3>
                      <p className="mt-2 text-xs leading-5 muted">
                        {String(text)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
        {view === "zones" && (
          <>
            <Button variant="outline" onClick={() => setView("search")}>
              ← Edit search
            </Button>
            <h1 className="mt-7 text-4xl font-semibold">
              Find your starting point.
            </h1>
            <p className="my-4 muted">
              {displayTime(request().startAt)} – {displayTime(request().endAt)}{" "}
              · Availability is advisory.
            </p>
            <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                {zones.length === 0 ? (
                  <div className="panel">
                    <h2 className="text-xl font-semibold">
                      {pref === "step_free"
                        ? "No suitable verified step-free route"
                        : "No available zones"}
                    </h2>
                    <p className="my-4 muted">
                      Try another time or edit your preferences.
                    </p>
                    <Button onClick={() => setView("search")}>
                      Edit search
                    </Button>
                  </div>
                ) : (
                  zones.map((z, i) => (
                    <div className="panel" key={z.zoneId}>
                      <div className="flex justify-between">
                        <span className="eyebrow">
                          {i === 0 ? "First available match" : "Another option"}{" "}
                          · {z.floor}
                        </span>
                        <span className="status">
                          {z.availableBayCount} bays available
                        </span>
                      </div>
                      <h2 className="mt-3 text-2xl font-semibold">
                        {z.zoneName}
                      </h2>
                      <p className="my-3 text-sm muted">{z.reason}</p>
                      <p className="mb-4 text-sm">
                        {z.walkingDistanceM !== null
                          ? `${z.walkingDistanceM} m demo walk`
                          : "Route distance unknown"}
                        {z.stepFree === true ? " · Step-free" : ""}
                      </p>
                      <Button onClick={() => choose(z)}>
                        Choose zone <ArrowRight size={15} className="ml-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <div className="panel h-fit">
                <span className="eyebrow">Demo Central Mall · Basement 1</span>
                <svg
                  viewBox="0 0 400 330"
                  role="img"
                  aria-label="Fictional zone map. Select available zones below."
                >
                  <rect
                    x="8"
                    y="20"
                    width="384"
                    height="280"
                    rx="18"
                    fill="#f0f2eb"
                  />
                  <path
                    d="M20 160H380M200 30V285"
                    stroke="white"
                    strokeWidth="28"
                  />
                  {["A", "B", "C"].map((n, i) => {
                    const z = zones.find((z) => z.zoneName === `Zone ${n}`);
                    return (
                      <g
                        key={n}
                        transform={`translate(${i === 1 ? 225 : 35} ${i === 2 ? 190 : 50})`}
                      >
                        <rect
                          width="140"
                          height="90"
                          rx="12"
                          fill={z ? "#d6e5cc" : "#e4e5e0"}
                        />
                        <text x="18" y="36" fontSize="20" fill="#195a46">
                          Zone {n}
                        </text>
                        <text x="18" y="62" fontSize="12">
                          {z
                            ? `${z.availableBayCount} available`
                            : "Unavailable"}
                        </text>
                      </g>
                    );
                  })}
                  <text x="245" y="240" fontSize="14">
                    MALL LOBBY ↑
                  </text>
                </svg>
                <div className="flex flex-wrap gap-2">
                  {zones.map((z) => (
                    <Button
                      key={z.zoneId}
                      variant="outline"
                      onClick={() => choose(z)}
                    >
                      {z.zoneName}
                    </Button>
                  ))}
                </div>
                <p className="mt-4 text-xs muted">
                  Fictional orientation map. No live position or indoor
                  navigation. Verified routes refer only to the demo dataset.
                </p>
              </div>
            </div>
          </>
        )}
        {view === "review" && selected && (
          <section className="panel mx-auto max-w-xl">
            <span className="eyebrow">One last look</span>
            <h1 className="my-4 text-3xl font-semibold">
              Your visit, planned.
            </h1>
            <h2 className="text-xl">
              {malls.find((m) => m.id === mall)?.name} · {selected.zoneName}
            </h2>
            <p className="my-5 leading-8 muted">
              {displayTime(request().startAt)}
              <br />
              {displayTime(request().endAt)}
              <br />
              Floor {selected.floor} · {pref.replace("_", " ")}
              <br />
              {destinations.find((d) => d.id === destination)?.name ??
                "No destination selected"}
            </p>
            <div className="notice">
              The server assigns a standard bay when you confirm. No payment
              required. A software allocation does not physically guarantee
              access.
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" onClick={() => setView("zones")}>
                Back
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  if (!user) {
                    setReturnTo("review");
                    setView("auth");
                    return;
                  }
                  run(async () => {
                    const r = await api<Booking>("reservations", {
                      ...request(),
                      zoneId: selected.zoneId,
                      idempotencyKey: key,
                    });
                    setBooking(await api<Booking>("reservations/" + r.id));
                    setView("detail");
                  });
                }}
              >
                {busy
                  ? "Confirming…"
                  : user
                    ? "Confirm reservation"
                    : "Sign in to continue"}
              </Button>
            </div>
          </section>
        )}
        {view === "auth" && (
          <form
            className="panel mx-auto max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const auth = authClient();
                const r = signup
                  ? await auth.auth.signUp({ email, password })
                  : await auth.auth.signInWithPassword({ email, password });
                if (r.error) throw r.error;
                if (signup && !r.data.session) {
                  setInfo(
                    "Check your email to verify your account, then sign in.",
                  );
                  setSignup(false);
                } else setView(returnTo);
              });
            }}
          >
            <h1 className="mb-6 text-3xl font-semibold">
              {signup ? "Make room for better arrivals." : "Welcome back."}
            </h1>
            <label>
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="mt-4 block">
              Password
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
            </label>
            <Button className="mt-6 w-full" disabled={busy}>
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
            </Button>
            <button
              type="button"
              className="mt-5 text-sm underline"
              onClick={() => setSignup(!signup)}
            >
              {signup
                ? "Already registered? Sign in"
                : "New here? Create an account"}
            </button>
          </form>
        )}
        {view === "detail" && booking && <BookingJourney id={booking.id} />}
        {(view === "bookings" || view === "admin") && (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-sm underline">
              <Link href="/admin/demo">Demo clock & scenarios</Link>
              <Link href="/demo-story">Presentation story</Link>
            </div>
            <h1 className="mb-5 text-4xl font-semibold">
              {view === "admin" ? "Demo control room" : "Your visits"}
            </h1>
            <div className="mb-5 flex flex-wrap gap-4">
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {[
                    "confirmed",
                    "checked_in",
                    "completed",
                    "cancelled",
                    "no_show",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Time
                <select
                  value={timeFilter}
                  onChange={(e) => setTimeFilter(e.target.value)}
                >
                  <option value="all">All times</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="past">Past</option>
                </select>
              </label>
            </div>
            <div className="space-y-3">
              {!visibleBookings.length && (
                <div className="panel">No bookings match this view.</div>
              )}
              {visibleBookings.map((b) => (
                <article
                  className="panel flex flex-wrap items-center justify-between gap-4"
                  key={b.id}
                >
                  <div>
                    <span className="status">{b.status}</span>
                    <h2 className="mt-3 text-xl font-semibold">
                      {b.bays?.label} · {b.bays?.zones.name}
                    </h2>
                    <p className="mt-2 text-sm muted">
                      {displayTime(b.start_at)} – {displayTime(b.end_at)}
                    </p>
                    <p className="mt-2 text-xs muted">{b.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBooking(b);
                        setView("detail");
                      }}
                    >
                      Details
                    </Button>
                    {view === "admin" && (
                      <>
                        {b.status === "confirmed" && (
                          <Button
                            disabled={
                              busy ||
                              !arrivalEligible(b, b.is_demo ? now : realNow)
                            }
                            onClick={() => action(b.id, "check-in", true)}
                          >
                            Simulate check-in
                          </Button>
                        )}
                        {b.status === "checked_in" && (
                          <Button
                            disabled={busy}
                            onClick={() => action(b.id, "complete", true)}
                          >
                            Simulate completion
                          </Button>
                        )}
                        {b.status === "confirmed" &&
                          Date.parse(b.arrival_deadline) <=
                            (b.is_demo ? now : realNow) && (
                            <Button
                              disabled={busy}
                              onClick={() => action(b.id, "no-show", true)}
                            >
                              Mark no-show
                            </Button>
                          )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {view === "admin" && (
              <>
                <h2 className="my-6 text-2xl font-semibold">Bay inventory</h2>
                <p className="mb-4 text-sm muted">
                  Disabling a bay prevents new bookings. Existing bookings
                  remain allocated.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {bays.map((b) => (
                    <div className="panel" key={b.id}>
                      <p className="mb-3 font-semibold">
                        {b.label} · {b.zones.name}
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api<{ warning: string | null }>(
                              "admin/bays/" + b.id,
                              { isActive: !b.is_active },
                              "PATCH",
                            );
                            setBays(await api<Bay[]>("admin/bays"));
                            setInfo(r.warning ?? "Bay availability updated.");
                          })
                        }
                      >
                        {b.is_active ? "Disable bay" : "Enable bay"}
                      </Button>
                    </div>
                  ))}
                </div>
                <h2 className="my-6 text-2xl font-semibold">
                  Zones & destination routes
                </h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {routes.map((r) => (
                    <div className="panel text-sm" key={r.id}>
                      <h3 className="font-bold">
                        {r.zones.name} · {r.zones.floor} → {r.destinations.name}
                      </h3>
                      <p className="mt-2 muted">
                        {r.is_verified
                          ? `${r.walking_distance_m} m · ${r.is_step_free ? "Step-free" : "Not step-free"}`
                          : "Unverified route · distance unknown"}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <div className="notice mt-9 flex gap-3">
          <Clock size={17} className="mt-0.5 shrink-0" />
          <p>{notice}</p>
        </div>
        <footer className="mt-9 flex justify-between border-t border-[#dfe5dc] pt-5 text-xs muted">
          <span>ParkAhead · A little planning. A better arrival.</span>
          <span>Fictional prototype · 2026</span>
        </footer>
        {busy && (
          <span role="status" className="sr-only">
            Working. Please wait.
          </span>
        )}
      </main>
    </>
  );
}

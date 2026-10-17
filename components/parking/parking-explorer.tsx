"use client";
import { PlateConfirmation } from "@/components/plate-confirmation";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MallSelector } from "@/components/parking/mall-selector";
import { ParkingMap } from "@/components/parking/parking-map";
import { PreferenceExplanation } from "@/components/parking/preference-explanation";
import { useParkingClock } from "@/lib/use-parking-clock";
import { intervalError, displayTime } from "@/lib/rules";
import {
  floorMapSchema,
  instantInMall,
  localInMall,
  mapLimitation,
  parkingRequestSchema,
  preferenceKeys,
  preferenceLabel,
  sortRecommendations,
  statusDescription,
  type FloorMap,
  type Mall,
  type PreferenceDefinition,
  type PreferenceKey,
  type Recommendations,
  type BayAvailability,
} from "@/lib/parking";
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const j = await r.json();
  if (!r.ok)
    throw new RequestError(
      j.error?.message ?? "Unable to load parking data.",
      r.status,
    );
  return j.data;
}
export function ParkingExplorer() {
  const [plate, setPlate] = useState("");
  const [category, setCategory] = useState("all"),
    [malls, setMalls] = useState<Mall[]>([]),
    [mallId, setMallId] = useState(""),
    [floorId, setFloorId] = useState(""),
    [destinationId, setDestinationId] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [selectedPrefs, setSelectedPrefs] = useState<PreferenceKey[]>([]),
    [requiredPrefs, setRequiredPrefs] = useState<PreferenceKey[]>([]),
    [definitions, setDefinitions] = useState<PreferenceDefinition[]>([]),
    [layout, setLayout] = useState<FloorMap | null>(null),
    [layoutError, setLayoutError] = useState(""),
    [layoutVersion, setLayoutVersion] = useState(0),
    [layoutLoading, setLayoutLoading] = useState(false),
    [data, setData] = useState<Recommendations | null>(null),
    [resultsKey, setResultsKey] = useState(""),
    [fresh, setFresh] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selectionMessage, setSelectionMessage] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [inspectedId, setInspectedId] = useState(""),
    [detailsOpen, setDetailsOpen] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [authNeeded, setAuthNeeded] = useState(false),
    [loaded, setLoaded] = useState(false),
    [mallError, setMallError] = useState(""),
    [mallVersion, setMallVersion] = useState(0);
  const mall = malls.find((m) => m.id === mallId),
    { context: clock } = useParkingClock(mallId),
    sequence = useRef(0),
    controller = useRef<AbortController | null>(null),
    selection = useRef(""),
    draft = useRef<URLSearchParams | null>(null),
    draftRestored = useRef(false),
    idempotency = useRef({ fingerprint: "", key: "" }),
    busyRef = useRef(false),
    detailsRef = useRef<HTMLElement | null>(null),
    validateNewMallTimes = useRef(false);
  selection.current = selectedId;
  useEffect(() => {
    if (detailsOpen && window.matchMedia("(max-width:1023px)").matches)
      detailsRef.current?.focus();
  }, [detailsOpen]);
  useEffect(() => {
    if (!validateNewMallTimes.current || !clock || !mall) return;
    validateNewMallTimes.current = false;
    try {
      if (
        start &&
        end &&
        intervalError(
          instantInMall(start, mall.timezone),
          instantInMall(end, mall.timezone),
          Date.parse(clock.now),
        )
      ) {
        setStart("");
        setEnd("");
        setSelectionMessage(
          "Visit times were cleared because they are not valid for the new mall clock. Choose new times.",
        );
      }
    } catch {
      setStart("");
      setEnd("");
    }
  }, [clock, mall, start, end]);
  useEffect(() => {
    const abort = new AbortController();
    setLoaded(false);
    setMallError("");
    draft.current = new URLSearchParams(window.location.search);
    request<Mall[]>("malls", undefined, abort.signal)
      .then((catalog) => {
        if (abort.signal.aborted) return;
        const rows = catalog.filter((m) => m.is_active !== false);
        setMalls(rows);
        const restoredId = draft.current?.get("mallId");
        if (restoredId && !rows.some((m) => m.id === restoredId)) {
          setMallId("");
          setFloorId("");
          setLoaded(true);
          setSelectionMessage(
            "Your saved mall is no longer available. Choose a mall to plan your visit.",
          );
          return;
        }
        const first =
          rows.find((m) => m.id === draft.current?.get("mallId")) ?? rows[0];
        if (first) {
          setMallId(first.id);
          setFloorId(
            first.parking_floors?.find((f) => f.is_active)?.id ??
              first.parking_floors?.[0]?.id ??
              "",
          );
          if (draft.current?.get("mallId") === first.id) {
            const dest = draft.current.get("destinationId") ?? "";
            if (first.destinations.some((d) => d.id === dest))
              setDestinationId(dest);
            const selected = (draft.current.get("selectedPreferences") ?? "")
              .split(",")
              .filter((k): k is PreferenceKey =>
                preferenceKeys.includes(k as PreferenceKey),
              );
            const required = (draft.current.get("requiredPreferences") ?? "")
              .split(",")
              .filter(
                (k): k is PreferenceKey =>
                  selected.includes(k as PreferenceKey) && k !== "shorter_walk",
              );
            setSelectedPrefs([...new Set(selected)]);
            setRequiredPrefs([...new Set(required)]);
            try {
              const s = draft.current.get("startAt"),
                e = draft.current.get("endAt");
              if (s && e) {
                setStart(localInMall(s, first.timezone));
                setEnd(localInMall(e, first.timezone));
              }
            } catch {
              setError(
                "Your saved visit times could not be restored. Choose new times.",
              );
            }
          }
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setMallError("Unable to load malls.");
          setLoaded(true);
        }
      });
    return () => abort.abort();
  }, [mallVersion]);
  useEffect(() => {
    if (!mallId) return;
    const abort = new AbortController();
    setDefinitions([]);
    request<PreferenceDefinition[]>(
      "malls/" + mallId + "/preferences",
      undefined,
      abort.signal,
    )
      .then(setDefinitions)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [mallId]);
  useEffect(() => {
    setLayout(null);
    setLayoutError("");
    if (!mallId || !floorId) return;
    const abort = new AbortController();
    setLayoutLoading(true);
    request<unknown>(
      `floors/${floorId}/map?mallId=${mallId}`,
      undefined,
      abort.signal,
    )
      .then((v) => {
        if (abort.signal.aborted) return;
        setLayout(floorMapSchema.parse(v));
        setLayoutLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setLayoutError(
            "Map could not be loaded. Retry or choose another floor. " +
              e.message,
          );
          setLayoutLoading(false);
        }
      });
    return () => abort.abort();
  }, [mallId, floorId, layoutVersion]);
  const query = useMemo(() => {
    if (!mall || !start || !end || !clock) return { key: "", issue: "" };
    try {
      const startAt = instantInMall(start, mall.timezone),
        endAt = instantInMall(end, mall.timezone);
      const issue = intervalError(startAt, endAt, Date.parse(clock.now));
      if (issue) return { key: "", issue };
      if (Date.parse(endAt) - Date.parse(startAt) <= clock.graceMinutes * 60000)
        return {
          key: "",
          issue: "Duration must exceed the arrival grace period.",
        };
      const parsed = parkingRequestSchema.safeParse({
        mallId,
        destinationId: destinationId || null,
        startAt,
        endAt,
        selectedPreferences: selectedPrefs,
        requiredPreferences: requiredPrefs,
      });
      if (!parsed.success)
        return {
          key: "",
          issue: parsed.error.issues.map((i) => i.message).join(" "),
        };
      return { key: JSON.stringify(parsed.data), issue: "" };
    } catch (e) {
      return {
        key: "",
        issue: e instanceof Error ? e.message : "Choose valid visit times.",
      };
    }
  }, [
    mall,
    mallId,
    start,
    end,
    clock,
    destinationId,
    selectedPrefs,
    requiredPrefs,
  ]);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = ++sequence.current;
    if (!query.key) {
      setFresh(false);
      setData(null);
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const next = await request<Recommendations>(
        "recommendations",
        JSON.parse(query.key),
        abort.signal,
      );
      if (abort.signal.aborted || current !== sequence.current) return;
      setData(next);
      setResultsKey(query.key);
      setFresh(true);
      setLoading(false);
      setError("");
      const selected = next.bays.find((b) => b.id === selection.current);
      if (
        selection.current &&
        (!selected || selected.status !== "available" || !selected.eligible)
      ) {
        setSelectedId("");
        setReview(false);
        setSelectionMessage(
          "Your selected bay is no longer bookable for this visit. It was not replaced. Choose another available bay.",
        );
      }
      if (!draftRestored.current && draft.current?.get("bayId")) {
        draftRestored.current = true;
        const restored = next.bays.find(
          (b) => b.id === draft.current?.get("bayId"),
        );
        if (restored?.status === "available" && restored.eligible) {
          setSelectedId(restored.id);
          setInspectedId(restored.id);
          setFloorId(restored.floorId);
          setReview(true);
        } else
          setSelectionMessage(
            "Your previous bay is no longer bookable. Select an alternative.",
          );
      }
    } catch (e) {
      if (
        current !== sequence.current ||
        (e instanceof Error && e.name === "AbortError")
      )
        return;
      setFresh(false);
      setLoading(false);
      setError(
        e instanceof Error ? e.message : "Availability could not be refreshed.",
      );
    }
  }, [query.key]);
  useEffect(() => {
    setFresh(false);
    setReview(false);
    setAuthNeeded(false);
    const timer = setTimeout(refresh, 250);
    const focus = () => refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    window.addEventListener("focus", focus);
    const visibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      controller.current?.abort();
    };
  }, [refresh, floorId]);
  const matchesCategory = (b: { bayType?: string }) =>
    category === "all" ||
    (category === "oku" ? b.bayType === "oku" : b.bayType !== "oku");
  const activeLayout =
    layout?.mall.id === mallId && layout.floor.id === floorId ? layout : null;
  const current = fresh && resultsKey === query.key,
    states = current ? (data?.bays ?? []).filter(matchesCategory) : [],
    selected = states.find((b) => b.id === selectedId),
    inspected = states.find((b) => b.id === inspectedId),
    mapBay = activeLayout?.bays.find((b) => b.id === inspectedId),
    recommended = sortRecommendations(states),
    top = recommended.slice(0, 3),
    availableCount = states.filter((b) => b.status === "available").length;
  function chooseMall(next: Mall) {
    if (next.id === mallId) return;
    let s = "",
      e = "";
    if (mall && start && end) {
      try {
        s = localInMall(instantInMall(start, mall.timezone), next.timezone);
        e = localInMall(instantInMall(end, mall.timezone), next.timezone);
      } catch {}
    }
    setMallId(next.id);
    setFloorId(
      next.parking_floors.find((f) => f.is_active)?.id ??
        next.parking_floors[0]?.id ??
        "",
    );
    setDestinationId("");
    setSelectedPrefs([]);
    setRequiredPrefs([]);
    setSelectedId("");
    setInspectedId("");
    setDetailsOpen(false);
    setData(null);
    setFresh(false);
    setReview(false);
    setSelectionMessage("");
    setError("");
    setStart(s);
    setEnd(e);
    validateNewMallTimes.current = !!(s && e);
    draftRestored.current = true;
  }
  function togglePreference(key: PreferenceKey) {
    if (selectedPrefs.includes(key)) {
      setSelectedPrefs(selectedPrefs.filter((k) => k !== key));
      setRequiredPrefs(requiredPrefs.filter((k) => k !== key));
    } else setSelectedPrefs([...selectedPrefs, key]);
  }
  function selectBay(b: BayAvailability) {
    if (!current || !b.eligible || b.status !== "available") return;
    setSelectedId(b.id);
    setInspectedId(b.id);
    setDetailsOpen(false);
    setFloorId(b.floorId);
    setSelectionMessage("");
    setError("");
    setAuthNeeded(false);
    setReview(false);
  }
  function showBay(b: BayAvailability) {
    setFloorId(b.floorId);
    setInspectedId(b.id);
    setDetailsOpen(true);
  }
  function suggestedTimes() {
    if (!mall || !clock) return;
    setStart(
      localInMall(
        new Date(Date.parse(clock.now) + 5 * 60000).toISOString(),
        mall.timezone,
      ),
    );
    setEnd(
      localInMall(
        new Date(Date.parse(clock.now) + 65 * 60000).toISOString(),
        mall.timezone,
      ),
    );
  }
  async function confirm() {
    if (!plate || !selected || !current || !query.key || busyRef.current)
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const body = { ...JSON.parse(query.key), bayId: selected.id, plate };
    const fingerprint = JSON.stringify(body);
    if (idempotency.current.fingerprint !== fingerprint)
      idempotency.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const r = await request<{ id: string }>("reservations", {
        ...body,
        idempotencyKey: idempotency.current.key,
      });
      window.location.assign("/bookings/" + r.id);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) {
        setAuthNeeded(true);
        setError("Sign in, then review and explicitly confirm this exact bay.");
      } else if (e instanceof RequestError && [404, 409].includes(e.status)) {
        setSelectedId("");
        setReview(false);
        await refresh();
        setSelectionMessage(
          e.message + " The selected bay was cleared; choose an alternative.",
        );
      } else
        setError(
          e instanceof Error
            ? e.message
            : "Confirmation failed. Retry with the same request.",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function returnLink() {
    if (!query.key) return "/parking";
    const q = JSON.parse(query.key);
    const params = new URLSearchParams({
      mallId: q.mallId,
      bayId: selectedId,
      startAt: q.startAt,
      endAt: q.endAt,
      destinationId: q.destinationId ?? "",
      selectedPreferences: selectedPrefs.join(","),
      requiredPreferences: requiredPrefs.join(","),
    });
    return "/parking?" + params;
  }
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <span className="eyebrow">Choose your place before you arrive</span>
          <h1 className="mt-4 text-4xl font-semibold">
            Your plans. Your parking bay.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 muted">
            Four fictional malls. Numbered bays. A route that suits your visit.
            Choose a bay yourself, then confirm its reservation.
          </p>
        </div>
        <Link className="text-sm underline" href="/legacy">
          Assign one for me →
        </Link>
      </section>
      <p className="notice">{mapLimitation}</p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {!current && query.key
            ? " Bay status is unknown until a successful refresh."
            : ""}
        </p>
      )}
      {selectionMessage && (
        <p role="status" className="notice border-amber-300">
          {selectionMessage}
        </p>
      )}
      <section aria-label="Choose a fictional mall">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">01 · Choose your mall</h2>
          <span className="eyebrow">Fictional demo locations</span>
        </div>
        <MallSelector
          malls={malls}
          selectedMallId={mallId}
          onMallChange={chooseMall}
          isLoading={!loaded}
          error={mallError}
          onRetry={() => setMallVersion((v) => v + 1)}
        />
      </section>
      {mall && (
        <>
          <section className="panel" id="parking-visit">
            <h2 className="mb-5 text-xl font-semibold">02 · Plan your visit</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                Arrival · mall time
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Departure · mall time
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label>
                Destination
                <select
                  aria-label="Destination"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                >
                  <option value="">No destination selected</option>
                  {mall.destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs muted">
              <span>
                All input uses {mall.timezone}. 1–8 hours, up to 30 days ahead.
              </span>
              <button
                className="underline"
                disabled={!clock}
                onClick={suggestedTimes}
              >
                Use suggested visit times
              </button>
              <button
                className="underline"
                onClick={() => {
                  setStart("");
                  setEnd("");
                  setSelectedId("");
                  setReview(false);
                }}
              >
                Clear visit times
              </button>
            </div>
            {query.issue && (
              <p role="status" className="notice mt-4">
                {query.issue}
              </p>
            )}
            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="mb-4 flex flex-wrap justify-between gap-3">
                <h3 className="font-semibold">What matters for this visit?</h3>
                <button
                  className="text-sm underline"
                  onClick={() => {
                    setSelectedPrefs([]);
                    setRequiredPrefs([]);
                  }}
                >
                  Clear all preferences
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {definitions.map((d) => (
                  <div
                    key={d.id}
                    className={`rounded-xl border p-4 ${selectedPrefs.includes(d.id) ? "border-emerald-700 bg-[var(--surface-muted)]" : "border-slate-200"}`}
                  >
                    <label className="flex items-start gap-3">
                      <input
                        className="!m-0 !mt-1 !min-h-0 !w-4"
                        type="checkbox"
                        checked={selectedPrefs.includes(d.id)}
                        onChange={() => togglePreference(d.id)}
                      />
                      <span>
                        {d.label}
                        <span className="mt-1 block text-xs font-normal leading-5 muted">
                          {d.description}
                          {d.requires_destination
                            ? " Requires a destination."
                            : ""}
                        </span>
                      </span>
                    </label>
                    {selectedPrefs.includes(d.id) && d.supports_required ? (
                      <label className="mt-3 flex items-center gap-2 text-xs">
                        <input
                          className="!m-0 !min-h-0 !w-4"
                          type="checkbox"
                          checked={requiredPrefs.includes(d.id)}
                          onChange={(e) =>
                            setRequiredPrefs(
                              e.target.checked
                                ? [...requiredPrefs, d.id]
                                : requiredPrefs.filter((k) => k !== d.id),
                            )
                          }
                        />
                        Must have: {d.label}
                      </label>
                    ) : (
                      selectedPrefs.includes(d.id) && (
                        <p className="mt-3 text-xs muted">
                          Nice to have · ranking objective
                        </p>
                      )
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs muted">
                Selections start as nice to have. Must-haves filter eligibility
                and are never silently relaxed. Step-free describes the
                fictional route. OKU bays separately require approved mall
                eligibility.
              </p>
            </div>
          </section>
          <section className="space-y-5">
            <div
              className="notice flex items-start justify-between gap-3 lg:hidden"
              aria-label="Visit summary"
            >
              <div>
                <p className="font-semibold">
                  {mall.name} ·{" "}
                  {mall.parking_floors.find((f) => f.id === floorId)?.name}
                </p>
                <p>
                  {query.key
                    ? `${start.replace("T", " ")} → ${end.replace("T", " ")} · ${selectedPrefs.length} preferences, ${requiredPrefs.length} must-haves`
                    : "Choose valid visit times and preferences to query availability."}
                </p>
                <p>{mall.timezone}</p>
              </div>
              <button
                className="shrink-0 underline"
                onClick={() =>
                  document
                    .getElementById("parking-visit")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Edit visit
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">03 · Find your bay</h2>
                <p className="mt-2 text-xs muted">
                  {current
                    ? `${availableCount} bays available for this interval · refreshed from server/demo time ${displayTime(data!.serverNow, mall.timezone)}`
                    : "Choose valid times to query availability. Layout alone does not imply a bay is free."}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={!query.key || loading}
                onClick={refresh}
              >
                {loading ? "Refreshing…" : "Refresh availability"}
              </Button>
            </div>
            <label className="block max-w-sm">
              Bay category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">Standard and OKU</option>
                <option value="standard">Standard bays</option>
                <option value="oku">OKU bays only</option>
              </select>
            </label>
            <div
              role="group"
              aria-label="Parking floors"
              className="flex flex-wrap gap-2"
            >
              {[...mall.parking_floors]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((f) => (
                  <Button
                    key={f.id}
                    variant={floorId === f.id ? "default" : "outline"}
                    aria-pressed={floorId === f.id}
                    onClick={() => {
                      setFloorId(f.id);
                      setInspectedId("");
                    }}
                  >
                    {f.name}
                    {!f.is_active ? " · inactive" : ""}
                  </Button>
                ))}
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
              <div className="panel min-w-0">
                {layoutLoading ? (
                  <div
                    role="status"
                    className="h-72 animate-pulse rounded-xl bg-slate-100 p-6"
                  >
                    Loading floor layout…
                  </div>
                ) : layoutError ? (
                  <div>
                    <p role="alert" className="notice">
                      {layoutError}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-3"
                      onClick={() => setLayoutVersion((v) => v + 1)}
                    >
                      Retry map
                    </Button>
                  </div>
                ) : activeLayout ? (
                  <ParkingMap
                    layout={{
                      ...activeLayout,
                      bays: activeLayout.bays.filter(matchesCategory),
                    }}
                    states={states}
                    selectedId={selectedId}
                    inspectedId={inspectedId}
                    recommendedIds={
                      selectedPrefs.length ? top.map((b) => b.id) : []
                    }
                    onInspect={(id) => {
                      setInspectedId(id);
                      setDetailsOpen(true);
                    }}
                  />
                ) : (
                  <p>Choose a floor to view the layout.</p>
                )}
              </div>
              <aside className="space-y-4">
                <section className="panel">
                  <span className="eyebrow">Across all floors</span>
                  <h3 className="my-3 text-lg font-semibold">
                    {selectedPrefs.length
                      ? "Top three matches"
                      : "Available bays · label order"}
                  </h3>
                  {loading && !current && (
                    <p role="status" className="text-sm muted">
                      Checking scheduled availability…
                    </p>
                  )}
                  {!query.key && (
                    <p className="text-sm muted">
                      Enter valid visit times. No availability is claimed
                      without an interval.
                    </p>
                  )}
                  {current && !availableCount && (
                    <p role="status">
                      No available bays for this interval. Change your times.
                    </p>
                  )}
                  {current && availableCount > 0 && !recommended.length && (
                    <>
                      <p role="status" className="font-semibold">
                        No available bays meet all your required preferences.
                      </p>
                      <p className="my-3 text-sm muted">
                        Review these requirements:{" "}
                        {requiredPrefs
                          .map((k) => preferenceLabel(k, definitions))
                          .join(", ")}
                        . Unknown measurements cannot satisfy must-haves.
                      </p>
                      <button
                        className="text-sm underline"
                        onClick={() => setRequiredPrefs([])}
                      >
                        Clear must-haves, keep nice-to-haves
                      </button>
                    </>
                  )}
                  {current &&
                    selectedPrefs.length > 0 &&
                    recommended.length > 0 &&
                    !recommended.some(
                      (b) =>
                        b.evaluation.matched.length === selectedPrefs.length,
                    ) && (
                      <p role="status" className="notice my-3">
                        No available bay matches every selected preference.
                        Nice-to-have trade-offs and unknown values are shown
                        below.
                      </p>
                    )}
                  {top.map((b) => (
                    <article
                      className="border-t border-slate-100 py-4"
                      key={b.id}
                    >
                      <h4 className="flex items-center gap-2 font-bold">
                        {selectedPrefs.length > 0 && <Star size={14} />}{" "}
                        {b.label}
                      </h4>
                      <p className="my-2 text-xs muted">
                        {b.floorName} · {b.zoneName} ·{" "}
                        {b.bayType === "oku" ? "♿ OKU" : "Standard"}
                        {b.floorId !== floorId ? " · on another floor" : ""}
                      </p>
                      <PreferenceExplanation
                        evaluation={b.evaluation}
                        definitions={definitions}
                        compact
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="text-xs underline"
                          onClick={() => showBay(b)}
                        >
                          Show on map · {b.floorName}
                        </button>
                        <button
                          className="text-xs font-bold underline"
                          onClick={() => selectBay(b)}
                        >
                          Select bay {b.label}
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
                <section
                  ref={detailsRef}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setDetailsOpen(false);
                  }}
                  className={`panel ${detailsOpen && inspectedId ? "fixed inset-x-3 bottom-3 z-20 max-h-[70vh] overflow-auto shadow-2xl lg:static lg:max-h-none lg:shadow-none" : ""}`}
                  aria-label="Bay details"
                >
                  {detailsOpen && (
                    <button
                      className="mb-3 text-sm underline lg:hidden"
                      onClick={() => setDetailsOpen(false)}
                    >
                      Close bay details
                    </button>
                  )}
                  <h3 className="text-xl font-semibold">
                    {inspected?.label ?? mapBay?.label ?? "Inspect a bay"}
                  </h3>
                  {mapBay?.bayType === "oku" && (
                    <p className="notice my-3">
                      <strong>♿ OKU / accessible parking</strong>
                      <br />
                      Restricted to eligible users under the mall’s parking
                      rules.{" "}
                      {inspected?.eligibilityOutcome === "approved"
                        ? "Approved for this mall. Route requirements and availability still apply."
                        : "Approved eligibility is required."}
                      <br />
                      <Link
                        className="underline"
                        href={"/eligibility?mallId=" + mallId}
                      >
                        Request or view simulated eligibility review
                      </Link>
                      <br />
                      Standard bays remain available as alternatives.
                    </p>
                  )}
                  {inspected || mapBay ? (
                    <>
                      <p className="my-3 text-sm muted">
                        {mall.name} ·{" "}
                        {inspected?.floorName ?? mapBay?.floorName} ·{" "}
                        {inspected?.zoneName ?? mapBay?.zoneName}
                      </p>
                      <p className="mb-4 font-semibold">
                        {statusDescription(inspected?.status ?? "unknown")}
                      </p>
                      {inspected &&
                        [
                          "inactive_mall",
                          "inactive_floor",
                          "inactive_zone",
                          "inactive_bay",
                        ].includes(inspected.reason) && (
                          <p className="notice mb-3">
                            {
                              (
                                {
                                  inactive_mall: "This mall is inactive.",
                                  inactive_floor:
                                    "This parking floor is inactive.",
                                  inactive_zone: "This zone is inactive.",
                                  inactive_bay:
                                    "This bay is operationally unavailable.",
                                } as Record<string, string>
                              )[inspected.reason]
                            }
                          </p>
                        )}
                      {inspected ? (
                        <PreferenceExplanation
                          evaluation={inspected.evaluation}
                          definitions={definitions}
                        />
                      ) : (
                        <p className="text-sm muted">
                          Preference matches and availability are unknown
                          without a successful interval query.
                        </p>
                      )}
                      {((mapBay?.bayType &&
                        !["standard", "oku"].includes(mapBay.bayType)) ||
                        inspected?.reason === "restricted_type") && (
                        <p className="notice mt-3">
                          This inventory category cannot be reserved.
                        </p>
                      )}
                      {inspected &&
                        !inspected.eligible &&
                        inspected.status === "available" && (
                          <p className="notice mt-3">
                            Eligibility or required preferences are unmet or
                            unknown. Change them explicitly before selecting.
                          </p>
                        )}
                      <Button
                        className="mt-5 w-full"
                        disabled={
                          !current ||
                          !inspected?.eligible ||
                          inspected.status !== "available"
                        }
                        onClick={() => inspected && selectBay(inspected)}
                      >
                        Select this bay
                      </Button>
                    </>
                  ) : (
                    <p className="mt-3 text-sm muted">
                      Click a numbered bay or use the list view. Reserved and
                      inactive bays can be inspected but cannot be booked.
                    </p>
                  )}
                </section>
              </aside>
            </div>
          </section>
          {review && selected && current && (
            <section className="panel" aria-label="Booking review">
              <span className="eyebrow">One last look</span>
              <h2 className="my-4 text-3xl font-semibold">
                Review your exact bay
              </h2>
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xl font-semibold">
                    {mall.name} · {selected.floorName} · {selected.zoneName}
                  </p>
                  <p className="my-3 text-3xl font-semibold">
                    {selected.label}
                  </p>
                  <p>
                    {displayTime(JSON.parse(query.key).startAt, mall.timezone)}{" "}
                    → {displayTime(JSON.parse(query.key).endAt, mall.timezone)}
                  </p>
                  <p className="my-3">
                    Destination:{" "}
                    {mall.destinations.find((d) => d.id === destinationId)
                      ?.name ?? "None selected"}
                  </p>
                  <p className="notice">
                    The server will reserve this exact bay or return a conflict.
                    It will never silently assign another bay. No payment
                    required.
                  </p>
                </div>
                <PreferenceExplanation
                  evaluation={selected.evaluation}
                  definitions={definitions}
                />
              </div>
              <PlateConfirmation onConfirmed={setPlate} />
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  disabled={busy || !plate || !current || !selected.eligible}
                  onClick={confirm}
                >
                  {busy ? "Confirming…" : "Confirm exact bay"}
                </Button>
                <Button variant="outline" onClick={() => setReview(false)}>
                  Back to map
                </Button>
                {authNeeded && (
                  <Button asChild variant="outline">
                    <Link
                      href={
                        "/auth?returnTo=" + encodeURIComponent(returnLink())
                      }
                    >
                      Sign in and return to review
                    </Link>
                  </Button>
                )}
              </div>
            </section>
          )}
          {selectedId && (
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-800 bg-white/95 p-4 shadow-lg">
              <div>
                <p className="text-sm font-bold">
                  {selected?.label ??
                    data?.bays.find((b) => b.id === selectedId)?.label ??
                    "Selected bay"}{" "}
                  · {selected?.floorName ?? "Refreshing floor"}
                </p>
                <p className="mt-1 text-xs muted">
                  {current && selected?.eligible
                    ? "Selected for this interval. Confirmation rechecks availability."
                    : "Selection is unverified. Refresh before booking."}
                </p>
              </div>
              <Button
                disabled={!current || !selected?.eligible || busy}
                onClick={() => setReview(true)}
              >
                Review exact bay <ArrowRight size={15} className="ml-2" />
              </Button>
            </div>
          )}
        </>
      )}
      {!malls.length && loaded && (
        <p className="panel">
          No mall catalog could be loaded. Check Supabase configuration and
          migrations.
        </p>
      )}
    </div>
  );
}

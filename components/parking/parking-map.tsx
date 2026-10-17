"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  statusDescription,
  type FloorMap,
  type BayAvailability,
} from "@/lib/parking";
export function ParkingMap({
  layout,
  states = [],
  selectedId,
  inspectedId,
  recommendedIds = [],
  onInspect,
  readOnly = false,
}: {
  layout: FloorMap;
  states?: BayAvailability[];
  selectedId?: string;
  inspectedId?: string;
  recommendedIds?: string[];
  onInspect?: (id: string) => void;
  readOnly?: boolean;
}) {
  const [zoom, setZoom] = useState(1),
    [search, setSearch] = useState(""),
    [list, setList] = useState(false),
    [highlights, setHighlights] = useState(true);
  const viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (list) return;
    const matches = search
      ? layout.bays.filter((b) =>
          b.label.toLowerCase().includes(search.toLowerCase()),
        )
      : [];
    const target =
      matches.length === 1
        ? matches[0]
        : layout.bays.find((b) => b.id === (inspectedId || selectedId));
    const view = viewport.current;
    if (target && view)
      view.scrollTo({
        left: Math.max(
          0,
          (target.x + target.width / 2) * zoom - view.clientWidth / 2,
        ),
        top: Math.max(
          0,
          (target.y + target.height / 2) * zoom - view.clientHeight / 2,
        ),
        behavior: "smooth",
      });
  }, [inspectedId, selectedId, layout, list, zoom, search]);
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const matching = layout.bays.filter((b) =>
    b.label.toLowerCase().includes(search.toLowerCase()),
  );
  const colors = (status: string) =>
    status === "available"
      ? {
          fill: "var(--map-available-fill)",
          stroke: "var(--map-available-stroke)",
        }
      : status === "reserved"
        ? {
            fill: "var(--map-reserved-fill)",
            stroke: "var(--map-reserved-stroke)",
          }
        : status === "unavailable"
          ? {
              fill: "var(--map-unavailable-fill)",
              stroke: "var(--map-unavailable-stroke)",
            }
          : {
              fill: "var(--map-unknown-fill)",
              stroke: "var(--map-unknown-stroke)",
            };
  return (
    <section aria-label="Numbered parking map" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1">
          Bay search · this floor
          <input
            value={search}
            placeholder="e.g. B1-A03"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button variant="outline" onClick={() => setList(!list)}>
          {list ? "Map view" : "List view"}
        </Button>
        <Button
          variant="outline"
          aria-label="Zoom out"
          disabled={zoom <= 0.65}
          onClick={() => setZoom(Math.max(0.65, zoom - 0.2))}
        >
          −
        </Button>
        <Button
          variant="outline"
          aria-label="Zoom in"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.2))}
        >
          +
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setZoom(1);
            setSearch("");
          }}
        >
          Reset view
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {layout.mall.name} · Floor {layout.floor.name}
        </p>
        <label className="flex items-center gap-2 font-normal">
          <input
            className="!m-0 !min-h-0 !w-4"
            type="checkbox"
            checked={highlights}
            onChange={(e) => setHighlights(e.target.checked)}
          />
          Show recommended bays
        </label>
      </div>
      {!states.length && (
        <p className="notice mb-3">
          {readOnly
            ? "Booking location only. Other bays have no availability query on this screen."
            : "Choose arrival and departure times to load reservation availability. Neutral bays have unknown status."}
        </p>
      )}
      {list ? (
        <ul
          className="grid max-h-[600px] gap-3 overflow-y-auto p-1 sm:grid-cols-2"
          aria-label="Bays on this floor"
        >
          {matching.map((b) => {
            const state = stateMap.get(b.id);
            return (
              <li key={b.id}>
                <button
                  className={`w-full rounded-xl border p-4 text-left focus-visible:outline-2 ${selectedId === b.id ? "border-emerald-900 ring-2 ring-emerald-800" : "border-slate-200"}`}
                  onClick={() => onInspect?.(b.id)}
                  aria-label={`Bay ${b.label}, ${b.bayType === "oku" ? "OKU-only, approved eligibility required, " : ""} ${b.inventoryClass === "walk_in_only" ? "Walk-in only — cannot reserve" : statusDescription(state?.status ?? "unknown")}, ${state?.evaluation?.matched.length ?? 0} preference matches`}
                >
                  <span className="font-bold">
                    {b.bayType === "oku" ? "♿ OKU · " : ""}
                    {b.label} {selectedId === b.id ? "✓ Selected" : ""}{" "}
                    {highlights && recommendedIds.includes(b.id)
                      ? "★ Recommended"
                      : ""}
                  </span>
                  <span className="mt-2 block text-xs muted">
                    {b.zoneName} · {layout.floor.name}
                  </span>
                  <span className="mt-2 block text-sm">
                    {statusDescription(state?.status ?? "unknown")}
                  </span>
                  <span className="mt-2 block text-xs underline">
                    Inspect bay details
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div
            ref={viewport}
            className="max-w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--map-ground)]"
            style={{ maxHeight: 620 }}
          >
            <svg
              role="group"
              aria-label={`Interactive fictional parking layout, ${layout.mall.name}, floor ${layout.floor.name}`}
              viewBox={`0 0 ${layout.floor.map_width} ${layout.floor.map_height}`}
              style={{
                width: layout.floor.map_width * zoom,
                maxWidth: "none",
                height: layout.floor.map_height * zoom,
              }}
            >
              {layout.features.map((f) => {
                const g = f.geometry;
                const isWalk = f.type === "pedestrian_path";
                if (g.kind === "polyline")
                  return (
                    <g key={f.id}>
                      <polyline
                        points={g.points.map((p) => p.join(",")).join(" ")}
                        fill="none"
                        stroke={
                          isWalk ? "var(--map-walkway)" : "var(--map-road)"
                        }
                        strokeWidth={isWalk ? 4 : 28}
                        strokeDasharray={isWalk ? "8 6" : undefined}
                        strokeLinejoin="round"
                      />
                      {!isWalk && (
                        <polyline
                          points={g.points.map((p) => p.join(",")).join(" ")}
                          fill="none"
                          stroke="white"
                          strokeWidth={2}
                          strokeDasharray="14 12"
                        />
                      )}
                    </g>
                  );
                if (g.kind === "rect")
                  return (
                    <g key={f.id}>
                      <rect
                        x={g.x}
                        y={g.y}
                        width={g.width}
                        height={g.height}
                        rx={12}
                        fill="var(--map-zone)"
                      />
                      <text
                        x={g.x + 12}
                        y={g.y + g.height / 2 + 5}
                        fontSize={15}
                        fill="var(--map-zone-text)"
                      >
                        {f.label}
                      </text>
                    </g>
                  );
                if (f.type === "zone_label")
                  return (
                    <text
                      key={f.id}
                      x={g.x}
                      y={g.y}
                      fontSize={18}
                      fontWeight="bold"
                      fill="var(--map-structure)"
                    >
                      {f.label}
                    </text>
                  );
                return (
                  <g key={f.id}>
                    <circle
                      cx={g.x}
                      cy={g.y}
                      r={7}
                      fill={
                        f.type === "lift"
                          ? "var(--map-lift)"
                          : f.type === "exit"
                            ? "var(--map-destination)"
                            : "var(--map-entrance)"
                      }
                    />
                    <text
                      x={g.x > 850 ? g.x - 8 : g.x + 12}
                      y={g.y - 12}
                      fontSize={14}
                      textAnchor={g.x > 850 ? "end" : "start"}
                      fill="var(--foreground)"
                    >
                      {f.label}
                    </text>
                  </g>
                );
              })}
              {layout.bays.map((b) => {
                const state = stateMap.get(b.id),
                  status = state?.status ?? "unknown",
                  selected = selectedId === b.id,
                  recommended =
                    highlights &&
                    recommendedIds.includes(b.id) &&
                    status === "available" &&
                    state?.eligible,
                  style = colors(status),
                  matches = state?.evaluation?.matched.length ?? 0;
                return (
                  <g
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Bay ${b.label}, ${b.bayType === "oku" ? "OKU-only, approved eligibility required, " : ""} ${b.inventoryClass === "walk_in_only" ? "Walk-in only — cannot reserve" : statusDescription(status)}, matches ${matches} preferences${selected ? ", selected" : ""}`}
                    data-testid={"bay-" + b.id}
                    onClick={() => onInspect?.(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onInspect?.(b.id);
                      }
                    }}
                    transform={`translate(${b.x} ${b.y}) rotate(${b.rotation} ${b.width / 2} ${b.height / 2})`}
                    opacity={
                      !search ||
                      b.label.toLowerCase().includes(search.toLowerCase())
                        ? 1
                        : 0.25
                    }
                    className="cursor-pointer focus-visible:outline-2"
                  >
                    <rect
                      width={b.width}
                      height={b.height}
                      rx={7}
                      fill={style.fill}
                      stroke={
                        selected
                          ? "var(--brand-hover)"
                          : inspectedId === b.id
                            ? "var(--map-inspected)"
                            : style.stroke
                      }
                      strokeWidth={
                        selected ? 5 : inspectedId === b.id ? 3 : 1.5
                      }
                    />
                    {b.bayType === "oku" && (
                      <text
                        x={b.width / 2}
                        y={12}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight="bold"
                      >
                        ♿ OKU
                      </text>
                    )}
                    <text
                      x={b.width / 2}
                      y={b.height / 2 + 3}
                      textAnchor="middle"
                      fontWeight="bold"
                      fontSize={13}
                      fill="var(--foreground)"
                    >
                      {b.label}
                    </text>
                    <text
                      x={b.width / 2}
                      y={b.height - 10}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--muted)"
                    >
                      {b.inventoryClass === "walk_in_only"
                        ? "Walk-in"
                        : status === "reserved"
                          ? "R"
                          : status === "unavailable"
                            ? "×"
                            : status === "available"
                              ? "✓"
                              : "?"}
                    </text>
                    {recommended && (
                      <text
                        x={b.width - 13}
                        y={15}
                        fontSize={14}
                        fill="var(--map-warning)"
                      >
                        ★
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="mt-2 text-xs muted">
            Scroll or zoom to explore. Tab to a bay and press Enter to inspect.
            A list view offers the same bay selection.
          </p>
        </>
      )}
      {!matching.length && (
        <p className="notice mt-3">
          No bay label matches your search on this floor.
        </p>
      )}
      <ul
        aria-label="Map legend"
        className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs"
      >
        <li>
          ♿ OKU: mall approval required; category is separate from availability
        </li>
        <li>✓ Available for selected interval</li>
        <li>R Reserved during selected interval</li>
        <li>× Unavailable / restricted</li>
        <li>? Unknown / not queried</li>
        <li>Walk-in only: not reservable; individual occupancy not tracked</li>
        <li>✓ Strong outline: selected</li>
        <li>★ Recommended: separate from status</li>
        <li>Wide gray aisle: driving lane</li>
        <li>Dashed amber line: pedestrian connection</li>
      </ul>
    </section>
  );
}

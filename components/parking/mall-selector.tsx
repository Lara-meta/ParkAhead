"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Mall } from "@/lib/parking";
import { Button } from "@/components/ui/button";

type Props = {
  malls: Mall[];
  selectedMallId: string;
  onMallChange: (mall: Mall) => void;
  isLoading: boolean;
  error: string;
  onRetry: () => void;
};

export function MallSelector({
  malls,
  selectedMallId,
  onMallChange,
  isLoading,
  error,
  onRetry,
}: Props) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [position, setPosition] = useState<CSSProperties>({});
  const selected = malls.find((m) => m.id === selectedMallId),
    results = malls.filter((m) =>
      m.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
  function dismiss() {
    popup.current?.hidePopover();
    setQuery("");
    trigger.current?.focus({ preventScroll: true });
  }
  function choose(mall: Mall) {
    onMallChange(mall);
    dismiss();
  }
  useEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !popup.current) return;
      const rect = trigger.current.getBoundingClientRect(),
        viewport = window.visualViewport,
        top = (viewport?.offsetTop ?? 0) + 12,
        left = (viewport?.offsetLeft ?? 0) + 12,
        width = (viewport?.width ?? window.innerWidth) - 24,
        bottom = top + (viewport?.height ?? window.innerHeight) - 24,
        below = bottom - rect.bottom - 6,
        above = rect.top - top - 6,
        down = below >= 240 || below >= above,
        maxHeight = Math.max(
          80,
          Math.min(380, bottom - top, down ? below : above),
        ),
        height = Math.min(popup.current.scrollHeight || 380, maxHeight);
      setPosition({
        width: Math.min(rect.width, width),
        maxHeight,
        left: Math.max(
          left,
          Math.min(rect.left, left + width - Math.min(rect.width, width)),
        ),
        top: Math.max(
          top,
          Math.min(
            down ? rect.bottom + 6 : rect.top - 6 - height,
            bottom - height,
          ),
        ),
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, query, malls.length]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return (
    <div className="max-w-xl min-w-0">
      <label
        id={id + "-label"}
        className="mb-2 block"
        htmlFor={id + "-trigger"}
      >
        Choose your mall
      </label>
      <button
        ref={trigger}
        id={id + "-trigger"}
        type="button"
        role="combobox"
        aria-labelledby={id + "-label"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={id + "-popup"}
        disabled={isLoading || !!error || !malls.length}
        className="mall-selector-trigger"
        onClick={() => (open ? dismiss() : popup.current?.showPopover())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            popup.current?.showPopover();
          }
        }}
      >
        <span className="min-w-0 truncate">
          {isLoading
            ? "Loading malls…"
            : (selected?.name ?? "Search or select a mall…")}
        </span>
        <ChevronDown aria-hidden="true" size={18} className="shrink-0" />
      </button>
      {error ? (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 text-sm"
        >
          <span>Unable to load malls.</span>
          <Button variant="outline" onClick={onRetry}>
            Retry loading malls
          </Button>
        </div>
      ) : isLoading ? (
        <p role="status" className="mt-2 text-xs muted">
          Loading mall catalog…
        </p>
      ) : !malls.length ? (
        <p role="status" className="mt-3 text-sm muted">
          No malls are currently available.
        </p>
      ) : null}
      <div
        ref={popup}
        id={id + "-popup"}
        popover="auto"
        role="dialog"
        aria-label="Select a mall"
        className="mall-selector-popup"
        style={position}
        onToggle={(e) => {
          const showing = e.newState === "open";
          setOpen(showing);
          if (showing) {
            setActive(
              Math.max(
                0,
                malls.findIndex((m) => m.id === selectedMallId),
              ),
            );
            search.current?.focus({ preventScroll: true });
          } else {
            setQuery("");
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="mall-selector-search">
          <Search size={17} aria-hidden="true" className="shrink-0 muted" />
          <input
            ref={search}
            type="search"
            aria-label="Search malls by name"
            placeholder="Search malls by name…"
            value={query}
            aria-controls={id + "-results"}
            aria-activedescendant={
              results[active] ? id + "-option-" + results[active].id : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) =>
                  results.length
                    ? (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) %
                      results.length
                    : 0,
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[active]) choose(results[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
              }
            }}
          />
        </div>
        <ul
          role="listbox"
          id={id + "-results"}
          aria-label="Matching malls"
          className="mall-selector-results"
        >
          {results.map((m, index) => (
            <li
              key={m.id}
              id={id + "-option-" + m.id}
              role="option"
              aria-selected={m.id === selectedMallId}
              data-index={index}
              data-active={index === active}
              className="mall-selector-option"
              onPointerMove={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(m)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{m.name}</span>
                <span className="text-xs muted">
                  {m.parking_floors.length} parking floors
                </span>
              </span>
              {m.is_demo && <span className="status shrink-0">Demo</span>}
              <span className="w-5 shrink-0">
                {m.id === selectedMallId && (
                  <Check aria-label="Selected" size={18} />
                )}
              </span>
            </li>
          ))}
        </ul>
        {!results.length && (
          <div role="status" className="p-4 text-sm">
            <p>No malls found for ‘{query.trim()}’.</p>
            <button
              type="button"
              className="mt-3 text-link"
              onClick={() => {
                setQuery("");
                setActive(0);
                search.current?.focus();
              }}
            >
              Clear search
            </button>
          </div>
        )}
      </div>
      {selected && !isLoading && !error && (
        <div
          className="mall-selected-summary"
          aria-label="Selected mall summary"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="font-semibold">{selected.name}</h3>
            {selected.is_demo && <span className="status">Demo</span>}
          </div>
          <p className="mt-1 text-sm muted">
            {selected.parking_floors.length} parking floors
            {selected.destinations.length
              ? " · " + selected.destinations.map((d) => d.name).join(", ")
              : ""}
          </p>
          <p className="mt-1 text-xs muted">Timezone: {selected.timezone}</p>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { normalizePlate } from "@/lib/plates";
import { Button } from "@/components/ui/button";
export function PlateConfirmation({
  onConfirmed,
}: {
  onConfirmed: (plate: string) => void;
}) {
  const [input, setInput] = useState(""),
    [confirmed, setConfirmed] = useState("");
  const [bounds, setBounds] = useState<{ min: number; max: number } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    api<{ min: number; max: number }>("plate-configuration")
      .then((v) => {
        if (live) setBounds(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  let normalized = "",
    error = "";
  try {
    if (input && bounds) normalized = normalizePlate(input, bounds);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <fieldset className="my-5 rounded-xl border border-[var(--border)] p-4">
      <legend className="px-2 font-semibold">Booking plate reference</legend>
      <label className="block text-sm">
        Vehicle plate
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-lg border p-3 uppercase"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setConfirmed("");
            onConfirmed("");
          }}
          placeholder="e.g. abc-0123"
        />
      </label>
      {!bounds && <p className="text-sm">Loading plate format settings…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
      {normalized && (
        <p className="my-2 text-sm">
          Normalized plate: <strong>{normalized}</strong>
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="my-2"
        disabled={!normalized || !!confirmed}
        onClick={() => {
          setConfirmed(normalized);
          onConfirmed(normalized);
        }}
      >
        {confirmed
          ? `Plate confirmed: ${confirmed}`
          : `Confirm your plate: ${normalized || "enter plate"}`}
      </Button>
      <p className="text-sm muted">
        Plate is used only as a private booking reference. Ownership is not
        verified. Check it before confirming.
      </p>
    </fieldset>
  );
}

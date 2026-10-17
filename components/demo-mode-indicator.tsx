"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { ClockContext } from "@/lib/lifecycle";
export function DemoModeIndicator() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api<ClockContext>("clock")
      .then((c) => setDemo(c.demoMode))
      .catch(() => {});
  }, []);
  return (
    <div className="bg-[var(--foreground)] px-4 py-2 text-center text-xs leading-5 text-white">
      {demo
        ? "DEMO MODE · Server-controlled demo clock · "
        : "SOFTWARE PROTOTYPE · "}
      Check-in and departure are simulated. Physical vehicle presence is not
      verified.
    </div>
  );
}

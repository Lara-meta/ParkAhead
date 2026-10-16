"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { ClockContext } from "@/lib/lifecycle";
export function useParkingClock(mallId = "") {
  const [context, setContext] = useState<
      (ClockContext & { mallKey: string }) | null
    >(null),
    [now, setNow] = useState(0),
    [realNow, setRealNow] = useState(0);
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const c = await api<ClockContext>(
          "clock" + (mallId ? "?mallId=" + mallId : ""),
        );
        if (alive) setContext({ ...c, mallKey: mallId });
      } catch {
        if (alive) setContext(null);
      }
    }
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [mallId]);
  useEffect(() => {
    if (!context) return;
    const base = performance.now(),
      start = Date.parse(context.now),
      real = Date.parse(context.realNow);
    const tick = () => {
      const elapsed = performance.now() - base;
      setNow(start + (context.mallDemo ? 0 : elapsed));
      setRealNow(real + elapsed);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [context]);
  return {
    context: context?.mallKey === mallId ? context : null,
    now,
    realNow,
  };
}

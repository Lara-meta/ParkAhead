"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { floorMapSchema, type Floor, type FloorMap } from "@/lib/parking";
import { ParkingMap } from "@/components/parking/parking-map";
import { Button } from "@/components/ui/button";
export function StoredFloorMap({
  mallId,
  floorId,
  selectedId,
}: {
  mallId: string;
  floorId?: string;
  selectedId?: string;
}) {
  const [floors, setFloors] = useState<Floor[]>([]),
    [floor, setFloor] = useState(floorId ?? ""),
    [layout, setLayout] = useState<FloorMap | null>(null),
    [error, setError] = useState(""),
    [inspected, setInspected] = useState("");
  useEffect(() => {
    let active = true;
    api<Floor[]>("malls/" + mallId + "/floors")
      .then((v) => {
        if (active) {
          setFloors(v);
          setFloor(floorId ?? v[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [mallId, floorId]);
  useEffect(() => {
    let active = true;
    setLayout(null);
    if (!floor) return;
    api<unknown>(`floors/${floor}/map?mallId=${mallId}`)
      .then((v) => {
        if (active) {
          setLayout(floorMapSchema.parse(v));
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [floor, mallId]);
  const current =
    layout?.mall.id === mallId && layout.floor.id === floor ? layout : null;
  return (
    <div className="my-5 min-w-0 space-y-4">
      {!floorId && (
        <div className="flex flex-wrap gap-2">
          {floors.map((f) => (
            <Button
              key={f.id}
              variant={floor === f.id ? "default" : "outline"}
              onClick={() => setFloor(f.id)}
            >
              {f.name}
            </Button>
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="notice">
          Stored map unavailable. {error}
        </p>
      ) : current ? (
        <>
          <ParkingMap
            layout={current}
            selectedId={selectedId}
            inspectedId={inspected}
            onInspect={setInspected}
            readOnly
          />
          <p aria-live="polite" className="text-sm muted">
            {inspected
              ? "Inspected bay: " +
                current.bays.find((b) => b.id === inspected)?.label
              : "Inspect a label to orient yourself."}{" "}
            This is the current fictional layout. Other bays’ scheduled
            availability is not queried here.
          </p>
        </>
      ) : (
        <p role="status" className="notice">
          Loading stored floor geometry…
        </p>
      )}
    </div>
  );
}

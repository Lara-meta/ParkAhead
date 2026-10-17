import {
  matchSummary,
  preferenceLabel,
  type Evaluation,
  type PreferenceDefinition,
} from "@/lib/parking";
export function PreferenceExplanation({
  evaluation: e,
  definitions = [],
  compact = false,
}: {
  evaluation: Evaluation | undefined;
  definitions?: PreferenceDefinition[];
  compact?: boolean;
}) {
  if (!e)
    return <p className="text-sm muted">No preference snapshot recorded.</p>;
  if (e.historical)
    return (
      <div className="text-sm muted">
        <p>{e.note ?? "Historical measurements were not recorded."}</p>
        <p className="mt-2">
          Saved selections:{" "}
          {(e.selected ?? e.unknown ?? [])
            .map((k) => preferenceLabel(k, definitions))
            .join(", ") || "None"}
          .
        </p>
        {!!e.required?.length && (
          <p className="mt-2">
            Must have at booking:{" "}
            {e.required.map((k) => preferenceLabel(k, definitions)).join(", ")}.
          </p>
        )}
      </div>
    );
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">{matchSummary(e)}</p>
      {!!e.required.length && (
        <p>
          Must have:{" "}
          {e.required.map((k) => preferenceLabel(k, definitions)).join(", ")}
        </p>
      )}
      {!!e.matched.length && (
        <p>
          ✓ Matches:{" "}
          {e.matched.map((k) => preferenceLabel(k, definitions)).join(", ")}
        </p>
      )}
      {!!e.unmet.length && (
        <p>
          Trade-offs:{" "}
          {e.unmet.map((k) => preferenceLabel(k, definitions)).join(", ")}
        </p>
      )}
      {!!e.unknown.length && (
        <p>
          Unknown — not counted as matches:{" "}
          {e.unknown.map((k) => preferenceLabel(k, definitions)).join(", ")}
        </p>
      )}
      {!compact && (
        <>
          <p className="text-xs muted">
            Data completeness: {e.knownCount}/{e.totalCount} selected
            preferences can be evaluated. Score {e.score.toFixed(2)} is a
            normalized demo ranking, not a probability or guarantee.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs muted">
            {[
              ["Standard bay width", e.values.widthMm, "mm"],
              ["Walk to lift", e.values.liftDistanceM, "m"],
              ["Walk to walkway", e.values.walkwayDistanceM, "m"],
              ["Driving distance to exit", e.values.exitDrivingDistanceM, "m"],
              ["Verified destination walk", e.values.walkingDistanceM, "m"],
            ].map(([label, value, unit]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd className="mt-1 font-semibold">
                  {value === null ? "Unknown" : `${value} ${unit}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs muted">
            Configuration: {e.algorithmVersion}. Wider standard bays do not
            grant restricted accessible-bay eligibility.
          </p>
        </>
      )}
    </div>
  );
}

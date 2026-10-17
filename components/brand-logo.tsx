import { ParkingCircle } from "lucide-react";
export function BrandLogo({
  compact = false,
  size = "md",
}: {
  compact?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`brand-logo brand-logo-${size}`}>
      <ParkingCircle aria-hidden="true" className="brand-symbol" />
      {compact ? (
        <span className="sr-only">ParkAhead.</span>
      ) : (
        <span>
          ParkAhead<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}

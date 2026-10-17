export function PageHeading({
  eyebrow,
  children,
  description,
}: {
  eyebrow?: string;
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="page-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{children}</h1>
      {description && <p className="muted mt-3">{description}</p>}
    </div>
  );
}
export function StatusBadge({ children }: { children: React.ReactNode }) {
  return <span className="status">{children}</span>;
}
export function Feedback({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={error ? "notice feedback-error" : "notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
export function LoadingState() {
  return (
    <div className="panel animate-pulse" role="status">
      <p>Loading current parking information…</p>
    </div>
  );
}
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="panel text-center muted">{children}</div>;
}
